import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/prisma';

const mockProducts = [
  {
    id: 'prod_1', name: 'Indomie Goreng', slug: 'indomie-goreng',
    description: 'Mie instan goreng', price: '3.99', comparePrice: '4.99',
    unit: 'pack', stock: 100, minStock: 5, sku: 'IMI-001', weightGrams: 400,
    isActive: true, isFeatured: true, tags: ['bestseller'],
    category: { id: 'cat_1', name: 'Mie & Bubur', slug: 'mie-bubur', icon: '🍜' },
    images: [{ id: 'img_1', url: 'https://example.com/img.jpg', altText: null, isPrimary: true, sortOrder: 0 }],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'prod_2', name: 'Sambal ABC', slug: 'sambal-abc',
    description: null, price: '2.50', comparePrice: null,
    unit: 'botol', stock: 3, minStock: 5, sku: 'SBL-001', weightGrams: 350,
    isActive: true, isFeatured: false, tags: [],
    category: { id: 'cat_2', name: 'Sambal & Saus', slug: 'sambal-saus', icon: '🌶️' },
    images: [],
    createdAt: new Date().toISOString(),
  },
];

describe('GET /api/products', () => {
  beforeEach(() => {
    vi.mocked(prisma.product.findMany).mockResolvedValue(mockProducts as never);
    vi.mocked(prisma.product.count).mockResolvedValue(2);
  });

  it('returns paginated product list with meta', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toMatchObject({ total: 2, page: 1, limit: 20, totalPages: 1 });
    expect(res.body.data).toHaveLength(2);
  });

  it('passes search param to prisma where clause', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProducts[0]] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(1);

    const res = await request(app).get('/api/products?search=indomie');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // Verify prisma was called with a search filter
    const callArgs = vi.mocked(prisma.product.findMany).mock.calls[0][0] as { where: unknown };
    expect(JSON.stringify(callArgs.where)).toContain('indomie');
  });

  it('filters by featured=true', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([mockProducts[0]] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(1);

    const res = await request(app).get('/api/products?featured=true');
    expect(res.status).toBe(200);
    const callArgs = vi.mocked(prisma.product.findMany).mock.calls[0][0] as { where: { isFeatured?: boolean } };
    expect(callArgs.where.isFeatured).toBe(true);
  });

  it('respects pagination params', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.product.count).mockResolvedValue(50);

    const res = await request(app).get('/api/products?page=3&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(3);
    expect(res.body.meta.limit).toBe(10);
    const callArgs = vi.mocked(prisma.product.findMany).mock.calls[0][0] as { skip: number; take: number };
    expect(callArgs.skip).toBe(20); // (page-1) * limit
    expect(callArgs.take).toBe(10);
  });
});

describe('GET /api/products/:slug', () => {
  it('returns 200 with product data for valid slug', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProducts[0] as never);

    const res = await request(app).get('/api/products/indomie-goreng');
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('indomie-goreng');
    expect(res.body.name).toBe('Indomie Goreng');
  });

  it('returns 404 for non-existent slug', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

    const res = await request(app).get('/api/products/tidak-ada');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});
