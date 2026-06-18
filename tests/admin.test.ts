import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/prisma';
import { admin } from '../src/config/firebase';

const ADMIN_TOKEN = 'Bearer valid_admin_token';
const USER_TOKEN  = 'Bearer valid_user_token';

// Helper to mock Firebase token verification
function mockAdminVerify() {
  vi.mocked(admin.auth().verifyIdToken).mockResolvedValue({
    uid: 'admin-uid-001', email: 'admin@wim.com',
    role: 'admin', adminRole: 'SUPER_ADMIN',
  } as never);
}

function mockUserVerify() {
  vi.mocked(admin.auth().verifyIdToken).mockResolvedValue({
    uid: 'user-uid-001', email: 'user@example.com',
    role: 'customer',
  } as never);
}

describe('Admin route auth guards', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
  });

  it('returns 403 when token belongs to non-admin user', async () => {
    mockUserVerify();
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', USER_TOKEN);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/dashboard', () => {
  beforeEach(() => {
    mockAdminVerify();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    vi.mocked(prisma.order.count).mockResolvedValue(5);
    vi.mocked(prisma.product.count).mockResolvedValue(3);
    vi.mocked(prisma.order.aggregate).mockResolvedValue({ _sum: { total: '1250.00' } } as never);
  });

  it('returns 200 with stats shape for admin user', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalRevenue');
    expect(res.body).toHaveProperty('ordersToday');
    expect(res.body).toHaveProperty('pendingOrders');
    expect(res.body).toHaveProperty('lowStockCount');
    expect(res.body).toHaveProperty('revenueByDay');
    expect(res.body).toHaveProperty('topProducts');
    expect(Array.isArray(res.body.revenueByDay)).toBe(true);
  });
});

describe('GET /api/admin/products', () => {
  const mockAdminProducts = [
    {
      id: 'prod_1', name: 'Indomie Goreng', slug: 'indomie-goreng',
      price: '3.99', stock: 100, minStock: 5, isActive: true, isFeatured: true,
      category: { name: 'Mie & Bubur' }, images: [], sku: null, tags: [],
      weightGrams: 400, comparePrice: null, unit: 'pack', createdAt: new Date(),
    },
  ];

  beforeEach(() => {
    mockAdminVerify();
    vi.mocked(prisma.product.findMany).mockResolvedValue(mockAdminProducts as never);
    vi.mocked(prisma.product.count).mockResolvedValue(1);
  });

  it('returns paginated product list with meta', async () => {
    const res = await request(app)
      .get('/api/admin/products')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/admin/orders', () => {
  const mockOrders = [
    {
      id: 'order_1', orderNumber: 'WIM-2026-0001',
      email: 'budi@example.com', status: 'CONFIRMED', paymentStatus: 'PAID',
      fulfillmentStatus: 'UNFULFILLED', total: '22.98', isGuestOrder: false,
      shippingCarrier: 'USPS', shippingService: 'Priority Mail',
      trackingNumber: null, createdAt: new Date(), paidAt: new Date(),
      customer: { firstName: 'Budi', lastName: 'Santoso' },
      _count: { items: 2 },
    },
  ];

  beforeEach(() => {
    mockAdminVerify();
    vi.mocked(prisma.order.findMany).mockResolvedValue(mockOrders as never);
    vi.mocked(prisma.order.count).mockResolvedValue(1);
  });

  it('returns paginated order list with meta', async () => {
    const res = await request(app)
      .get('/api/admin/orders')
      .set('Authorization', ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].orderNumber).toBe('WIM-2026-0001');
    expect(res.body.meta.total).toBe(1);
  });

  it('filters by status query param', async () => {
    await request(app)
      .get('/api/admin/orders?status=CONFIRMED')
      .set('Authorization', ADMIN_TOKEN);

    const callArgs = vi.mocked(prisma.order.findMany).mock.calls[0][0] as {
      where: { status?: string };
    };
    expect(callArgs.where.status).toBe('CONFIRMED');
  });
});

describe('PUT /api/admin/orders/:orderNumber/status', () => {
  beforeEach(() => {
    mockAdminVerify();
    vi.mocked(prisma.order.update).mockResolvedValue({
      id: 'order_1', orderNumber: 'WIM-2026-0001', status: 'PROCESSING',
    } as never);
  });

  it('updates order status and returns updated order', async () => {
    const res = await request(app)
      .put('/api/admin/orders/WIM-2026-0001/status')
      .set('Authorization', ADMIN_TOKEN)
      .send({ status: 'PROCESSING', note: 'Sedang dipacking' });

    expect(res.status).toBe(200);
  });

  it('returns 400 when status field is missing', async () => {
    const res = await request(app)
      .put('/api/admin/orders/WIM-2026-0001/status')
      .set('Authorization', ADMIN_TOKEN)
      .send({});

    expect(res.status).toBe(400);
  });
});
