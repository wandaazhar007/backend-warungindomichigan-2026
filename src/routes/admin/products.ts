import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../../config/prisma';
import { AuthRequest } from '../../middleware/auth';

const router = Router();

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// GET /api/admin/products
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page       = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit      = Math.min(100, parseInt(req.query.limit as string) || 20);
    const skip       = (page - 1) * limit;
    const { categoryId, isActive, isFeatured, search } = req.query as Record<string, string>;

    const where: Prisma.ProductWhereInput = {};
    if (categoryId)           where.categoryId = categoryId;
    if (isActive !== undefined) where.isActive  = isActive === 'true';
    if (isFeatured !== undefined) where.isFeatured = isFeatured === 'true';
    if (search)               where.name       = { contains: search, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          category: { select: { id: true, name: true, slug: true } },
          images:   { where: { isPrimary: true }, take: 1 },
          _count:   { select: { orderItems: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({ data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('GET /admin/products error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/products/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await prisma.product.findUnique({
      where:   { id: req.params.id },
      include: {
        category: true,
        images:   { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
    res.json(product);
  } catch (err) {
    console.error('GET /admin/products/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/products
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      name, slug, description, price, comparePrice, unit, stock, minStock,
      sku, weightGrams, categoryId, isActive, isFeatured, tags, images,
    } = req.body as {
      name: string; slug?: string; description?: string;
      price: number; comparePrice?: number; unit?: string;
      stock?: number; minStock?: number; sku?: string; weightGrams?: number;
      categoryId: string; isActive?: boolean; isFeatured?: boolean;
      tags?: string[];
      images?: { url: string; altText?: string; isPrimary?: boolean; sortOrder?: number }[];
    };

    if (!name || price === undefined || !categoryId) {
      res.status(400).json({ error: 'name, price, and categoryId are required' });
      return;
    }

    const finalSlug = slug || toSlug(name);

    const product = await prisma.product.create({
      data: {
        name,
        slug:        finalSlug,
        description,
        price,
        comparePrice: comparePrice ?? null,
        unit:        unit ?? 'pcs',
        stock:       stock ?? 0,
        minStock:    minStock ?? 5,
        sku:         sku ?? null,
        weightGrams: weightGrams ?? 300,
        categoryId,
        isActive:    isActive ?? true,
        isFeatured:  isFeatured ?? false,
        tags:        tags ?? [],
        images:      images?.length
          ? { create: images.map((img) => ({ ...img })) }
          : undefined,
      },
      include: { images: true, category: true },
    });

    res.status(201).json(product);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'Slug or SKU already exists' });
      return;
    }
    console.error('POST /admin/products error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/products/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      name, slug, description, price, comparePrice, unit, stock, minStock,
      sku, weightGrams, categoryId, isActive, isFeatured, tags, images,
    } = req.body as Partial<{
      name: string; slug: string; description: string;
      price: number; comparePrice: number | null; unit: string;
      stock: number; minStock: number; sku: string | null; weightGrams: number;
      categoryId: string; isActive: boolean; isFeatured: boolean; tags: string[];
      images: { url: string; altText?: string; isPrimary?: boolean; sortOrder?: number }[];
    }>;

    // Auto-regen slug if name changed but slug not explicitly provided
    const finalSlug = slug ?? (name ? toSlug(name) : undefined);

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...(name         !== undefined && { name }),
        ...(finalSlug    !== undefined && { slug: finalSlug }),
        ...(description  !== undefined && { description }),
        ...(price        !== undefined && { price }),
        ...(comparePrice !== undefined && { comparePrice }),
        ...(unit         !== undefined && { unit }),
        ...(stock        !== undefined && { stock }),
        ...(minStock     !== undefined && { minStock }),
        ...(sku          !== undefined && { sku }),
        ...(weightGrams  !== undefined && { weightGrams }),
        ...(categoryId   !== undefined && { categoryId }),
        ...(isActive     !== undefined && { isActive }),
        ...(isFeatured   !== undefined && { isFeatured }),
        ...(tags         !== undefined && { tags }),
        // Replace all images when provided — delete existing then create new
        ...(images !== undefined && {
          images: {
            deleteMany: {},
            create: images.map((img) => ({
              url:       img.url,
              altText:   img.altText ?? null,
              isPrimary: img.isPrimary ?? false,
              sortOrder: img.sortOrder ?? 0,
            })),
          },
        }),
      },
      include: { images: { orderBy: { sortOrder: 'asc' } }, category: true },
    });

    res.json(product);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') { res.status(404).json({ error: 'Product not found' }); return; }
      if (err.code === 'P2002') { res.status(409).json({ error: 'Slug or SKU conflict' }); return; }
    }
    console.error('PUT /admin/products/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/products/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      res.status(404).json({ error: 'Product not found' }); return;
    }
    console.error('DELETE /admin/products/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/products/:id/images
router.post('/:id/images', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { url, altText, isPrimary, sortOrder } = req.body as {
      url: string; altText?: string; isPrimary?: boolean; sortOrder?: number;
    };

    if (!url) { res.status(400).json({ error: 'url is required' }); return; }

    // If new image is primary, unset all existing primary flags first
    if (isPrimary) {
      await prisma.productImage.updateMany({
        where:  { productId: req.params.id },
        data:   { isPrimary: false },
      });
    }

    const image = await prisma.productImage.create({
      data: {
        productId: req.params.id,
        url,
        altText:   altText ?? null,
        isPrimary: isPrimary ?? false,
        sortOrder: sortOrder ?? 0,
      },
    });

    res.status(201).json(image);
  } catch (err) {
    console.error('POST /admin/products/:id/images error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/products/images/:imageId
// NOTE: this route must be defined before /:id to avoid Express matching "images" as an id
router.delete('/images/:imageId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.productImage.delete({ where: { id: req.params.imageId } });
    res.status(204).send();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      res.status(404).json({ error: 'Image not found' }); return;
    }
    console.error('DELETE /admin/products/images/:imageId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
