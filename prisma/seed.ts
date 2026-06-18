import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface ProductItem {
  name: string;
  slug: string;
  description: string | null;
  price: number;
  comparePrice: number | null;
  unit: string;
  stock: number;
  minStock: number;
  sku: string | null;
  weightGrams: number;
  isActive: boolean;
  isFeatured: boolean;
  tags: string[];
}

interface CategoryData {
  id: string;
  name: string;
  slug: string;
  icon: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  items: ProductItem[];
}

interface ProductsJson {
  categories: CategoryData[];
}

async function main() {
  const jsonPath = path.resolve(__dirname, '../../products.json');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data: ProductsJson = JSON.parse(raw);

  console.log(`Seeding ${data.categories.length} categories...`);

  for (const cat of data.categories) {
    const category = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {
        name: cat.name,
        icon: cat.icon,
        description: cat.description,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
      },
      create: {
        name: cat.name,
        slug: cat.slug,
        icon: cat.icon,
        description: cat.description,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
      },
    });

    console.log(`  Category: ${category.name} (${cat.items.length} products)`);

    for (const item of cat.items) {
      await prisma.product.upsert({
        where: { slug: item.slug },
        update: {
          name: item.name,
          description: item.description,
          price: item.price,
          comparePrice: item.comparePrice,
          unit: item.unit,
          stock: item.stock,
          minStock: item.minStock,
          sku: item.sku,
          weightGrams: item.weightGrams,
          isActive: item.isActive,
          isFeatured: item.isFeatured,
          tags: item.tags,
          categoryId: category.id,
        },
        create: {
          name: item.name,
          slug: item.slug,
          description: item.description,
          price: item.price,
          comparePrice: item.comparePrice,
          unit: item.unit,
          stock: item.stock,
          minStock: item.minStock,
          sku: item.sku,
          weightGrams: item.weightGrams,
          isActive: item.isActive,
          isFeatured: item.isFeatured,
          tags: item.tags,
          categoryId: category.id,
        },
      });
    }
  }

  const totalProducts = data.categories.reduce((sum, c) => sum + c.items.length, 0);
  console.log(`\nSeed complete: ${data.categories.length} categories, ${totalProducts} products.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
