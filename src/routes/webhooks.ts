import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { stripe } from '../config/stripe';
import { prisma } from '../config/prisma';
import { sendOrderConfirmationEmail, sendPaymentFailedEmail } from '../lib/email';

const router = Router();

// POST /api/webhooks/stripe
// Raw body is parsed by the express.raw() middleware set up in app.ts BEFORE express.json()
router.post('/stripe', async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  // Verify webhook signature when secret is configured
  if (webhookSecret) {
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err);
      res.status(400).json({ error: 'Webhook signature verification failed' });
      return;
    }
  } else {
    // Dev mode: parse raw body manually (no signature check)
    try {
      event = JSON.parse((req.body as Buffer).toString()) as Stripe.Event;
    } catch {
      res.status(400).json({ error: 'Invalid webhook payload' });
      return;
    }
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
      break;

    default:
      // Ignore unhandled event types
      break;
  }

  res.json({ received: true });
});

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { stripePaymentIntentId: paymentIntent.id },
    include: {
      items: {
        include: { product: { select: { id: true, name: true } } },
      },
    },
  });

  if (!order) {
    console.error(`Stripe webhook: order not found for PaymentIntent ${paymentIntent.id}`);
    return;
  }

  // Idempotency guard — skip if already paid
  if (order.paymentStatus === 'PAID') return;

  await prisma.$transaction(async (tx) => {
    // Update order payment & status
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
        stripeChargeId: paymentIntent.latest_charge as string ?? null,
        paidAt: new Date(),
      },
    });

    // Record status change
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: 'CONFIRMED',
        note: `Payment confirmed via Stripe (${paymentIntent.id})`,
        createdBy: 'system',
      },
    });

    // Decrement stock for each item
    for (const item of order.items) {
      if (!item.productId) continue;
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });
    }
  });

  // Send confirmation email (outside transaction — non-critical)
  try {
    await sendOrderConfirmationEmail({
      orderNumber: order.orderNumber,
      firstName: order.shipFirstName,
      email: order.email,
      items: order.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toString(),
        subtotal: i.subtotal.toString(),
      })),
      subtotal: order.subtotal.toString(),
      shippingCost: order.shippingCost.toString(),
      tax: order.tax.toString(),
      total: order.total.toString(),
      shipFirstName: order.shipFirstName,
      shipLastName: order.shipLastName,
      shipStreet1: order.shipStreet1,
      shipStreet2: order.shipStreet2,
      shipCity: order.shipCity,
      shipState: order.shipState,
      shipZip: order.shipZip,
      shippingCarrier: order.shippingCarrier,
      shippingService: order.shippingService,
    });
  } catch (emailErr) {
    // Log but don't fail — order is already confirmed
    console.error(`Failed to send confirmation email for ${order.orderNumber}:`, emailErr);
  }

  console.log(`Order ${order.orderNumber} confirmed — payment ${paymentIntent.id}`);
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { stripePaymentIntentId: paymentIntent.id },
    select: { id: true, orderNumber: true, email: true, shipFirstName: true, paymentStatus: true },
  });

  if (!order || order.paymentStatus === 'PAID') return;

  await prisma.order.update({
    where: { id: order.id },
    data: { paymentStatus: 'FAILED', status: 'CANCELLED' },
  });

  await prisma.orderStatusHistory.create({
    data: {
      orderId: order.id,
      status: 'CANCELLED',
      note: `Payment failed (${paymentIntent.id})`,
      createdBy: 'system',
    },
  });

  // Notify customer about failed payment
  try {
    await sendPaymentFailedEmail(order.email, order.orderNumber, order.shipFirstName);
  } catch (emailErr) {
    console.error(`Failed to send payment-failed email for ${order.orderNumber}:`, emailErr);
  }

  console.log(`Order ${order.orderNumber} cancelled — payment failed`);
}

export default router;
