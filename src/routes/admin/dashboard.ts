import { Response } from 'express';
import { prisma } from '../../config/prisma';
import { AuthRequest } from '../../middleware/auth';
import { Router } from 'express';

const router = Router();

// GET /api/admin/dashboard
router.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Run independent queries in parallel for performance
    const [
      revenueResult,
      ordersToday,
      pendingCount,
      lowStockCount,
      dailyRevenue,
      topProducts,
    ] = await Promise.all([
      // All-time revenue from paid orders
      prisma.order.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { total: true },
      }),

      // Orders created today
      prisma.order.count({
        where: { createdAt: { gte: todayStart } },
      }),

      // Orders needing attention
      prisma.order.count({
        where: { status: { in: ['PENDING', 'CONFIRMED'] } },
      }),

      // Products at or below minimum stock
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM "Product"
        WHERE stock <= "minStock" AND "isActive" = true
      `,

      // Revenue per day for the last 7 days
      prisma.$queryRaw<{ day: Date; revenue: number }[]>`
        SELECT
          DATE_TRUNC('day', "createdAt") AS day,
          SUM(total)::float               AS revenue
        FROM "Order"
        WHERE "paymentStatus" = 'PAID'
          AND "createdAt" >= NOW() - INTERVAL '7 days'
        GROUP BY day
        ORDER BY day ASC
      `,

      // Top 5 products by total revenue
      prisma.$queryRaw<{ productName: string; revenue: number; qty: bigint }[]>`
        SELECT
          "productName",
          SUM(subtotal)::float AS revenue,
          SUM(quantity)        AS qty
        FROM "OrderItem"
        GROUP BY "productName"
        ORDER BY revenue DESC
        LIMIT 5
      `,
    ]);

    // Build a complete 7-day array, filling in zeros for days with no sales
    const revenueByDay: { date: string; revenue: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const label = d.toISOString().slice(0, 10);
      const found = dailyRevenue.find(
        (r) => new Date(r.day).toISOString().slice(0, 10) === label
      );
      revenueByDay.push({ date: label, revenue: found ? Number(found.revenue) : 0 });
    }

    res.json({
      totalRevenue:    Number(revenueResult._sum.total ?? 0),
      ordersToday,
      pendingOrders:   pendingCount,
      lowStockCount:   Number(lowStockCount[0]?.count ?? 0),
      revenueByDay,
      topProducts:     topProducts.map((p) => ({
        productName: p.productName,
        revenue:     Number(p.revenue),
        qty:         Number(p.qty),
      })),
    });
  } catch (err) {
    console.error('GET /admin/dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

export default router;
