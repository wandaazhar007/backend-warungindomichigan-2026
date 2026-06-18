import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { stripe } from '../src/config/stripe';

const VALID_ORDER_BODY = {
  email:     'budi@example.com',
  phone:     '+1 626 461 4963',
  firstName: 'Budi',
  lastName:  'Santoso',
  street1:   '123 Main St',
  city:      'Detroit',
  state:     'MI',
  zip:       '48201',
  country:   'US',
  shipping: {
    rateObjectId:  'rate_test_001',
    carrier:       'USPS',
    service:       'Priority Mail',
    amount:        12.50,
    estimatedDays: 3,
  },
  items: [
    { productId: 'prod_1', quantity: 2 },
    { productId: 'prod_2', quantity: 1 },
  ],
};

const mockProducts = [
  { id: 'prod_1', name: 'Indomie Goreng', sku: 'IMI-001', price: '3.99', stock: 100, weightGrams: 400, slug: 'indomie-goreng', isActive: true },
  { id: 'prod_2', name: 'Sambal ABC',     sku: 'SBL-001', price: '2.50', stock: 50,  weightGrams: 350, slug: 'sambal-abc',     isActive: true },
];

describe('POST /api/orders', () => {
  beforeEach(() => {
    vi.mocked(prisma.product.findMany).mockResolvedValue(mockProducts as never);
    vi.mocked(prisma.order.count).mockResolvedValue(0);
    vi.mocked(stripe.paymentIntents.create).mockResolvedValue({
      id:            'pi_test123',
      client_secret: 'pi_test123_secret_xyz',
    } as never);
    // Mock the transaction to return a created order
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const mockTx = {
        order: {
          create: vi.fn().mockResolvedValue({
            id:          'order_1',
            orderNumber: 'WIM-2026-0001',
            email:       'budi@example.com',
            items:       [],
          }),
        },
        orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
        product:            { update: vi.fn().mockResolvedValue({}) },
        customer: {
          upsert:     vi.fn().mockResolvedValue({ id: 'cust_1' }),
          findUnique: vi.fn().mockResolvedValue(null),
          create:     vi.fn().mockResolvedValue({ id: 'cust_guest' }),
        },
      };
      return fn(mockTx);
    });
    vi.mocked(prisma.cart.findFirst).mockResolvedValue(null);
    // Guest order path: no existing customer → create one
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.customer.create).mockResolvedValue({ id: 'cust_guest' } as never);
  });

  it('creates order and returns clientSecret + orderNumber', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send(VALID_ORDER_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('orderNumber');
    expect(res.body).toHaveProperty('clientSecret');
    expect(res.body).toHaveProperty('paymentIntentId');
    expect(res.body).toHaveProperty('breakdown');
    expect(res.body.breakdown).toMatchObject({
      subtotal:     expect.any(Number),
      shippingCost: 12.5,
      total:        expect.any(Number),
      totalCents:   expect.any(Number),
    });
  });

  it('calculates correct subtotal from DB prices', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send(VALID_ORDER_BODY);

    expect(res.status).toBe(201);
    // subtotal = (3.99 × 2) + (2.50 × 1) = 10.48
    expect(res.body.breakdown.subtotal).toBeCloseTo(10.48, 2);
  });

  it('calculates correct totalCents for Stripe', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send(VALID_ORDER_BODY);

    // total = 10.48 + 12.50 = 22.98 → totalCents = 2298
    expect(res.body.breakdown.totalCents).toBe(2298);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ email: 'budi@example.com' }); // missing most required fields

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when product is not found', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProducts[0]] as never); // only 1 of 2

    const res = await request(app)
      .post('/api/orders')
      .send(VALID_ORDER_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 when stock is insufficient', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { ...mockProducts[0], stock: 1 }, // only 1 in stock but ordering 2
      mockProducts[1],
    ] as never);

    const res = await request(app)
      .post('/api/orders')
      .send(VALID_ORDER_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stock/i);
  });

  it('calls stripe.paymentIntents.create with correct amount in cents', async () => {
    await request(app).post('/api/orders').send(VALID_ORDER_BODY);

    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount:   2298,
        currency: 'usd',
      })
    );
  });
});
