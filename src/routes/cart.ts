import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth';
import { admin } from '../config/firebase';

const router = Router();

// Resolve cart identity: returns customerId (logged-in) or sessionId (guest)
// Tries to verify token but does not block if absent — allows both guest and auth
async function resolveCartOwner(
  req: Request
): Promise<{ customerId?: string; sessionId?: string }> {
  const authHeader = req.headers.authorization;
  const sessionId = (req.headers['x-session-id'] as string) || undefined;

  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.split('Bearer ')[1];
      const decoded = await admin.auth().verifyIdToken(token);
      const customer = await prisma.customer.findUnique({
        where: { firebaseUid: decoded.uid },
        select: { id: true },
      });
      if (customer) return { customerId: customer.id };
    } catch {
      // Token invalid — fall through to guest
    }
  }

  return { sessionId };
}

// GET /api/cart
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { customerId, sessionId } = await resolveCartOwner(req);

    if (!customerId && !sessionId) {
      res.json({ items: [] });
      return;
    }

    const cart = await prisma.cart.findFirst({
      where: customerId ? { customerId } : { sessionId },
      include: {
        items: {
          include: {
            product: {
              include: {
                images: {
                  where: { isPrimary: true },
                  take: 1,
                },
                category: { select: { name: true, slug: true } },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    res.json(cart ?? { items: [] });
  } catch (err) {
    console.error('GET /cart error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cart/items — add item to cart (creates cart if needed)
// Body: { productId, quantity, sessionId? }
router.post('/items', async (req: Request, res: Response): Promise<void> => {
  try {
    const { productId, quantity, sessionId: bodySessionId } = req.body as {
      productId: string;
      quantity: number;
      sessionId?: string;
    };

    if (!productId || !quantity || quantity < 1) {
      res.status(400).json({ error: 'productId and quantity (>= 1) are required' });
      return;
    }

    const product = await prisma.product.findUnique({
      where: { id: productId, isActive: true },
    });

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    if (product.stock < quantity) {
      res.status(400).json({ error: 'Insufficient stock' });
      return;
    }

    const { customerId, sessionId: headerSessionId } = await resolveCartOwner(req);
    const sessionId = bodySessionId || headerSessionId;

    if (!customerId && !sessionId) {
      res.status(400).json({ error: 'sessionId is required for guest cart' });
      return;
    }

    // Find or create cart
    let cart = await prisma.cart.findFirst({
      where: customerId ? { customerId } : { sessionId },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: customerId
          ? { customerId }
          : {
              sessionId,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days for guest
            },
      });
    }

    // Upsert: increase qty if item already in cart
    const existing = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId },
    });

    let cartItem;
    if (existing) {
      cartItem = await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + quantity },
      });
    } else {
      cartItem = await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          quantity,
          price: product.price,
        },
      });
    }

    res.status(201).json(cartItem);
  } catch (err) {
    console.error('POST /cart/items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/cart/items/:id — update quantity
// Body: { quantity }
router.put('/items/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { quantity } = req.body as { quantity: number };

    if (quantity === undefined || quantity < 0) {
      res.status(400).json({ error: 'quantity must be >= 0' });
      return;
    }

    const existing = await prisma.cartItem.findUnique({
      where: { id: req.params.id },
      include: { product: { select: { stock: true } } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Cart item not found' });
      return;
    }

    // quantity 0 means remove
    if (quantity === 0) {
      await prisma.cartItem.delete({ where: { id: existing.id } });
      res.json({ deleted: true });
      return;
    }

    if (existing.product.stock < quantity) {
      res.status(400).json({ error: 'Insufficient stock' });
      return;
    }

    const updated = await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity },
    });

    res.json(updated);
  } catch (err) {
    console.error('PUT /cart/items/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/cart/items/:id
router.delete('/items/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.cartItem.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch {
    res.status(404).json({ error: 'Cart item not found' });
  }
});

// POST /api/cart/merge — merge guest cart into logged-in customer cart
// Requires auth. Body: { sessionId }
router.post('/merge', verifyFirebaseToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.body as { sessionId: string };

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
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

    const guestCart = await prisma.cart.findFirst({
      where: { sessionId },
      include: { items: true },
    });

    if (!guestCart || guestCart.items.length === 0) {
      res.json({ merged: 0 });
      return;
    }

    // Find or create customer cart
    let customerCart = await prisma.cart.findFirst({
      where: { customerId: customer.id },
      include: { items: true },
    });

    if (!customerCart) {
      customerCart = await prisma.cart.create({
        data: { customerId: customer.id },
        include: { items: true },
      });
    }

    // Merge: add or accumulate quantities
    for (const guestItem of guestCart.items) {
      const existingItem = customerCart.items.find(
        (i) => i.productId === guestItem.productId
      );

      if (existingItem) {
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: existingItem.quantity + guestItem.quantity },
        });
      } else {
        await prisma.cartItem.create({
          data: {
            cartId: customerCart.id,
            productId: guestItem.productId,
            quantity: guestItem.quantity,
            price: guestItem.price,
          },
        });
      }
    }

    // Delete guest cart after merge
    await prisma.cart.delete({ where: { id: guestCart.id } });

    res.json({ merged: guestCart.items.length });
  } catch (err) {
    console.error('POST /cart/merge error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
