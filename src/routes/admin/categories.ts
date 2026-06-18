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

// GET /api/admin/categories
router.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    res.json(categories);
  } catch (err) {
    console.error('GET /admin/categories error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/categories
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, slug, icon, description, sortOrder, isActive } = req.body as {
      name: string; slug?: string; icon?: string; description?: string;
      sortOrder?: number; isActive?: boolean;
    };

    if (!name) { res.status(400).json({ error: 'name is required' }); return; }

    const category = await prisma.category.create({
      data: {
        name,
        slug:        slug || toSlug(name),
        icon:        icon ?? null,
        description: description ?? null,
        sortOrder:   sortOrder ?? 0,
        isActive:    isActive ?? true,
      },
    });

    res.status(201).json(category);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'Slug already exists' }); return;
    }
    console.error('POST /admin/categories error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/categories/:id
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, slug, icon, description, sortOrder, isActive } = req.body as Partial<{
      name: string; slug: string; icon: string | null; description: string | null;
      sortOrder: number; isActive: boolean;
    }>;

    const finalSlug = slug ?? (name ? toSlug(name) : undefined);

    const category = await prisma.category.update({
      where: { id: req.params.id },
      data: {
        ...(name        !== undefined && { name }),
        ...(finalSlug   !== undefined && { slug: finalSlug }),
        ...(icon        !== undefined && { icon }),
        ...(description !== undefined && { description }),
        ...(sortOrder   !== undefined && { sortOrder }),
        ...(isActive    !== undefined && { isActive }),
      },
      include: { _count: { select: { products: true } } },
    });

    res.json(category);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') { res.status(404).json({ error: 'Category not found' }); return; }
      if (err.code === 'P2002') { res.status(409).json({ error: 'Slug conflict' }); return; }
    }
    console.error('PUT /admin/categories/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/categories/:id
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Block deletion if active products exist in this category
    const activeCount = await prisma.product.count({
      where: { categoryId: req.params.id, isActive: true },
    });

    if (activeCount > 0) {
      res.status(409).json({
        error: `Cannot delete: ${activeCount} active product(s) still in this category`,
      });
      return;
    }

    await prisma.category.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      res.status(404).json({ error: 'Category not found' }); return;
    }
    console.error('DELETE /admin/categories/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
