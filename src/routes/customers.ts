import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth';
import { stripe } from '../config/stripe';

const router = Router();

// Ensures the customer has a Stripe Customer object, creating one on first use.
// Returns the Stripe customer id (also persisted to Customer.stripeId).
async function getOrCreateStripeCustomerId(customerId: string): Promise<string> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  if (customer.stripeId) return customer.stripeId;

  const stripeCustomer = await stripe.customers.create({
    email: customer.email,
    name: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || undefined,
    metadata: { customerId: customer.id },
  });

  await prisma.customer.update({
    where: { id: customerId },
    data: { stripeId: stripeCustomer.id },
  });

  return stripeCustomer.id;
}

// POST /api/customers/register
// Called by frontend after Firebase signup/login to sync customer record
// Body: { email, firstName?, lastName?, phone? }
router.post('/register', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, firstName, lastName, phone } = req.body as {
      email: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
    };

    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }

    const customer = await prisma.customer.upsert({
      where: { firebaseUid: req.user!.uid },
      update: {
        email,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        phone: phone ?? undefined,
        isGuest: false,
      },
      create: {
        firebaseUid: req.user!.uid,
        email,
        firstName,
        lastName,
        phone,
        isGuest: false,
      },
    });

    res.status(201).json(customer);
  } catch (err) {
    console.error('POST /customers/register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/customers/me
router.get('/me', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { firebaseUid: req.user!.uid },
      include: {
        addresses: { orderBy: { isDefault: 'desc' } },
      },
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    res.json(customer);
  } catch (err) {
    console.error('GET /customers/me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/customers/me
router.put('/me', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, phone } = req.body as {
      firstName?: string;
      lastName?: string;
      phone?: string;
    };

    const customer = await prisma.customer.update({
      where: { firebaseUid: req.user!.uid },
      data: {
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        phone: phone ?? undefined,
      },
    });

    res.json(customer);
  } catch {
    res.status(404).json({ error: 'Customer not found' });
  }
});

// POST /api/customers/me/addresses
router.post('/me/addresses', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, street1, street2, city, state, zip, country, phone, isDefault } =
      req.body as {
        firstName: string;
        lastName: string;
        street1: string;
        street2?: string;
        city: string;
        state: string;
        zip: string;
        country?: string;
        phone?: string;
        isDefault?: boolean;
      };

    if (!firstName || !lastName || !street1 || !city || !state || !zip) {
      res.status(400).json({ error: 'firstName, lastName, street1, city, state, zip are required' });
      return;
    }

    const customer = await prisma.customer.findUnique({
      where: { firebaseUid: req.user!.uid },
      select: { id: true },
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    // If this address is default, unset existing defaults first
    if (isDefault) {
      await prisma.address.updateMany({
        where: { customerId: customer.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.create({
      data: {
        customerId: customer.id,
        firstName,
        lastName,
        street1,
        street2,
        city,
        state,
        zip,
        country: country ?? 'US',
        phone,
        isDefault: isDefault ?? false,
      },
    });

    res.status(201).json(address);
  } catch (err) {
    console.error('POST /customers/me/addresses error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/customers/me/addresses/:id
router.put('/me/addresses/:id', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, street1, street2, city, state, zip, country, phone, isDefault } =
      req.body as {
        firstName: string;
        lastName: string;
        street1: string;
        street2?: string;
        city: string;
        state: string;
        zip: string;
        country?: string;
        phone?: string;
        isDefault?: boolean;
      };

    if (!firstName || !lastName || !street1 || !city || !state || !zip) {
      res.status(400).json({ error: 'firstName, lastName, street1, city, state, zip are required' });
      return;
    }

    const customer = await prisma.customer.findUnique({
      where: { firebaseUid: req.user!.uid },
      select: { id: true },
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    // Only allow editing an address that belongs to this customer
    const existing = await prisma.address.findFirst({
      where: { id: req.params.id, customerId: customer.id },
      select: { id: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Address not found' });
      return;
    }

    if (isDefault) {
      await prisma.address.updateMany({
        where: { customerId: customer.id, isDefault: true, NOT: { id: req.params.id } },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.update({
      where: { id: req.params.id },
      data: {
        firstName,
        lastName,
        street1,
        street2,
        city,
        state,
        zip,
        country: country ?? 'US',
        phone,
        isDefault: isDefault ?? false,
      },
    });

    res.json(address);
  } catch (err) {
    console.error('PUT /customers/me/addresses/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/customers/me/addresses/:id/default — mark one address as the default
router.put('/me/addresses/:id/default', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { firebaseUid: req.user!.uid },
      select: { id: true },
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    const existing = await prisma.address.findFirst({
      where: { id: req.params.id, customerId: customer.id },
      select: { id: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Address not found' });
      return;
    }

    await prisma.$transaction([
      prisma.address.updateMany({
        where: { customerId: customer.id, isDefault: true },
        data: { isDefault: false },
      }),
      prisma.address.update({
        where: { id: req.params.id },
        data: { isDefault: true },
      }),
    ]);

    res.json({ updated: true });
  } catch (err) {
    console.error('PUT /customers/me/addresses/:id/default error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/customers/me/addresses/:id
router.delete('/me/addresses/:id', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { firebaseUid: req.user!.uid },
      select: { id: true },
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    // Only delete if address belongs to this customer
    const deleted = await prisma.address.deleteMany({
      where: { id: req.params.id, customerId: customer.id },
    });

    if (deleted.count === 0) {
      res.status(404).json({ error: 'Address not found' });
      return;
    }

    res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /customers/me/addresses/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/customers/me/payment-methods/setup-intent
// Creates (or reuses) the customer's Stripe Customer object and returns a
// SetupIntent clientSecret so the frontend can collect + save a card via Stripe Elements.
router.post('/me/payment-methods/setup-intent', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { firebaseUid: req.user!.uid },
      select: { id: true },
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    const stripeCustomerId = await getOrCreateStripeCustomerId(customer.id);

    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      usage: 'off_session',
      automatic_payment_methods: { enabled: true },
    });

    res.json({ clientSecret: setupIntent.client_secret });
  } catch (err) {
    console.error('POST /customers/me/payment-methods/setup-intent error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/customers/me/payment-methods
// Lists saved cards from Stripe, flagging which one is the default.
router.get('/me/payment-methods', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { firebaseUid: req.user!.uid },
      select: { id: true, stripeId: true },
    });

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    // No Stripe customer yet means no saved cards
    if (!customer.stripeId) {
      res.json([]);
      return;
    }

    const [paymentMethods, stripeCustomer] = await Promise.all([
      stripe.paymentMethods.list({ customer: customer.stripeId, type: 'card' }),
      stripe.customers.retrieve(customer.stripeId),
    ]);

    const defaultPaymentMethodId =
      !stripeCustomer.deleted && typeof stripeCustomer.invoice_settings?.default_payment_method === 'string'
        ? stripeCustomer.invoice_settings.default_payment_method
        : null;

    const result = paymentMethods.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
      isDefault: pm.id === defaultPaymentMethodId,
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /customers/me/payment-methods error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/customers/me/payment-methods/:id/default
router.put('/me/payment-methods/:id/default', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { firebaseUid: req.user!.uid },
      select: { stripeId: true },
    });

    if (!customer?.stripeId) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    // Verify the payment method actually belongs to this customer before trusting the id
    const pm = await stripe.paymentMethods.retrieve(req.params.id);
    if (pm.customer !== customer.stripeId) {
      res.status(404).json({ error: 'Payment method not found' });
      return;
    }

    await stripe.customers.update(customer.stripeId, {
      invoice_settings: { default_payment_method: req.params.id },
    });

    res.json({ updated: true });
  } catch (err) {
    console.error('PUT /customers/me/payment-methods/:id/default error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/customers/me/payment-methods/:id
router.delete('/me/payment-methods/:id', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { firebaseUid: req.user!.uid },
      select: { stripeId: true },
    });

    if (!customer?.stripeId) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    // Verify the payment method actually belongs to this customer before detaching
    const pm = await stripe.paymentMethods.retrieve(req.params.id);
    if (pm.customer !== customer.stripeId) {
      res.status(404).json({ error: 'Payment method not found' });
      return;
    }

    await stripe.paymentMethods.detach(req.params.id);

    res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /customers/me/payment-methods/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
