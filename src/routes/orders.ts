import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { stripe } from '../config/stripe';
import { selectBox } from '../config/boxSizes';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth';
import { admin } from '../config/firebase';

const router = Router();

interface CartItemInput {
  productId: string;
  quantity: number;
}

interface ShippingSelection {
  rateObjectId: string;
  carrier: string;       // "USPS" | "UPS"
  service: string;       // "Priority Mail" etc
  amount: number;        // USD dollars
  estimatedDays?: number | null;
  durationTerms?: string | null;
}

interface CreateOrderBody {
  items: CartItemInput[];
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
  shipping: ShippingSelection;
  customerNote?: string;
  sessionId?: string;
}

async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.order.count();
  return `WIM-${year}-${String(count + 1).padStart(4, '0')}`;
}

// Resolve Firebase UID from optional auth header — does not block if absent
async function resolveFirebaseUid(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

// POST /api/orders
// Creates a PENDING order + Stripe PaymentIntent in a single call.
// Auth is optional — supports both guest and logged-in checkout.
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateOrderBody;
    const {
      items, email, phone, firstName, lastName,
      street1, street2, city, state, zip, country,
      shipping, customerNote, sessionId,
    } = body;

    if (
      !items?.length || !email || !phone || !firstName || !lastName ||
      !street1 || !city || !state || !zip ||
      !shipping?.rateObjectId || shipping.amount === undefined
    ) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Fetch products from DB (prices are authoritative from server)
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, name: true, slug: true, price: true, sku: true, stock: true, weightGrams: true },
    });

    if (products.length !== productIds.length) {
      res.status(400).json({ error: 'One or more products not found or inactive' });
      return;
    }

    for (const item of items) {
      const product = products.find((p) => p.id === item.productId)!;
      if (product.stock < item.quantity) {
        res.status(400).json({ error: `Insufficient stock: ${product.name}` });
        return;
      }
    }

    // Calculate totals
    const subtotalUSD = items.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId)!;
      return sum + parseFloat(product.price.toString()) * item.quantity;
    }, 0);

    const taxRate = parseFloat(process.env.WIM_TAX_RATE ?? '0');
    const taxUSD = subtotalUSD * taxRate;
    const totalUSD = subtotalUSD + shipping.amount + taxUSD;
    const totalCents = Math.round(totalUSD * 100);

    // Determine box size for record-keeping
    const totalWeightGrams = items.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId)!;
      return sum + product.weightGrams * item.quantity;
    }, 0);
    const box = selectBox(totalWeightGrams);

    // Resolve customer (logged-in or guest)
    const firebaseUid = await resolveFirebaseUid(req);
    let customerId: string | null = null;
    let isGuestOrder = true;

    if (firebaseUid) {
      // Logged-in: find or create customer record
      const customer = await prisma.customer.upsert({
        where: { firebaseUid },
        update: { email, phone, firstName, lastName },
        create: { firebaseUid, email, phone, firstName, lastName, isGuest: false },
      });
      customerId = customer.id;
      isGuestOrder = false;
    } else {
      // Guest: find existing by email or create new guest record
      const existingGuest = await prisma.customer.findUnique({ where: { email } });
      if (existingGuest) {
        customerId = existingGuest.id;
        isGuestOrder = existingGuest.isGuest;
      } else {
        const guestCustomer = await prisma.customer.create({
          data: { email, phone, firstName, lastName, isGuest: true },
        });
        customerId = guestCustomer.id;
        isGuestOrder = true;
      }
    }

    const orderNumber = await generateOrderNumber();

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      receipt_email: email,
      metadata: { orderNumber },
    });

    // Create order + items in a transaction
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          customerId,
          isGuestOrder,
          email,
          phone,
          status: 'PENDING',
          paymentStatus: 'UNPAID',
          fulfillmentStatus: 'UNFULFILLED',
          subtotal: subtotalUSD,
          shippingCost: shipping.amount,
          tax: taxUSD,
          discount: 0,
          total: totalUSD,
          shipFirstName: firstName,
          shipLastName: lastName,
          shipStreet1: street1,
          shipStreet2: street2,
          shipCity: city,
          shipState: state,
          shipZip: zip,
          shipCountry: country ?? 'US',
          shipPhone: phone,
          shippingCarrier: shipping.carrier,
          shippingService: shipping.service,
          shippingRate: shipping as unknown as Prisma.InputJsonValue,
          selectedBoxSize: box.name,
          stripePaymentIntentId: paymentIntent.id,
          customerNote,
          items: {
            create: items.map((item) => {
              const product = products.find((p) => p.id === item.productId)!;
              const unitPrice = parseFloat(product.price.toString());
              return {
                productId: product.id,
                productName: product.name,
                productSku: product.sku,
                unitPrice,
                quantity: item.quantity,
                subtotal: unitPrice * item.quantity,
                weightGrams: product.weightGrams,
              };
            }),
          },
          statusHistory: {
            create: {
              status: 'PENDING',
              note: 'Order created, awaiting payment',
              createdBy: 'system',
            },
          },
        },
        include: { items: true },
      });

      return newOrder;
    });

    // Clean up guest cart if sessionId provided
    if (sessionId) {
      const guestCart = await prisma.cart.findFirst({ where: { sessionId } });
      if (guestCart) {
        await prisma.cart.delete({ where: { id: guestCart.id } });
      }
    }

    res.status(201).json({
      orderNumber: order.orderNumber,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      breakdown: {
        subtotal: parseFloat(subtotalUSD.toFixed(2)),
        shippingCost: parseFloat(shipping.amount.toFixed(2)),
        tax: parseFloat(taxUSD.toFixed(2)),
        total: parseFloat(totalUSD.toFixed(2)),
        totalCents,
      },
    });
  } catch (err) {
    console.error('POST /orders error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// GET /api/orders/my — order history for logged-in customer
router.get('/my', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { firebaseUid: req.user!.uid },
      select: { id: true },
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    const orders = await prisma.order.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        total: true,
        createdAt: true,
        shippingCarrier: true,
        shippingService: true,
        trackingNumber: true,
        _count: { select: { items: true } },
      },
    });

    res.json(orders);
  } catch (err) {
    console.error('GET /orders/my error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/:orderNumber — public order detail (used on confirmation page)
// No auth required — orderNumber acts as the access token for guests
router.get('/:orderNumber', async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber },
      include: {
        items: {
          include: {
            product: {
              select: {
                slug: true,
                images: { where: { isPrimary: true }, take: 1 },
              },
            },
          },
        },
        statusHistory: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.json(order);
  } catch (err) {
    console.error('GET /orders/:orderNumber error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
