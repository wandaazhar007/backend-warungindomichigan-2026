import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { stripe } from '../config/stripe';

const router = Router();

interface CartItemInput {
  productId: string;
  quantity: number;
}

interface CreateIntentBody {
  items: CartItemInput[];
  shippingCost: number;  // in USD dollars
  email: string;
}

// POST /api/payments/create-intent
// Creates a Stripe PaymentIntent for the given cart + shipping cost
router.post('/create-intent', async (req: Request, res: Response): Promise<void> => {
  try {
    const { items, shippingCost, email } = req.body as CreateIntentBody;

    if (!items?.length || shippingCost === undefined || !email) {
      res.status(400).json({ error: 'items, shippingCost, and email are required' });
      return;
    }

    if (shippingCost < 0) {
      res.status(400).json({ error: 'shippingCost must be >= 0' });
      return;
    }

    // Fetch current prices from DB (never trust client-sent prices)
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, price: true, stock: true, name: true },
    });

    if (products.length !== productIds.length) {
      res.status(400).json({ error: 'One or more products not found or inactive' });
      return;
    }

    // Final stock check
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product || product.stock < item.quantity) {
        res.status(400).json({ error: `Insufficient stock for product ${item.productId}` });
        return;
      }
    }

    // Calculate subtotal in USD
    const subtotalUSD = items.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId)!;
      return sum + parseFloat(product.price.toString()) * item.quantity;
    }, 0);

    const taxRate = parseFloat(process.env.WIM_TAX_RATE ?? '0');
    const taxUSD = subtotalUSD * taxRate;
    const totalUSD = subtotalUSD + shippingCost + taxUSD;

    // Stripe amounts are in cents (integer)
    const totalCents = Math.round(totalUSD * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      receipt_email: email,
      metadata: {
        subtotal: subtotalUSD.toFixed(2),
        shippingCost: shippingCost.toFixed(2),
        tax: taxUSD.toFixed(2),
        itemCount: items.reduce((s, i) => s + i.quantity, 0).toString(),
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      breakdown: {
        subtotal: parseFloat(subtotalUSD.toFixed(2)),
        shippingCost: parseFloat(shippingCost.toFixed(2)),
        tax: parseFloat(taxUSD.toFixed(2)),
        total: parseFloat(totalUSD.toFixed(2)),
        totalCents,
      },
    });
  } catch (err) {
    console.error('POST /payments/create-intent error:', err);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// POST /api/payments/update-intent
// Called when user changes shipping method — updates existing PaymentIntent amount
router.post('/update-intent', async (req: Request, res: Response): Promise<void> => {
  try {
    const { paymentIntentId, items, shippingCost } = req.body as {
      paymentIntentId: string;
      items: CartItemInput[];
      shippingCost: number;
    };

    if (!paymentIntentId || !items?.length || shippingCost === undefined) {
      res.status(400).json({ error: 'paymentIntentId, items, and shippingCost are required' });
      return;
    }

    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, price: true },
    });

    const subtotalUSD = items.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId)!;
      return sum + parseFloat(product.price.toString()) * item.quantity;
    }, 0);

    const taxRate = parseFloat(process.env.WIM_TAX_RATE ?? '0');
    const taxUSD = subtotalUSD * taxRate;
    const totalUSD = subtotalUSD + shippingCost + taxUSD;
    const totalCents = Math.round(totalUSD * 100);

    await stripe.paymentIntents.update(paymentIntentId, {
      amount: totalCents,
      metadata: {
        subtotal: subtotalUSD.toFixed(2),
        shippingCost: shippingCost.toFixed(2),
        tax: taxUSD.toFixed(2),
      },
    });

    res.json({
      breakdown: {
        subtotal: parseFloat(subtotalUSD.toFixed(2)),
        shippingCost: parseFloat(shippingCost.toFixed(2)),
        tax: parseFloat(taxUSD.toFixed(2)),
        total: parseFloat(totalUSD.toFixed(2)),
        totalCents,
      },
    });
  } catch (err) {
    console.error('POST /payments/update-intent error:', err);
    res.status(500).json({ error: 'Failed to update payment intent' });
  }
});

export default router;
