import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/prisma';

const SESSION_ID = 'sess_test_abc123';

const mockProduct = {
  id: 'prod_1', name: 'Indomie Goreng', slug: 'indomie-goreng',
  price: '3.99', stock: 100, isActive: true,
};

const mockCart = {
  id: 'cart_1', customerId: null, sessionId: SESSION_ID,
  items: [
    {
      id: 'item_1', cartId: 'cart_1', productId: 'prod_1', quantity: 2, price: '3.99',
      product: mockProduct,
    },
  ],
};

const mockEmptyCart = {
  id: 'cart_1', customerId: null, sessionId: SESSION_ID, items: [],
};

describe('GET /api/cart', () => {
  it('returns empty cart for new session', async () => {
    vi.mocked(prisma.cart.findFirst).mockResolvedValue(null);

    const res = await request(app)
      .get('/api/cart')
      .set('x-session-id', SESSION_ID);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('returns existing cart items for known session', async () => {
    vi.mocked(prisma.cart.findFirst).mockResolvedValue(mockCart as never);

    const res = await request(app)
      .get('/api/cart')
      .set('x-session-id', SESSION_ID);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].productId).toBe('prod_1');
    expect(res.body.items[0].quantity).toBe(2);
  });
});

describe('POST /api/cart/items', () => {
  beforeEach(() => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct as never);
  });

  it('adds item to cart and returns updated cart', async () => {
    vi.mocked(prisma.cart.findFirst).mockResolvedValueOnce(null); // no existing cart
    vi.mocked(prisma.cart.create).mockResolvedValue(mockEmptyCart as never);
    vi.mocked(prisma.cartItem.upsert).mockResolvedValue({
      id: 'item_new', cartId: 'cart_1', productId: 'prod_1', quantity: 1, price: '3.99',
    } as never);
    vi.mocked(prisma.cart.findFirst).mockResolvedValueOnce({
      ...mockEmptyCart,
      items: [{ id: 'item_new', productId: 'prod_1', quantity: 1, price: '3.99', product: mockProduct }],
    } as never);

    const res = await request(app)
      .post('/api/cart/items')
      .set('x-session-id', SESSION_ID)
      .send({ productId: 'prod_1', quantity: 1 });

    expect(res.status).toBe(201);
  });

  it('returns 400 for missing productId', async () => {
    const res = await request(app)
      .post('/api/cart/items')
      .set('x-session-id', SESSION_ID)
      .send({ quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for quantity less than 1', async () => {
    const res = await request(app)
      .post('/api/cart/items')
      .set('x-session-id', SESSION_ID)
      .send({ productId: 'prod_1', quantity: 0 });

    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent product', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/cart/items')
      .set('x-session-id', SESSION_ID)
      .send({ productId: 'prod_nonexistent', quantity: 1 });

    expect(res.status).toBe(404);
  });

  it('returns 400 when adding more than available stock', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ ...mockProduct, stock: 2 } as never);

    const res = await request(app)
      .post('/api/cart/items')
      .set('x-session-id', SESSION_ID)
      .send({ productId: 'prod_1', quantity: 99 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stock/i);
  });
});
