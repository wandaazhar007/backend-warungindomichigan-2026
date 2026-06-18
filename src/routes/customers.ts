import { Router, Response } from 'express';
import { prisma } from '../config/prisma';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth';

const router = Router();

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

export default router;
