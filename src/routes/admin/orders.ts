import { Response } from 'express';
import { Prisma, OrderStatus } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { stripe } from '../../config/stripe';
import { AuthRequest } from '../../middleware/auth';
import { sendOrderShippedEmail } from '../../lib/email';

const router = Router();

// GET /api/admin/orders
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page   = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit  = Math.min(100, parseInt(req.query.limit as string) || 20);
    const skip   = (page - 1) * limit;
    const { status, paymentStatus, search } = req.query as Record<string, string>;

    const where: Prisma.OrderWhereInput = {};
    if (status)        where.status        = status as OrderStatus;
    if (paymentStatus) where.paymentStatus = paymentStatus as Prisma.EnumPaymentStatusFilter['equals'];
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { email:       { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id:               true,
          orderNumber:      true,
          email:            true,
          status:           true,
          paymentStatus:    true,
          fulfillmentStatus: true,
          total:            true,
          shippingCarrier:  true,
          shippingService:  true,
          trackingNumber:   true,
          isGuestOrder:     true,
          createdAt:        true,
          paidAt:           true,
          customer: { select: { firstName: true, lastName: true } },
          _count:   { select: { items: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    res.json({ data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('GET /admin/orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/orders/:orderNumber
router.get('/:orderNumber', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({
      where:   { orderNumber: req.params.orderNumber },
      include: {
        customer:      true,
        items: {
          include: {
            product: { select: { slug: true, images: { where: { isPrimary: true }, take: 1 } } },
          },
        },
        statusHistory: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    res.json(order);
  } catch (err) {
    console.error('GET /admin/orders/:orderNumber error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/orders/:orderNumber/status
router.put('/:orderNumber/status', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, note } = req.body as { status: OrderStatus; note?: string };

    if (!status) { res.status(400).json({ error: 'status is required' }); return; }

    const order = await prisma.order.update({
      where: { orderNumber: req.params.orderNumber },
      data:  {
        status,
        statusHistory: {
          create: {
            status,
            note:      note ?? null,
            createdBy: req.user?.uid ?? 'admin',
          },
        },
      },
    });

    res.json(order);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      res.status(404).json({ error: 'Order not found' }); return;
    }
    console.error('PUT /admin/orders/:orderNumber/status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/orders/:orderNumber/tracking
router.put('/:orderNumber/tracking', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { trackingNumber, trackingUrl, shippedAt } = req.body as {
      trackingNumber: string; trackingUrl?: string; shippedAt?: string;
    };

    if (!trackingNumber) { res.status(400).json({ error: 'trackingNumber is required' }); return; }

    // Fetch current order — need status + email fields for the shipped notification
    const existing = await prisma.order.findUnique({
      where:  { orderNumber: req.params.orderNumber },
      select: {
        status:          true,
        email:           true,
        shipFirstName:   true,
        shipLastName:    true,
        shipStreet1:     true,
        shipStreet2:     true,
        shipCity:        true,
        shipState:       true,
        shipZip:         true,
        subtotal:        true,
        shippingCost:    true,
        tax:             true,
        total:           true,
        shippingCarrier: true,
        shippingService: true,
        items: {
          select: {
            productName: true,
            quantity:    true,
            unitPrice:   true,
            subtotal:    true,
          },
        },
      },
    });
    if (!existing) { res.status(404).json({ error: 'Order not found' }); return; }

    const shouldShip = existing.status === 'PROCESSING' || existing.status === 'CONFIRMED';
    const now        = new Date();

    const order = await prisma.order.update({
      where: { orderNumber: req.params.orderNumber },
      data:  {
        trackingNumber,
        trackingUrl:   trackingUrl ?? null,
        shippedAt:     shippedAt ? new Date(shippedAt) : (shouldShip ? now : undefined),
        ...(shouldShip && { status: 'SHIPPED' }),
        ...(shouldShip && {
          statusHistory: {
            create: {
              status:    'SHIPPED',
              note:      `Tracking: ${trackingNumber}`,
              createdBy: req.user?.uid ?? 'admin',
            },
          },
        }),
      },
    });

    // Send shipped notification when status transitions to SHIPPED
    if (shouldShip) {
      try {
        await sendOrderShippedEmail({
          orderNumber:     order.orderNumber,
          firstName:       existing.shipFirstName,
          email:           existing.email,
          items:           existing.items.map((i) => ({
            productName: i.productName,
            quantity:    i.quantity,
            unitPrice:   i.unitPrice.toString(),
            subtotal:    i.subtotal.toString(),
          })),
          subtotal:        existing.subtotal.toString(),
          shippingCost:    existing.shippingCost.toString(),
          tax:             existing.tax.toString(),
          total:           existing.total.toString(),
          shipFirstName:   existing.shipFirstName,
          shipLastName:    existing.shipLastName,
          shipStreet1:     existing.shipStreet1,
          shipStreet2:     existing.shipStreet2,
          shipCity:        existing.shipCity,
          shipState:       existing.shipState,
          shipZip:         existing.shipZip,
          shippingCarrier: existing.shippingCarrier,
          shippingService: existing.shippingService,
          trackingNumber,
          trackingUrl:     trackingUrl ?? null,
        });
      } catch (emailErr) {
        // Non-critical — log but don't fail the response
        console.error(`Failed to send shipped email for ${order.orderNumber}:`, emailErr);
      }
    }

    res.json(order);
  } catch (err) {
    console.error('PUT /admin/orders/:orderNumber/tracking error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/orders/:orderNumber/refund
router.post('/:orderNumber/refund', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({
      where:  { orderNumber: req.params.orderNumber },
      select: { id: true, stripePaymentIntentId: true, paymentStatus: true },
    });

    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (!order.stripePaymentIntentId) {
      res.status(400).json({ error: 'No Stripe PaymentIntent linked to this order' }); return;
    }
    if (order.paymentStatus === 'REFUNDED') {
      res.status(409).json({ error: 'Order already refunded' }); return;
    }

    // Issue full refund via Stripe
    const refund = await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
    });

    // Update order status and add history entry
    const updated = await prisma.order.update({
      where: { id: order.id },
      data:  {
        paymentStatus: 'REFUNDED',
        status:        'REFUNDED',
        statusHistory: {
          create: {
            status:    'REFUNDED',
            note:      `Stripe refund ID: ${refund.id}`,
            createdBy: req.user?.uid ?? 'admin',
          },
        },
      },
    });

    res.json({ order: updated, refundId: refund.id });
  } catch (err) {
    console.error('POST /admin/orders/:orderNumber/refund error:', err);
    res.status(500).json({ error: 'Refund failed' });
  }
});

// PUT /api/admin/orders/:orderNumber/note
router.put('/:orderNumber/note', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { adminNote } = req.body as { adminNote: string };

    const order = await prisma.order.update({
      where: { orderNumber: req.params.orderNumber },
      data:  { adminNote: adminNote ?? null },
    });

    res.json(order);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      res.status(404).json({ error: 'Order not found' }); return;
    }
    console.error('PUT /admin/orders/:orderNumber/note error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
