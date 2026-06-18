import { vi, beforeEach } from 'vitest';

// Clear all mock state between tests so call counts don't bleed across tests
beforeEach(() => {
  vi.clearAllMocks();
});

// ── Prisma mock ──────────────────────────────────────────────────────────────
// All model methods are mocked as vi.fn() — tests override per-case with mockResolvedValue
vi.mock('../src/config/prisma', () => ({
  prisma: {
    product: {
      findMany:  vi.fn(),
      findUnique: vi.fn(),
      count:     vi.fn(),
      create:    vi.fn(),
      update:    vi.fn(),
      delete:    vi.fn(),
      upsert:    vi.fn(),
    },
    category: {
      findMany:  vi.fn(),
      findUnique: vi.fn(),
      count:     vi.fn(),
      create:    vi.fn(),
      update:    vi.fn(),
      delete:    vi.fn(),
    },
    cart: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      delete:     vi.fn(),
    },
    cartItem: {
      findFirst:  vi.fn(),
      findUnique: vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      delete:     vi.fn(),
      upsert:     vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
      findFirst:  vi.fn(),
      create:     vi.fn(),
      upsert:     vi.fn(),
      update:     vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
      findFirst:  vi.fn(),
      findMany:   vi.fn(),
      count:      vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      aggregate:  vi.fn(),
    },
    orderStatusHistory: {
      create: vi.fn(),
    },
    productImage: {
      findUnique: vi.fn(),
      create:     vi.fn(),
      delete:     vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({
      order:              { create: vi.fn(), update: vi.fn() },
      orderStatusHistory: { create: vi.fn() },
      product:            { update: vi.fn() },
      customer:           { upsert: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    })),
    $queryRaw: vi.fn(),
  },
}));

// ── Firebase Admin mock ───────────────────────────────────────────────────────
// The auth object is created once inside the factory so auth() always returns
// the same reference — essential for vi.mocked(admin.auth().verifyIdToken) to work.
vi.mock('../src/config/firebase', () => {
  const authObj = {
    verifyIdToken: vi.fn().mockResolvedValue({
      uid:   'test-uid-123',
      email: 'test@example.com',
      role:  'customer',
    }),
  };
  return { admin: { auth: () => authObj } };
});

// ── Stripe mock ───────────────────────────────────────────────────────────────
vi.mock('../src/config/stripe', () => ({
  stripe: {
    paymentIntents: {
      create:   vi.fn().mockResolvedValue({ id: 'pi_test123', client_secret: 'pi_test123_secret_xyz' }),
      retrieve: vi.fn(),
      update:   vi.fn(),
    },
    refunds: {
      create: vi.fn().mockResolvedValue({ id: 're_test123' }),
    },
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
}));

// ── Shippo mock ───────────────────────────────────────────────────────────────
vi.mock('../src/config/shippo', async () => {
  const actual = await vi.importActual('../src/config/shippo') as object;
  return {
    ...actual,
    getShippingRates: vi.fn().mockResolvedValue([
      {
        object_id:     'rate_test_001',
        amount:        '12.50',
        currency:      'USD',
        provider:      'USPS',
        servicelevel:  { name: 'Priority Mail', token: 'usps_priority' },
        estimated_days: 3,
        duration_terms: null,
        attributes:    [],
      },
    ]),
  };
});

// ── Resend mock ───────────────────────────────────────────────────────────────
vi.mock('resend', () => {
  // Use a proper class so `new Resend()` works
  class MockResend {
    emails = { send: vi.fn().mockResolvedValue({ id: 'email_test_123' }) };
  }
  return { Resend: MockResend };
});
