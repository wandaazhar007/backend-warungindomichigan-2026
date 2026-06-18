import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { selectBox } from '../config/boxSizes';
import { getShippingRates, ShippoAddress } from '../config/shippo';

const router = Router();

interface CartItemInput {
  productId: string;
  quantity: number;
}

interface ShippingRatesBody {
  items: CartItemInput[];
  address: {
    firstName: string;
    lastName: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
    phone?: string;
    email?: string;
  };
}

// POST /api/shipping/rates
// Calculates total weight, selects box, hits Shippo API, returns rate list
router.post('/rates', async (req: Request, res: Response): Promise<void> => {
  try {
    const { items, address } = req.body as ShippingRatesBody;

    if (!items?.length || !address?.street1 || !address?.city || !address?.state || !address?.zip) {
      res.status(400).json({ error: 'items and full address (street1, city, state, zip) are required' });
      return;
    }

    // Fetch product weights from DB
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, weightGrams: true, stock: true },
    });

    if (products.length !== productIds.length) {
      res.status(400).json({ error: 'One or more products not found or inactive' });
      return;
    }

    // Check stock availability
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product || product.stock < item.quantity) {
        res.status(400).json({ error: `Insufficient stock for product ${item.productId}` });
        return;
      }
    }

    // Calculate total weight in grams
    const totalWeightGrams = items.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId)!;
      return sum + product.weightGrams * item.quantity;
    }, 0);

    const box = selectBox(totalWeightGrams);
    const totalWeightLbs = totalWeightGrams / 453.592;

    const addressTo: ShippoAddress = {
      name: `${address.firstName} ${address.lastName}`,
      street1: address.street1,
      street2: address.street2,
      city: address.city,
      state: address.state,
      zip: address.zip,
      country: address.country ?? 'US',
      phone: address.phone,
      email: address.email,
    };

    const rates = await getShippingRates(addressTo, {
      length: box.lengthIn.toString(),
      width: box.widthIn.toString(),
      height: box.heightIn.toString(),
      distance_unit: 'in',
      weight: totalWeightLbs.toFixed(4),
      mass_unit: 'lb',
    });

    res.json({
      rates,
      meta: {
        totalWeightGrams,
        totalWeightLbs: parseFloat(totalWeightLbs.toFixed(4)),
        selectedBox: box.name,
        boxDimensions: `${box.lengthIn}×${box.widthIn}×${box.heightIn} in`,
      },
    });
  } catch (err) {
    console.error('POST /shipping/rates error:', err);
    res.status(500).json({ error: 'Failed to fetch shipping rates' });
  }
});

export default router;
