import { Router } from 'express';
import productsRouter   from './products';
import categoriesRouter from './categories';
import cartRouter       from './cart';
import customersRouter  from './customers';
import shippingRouter   from './shipping';
import paymentsRouter   from './payments';
import ordersRouter     from './orders';
import webhooksRouter   from './webhooks';
import adminRouter      from './admin/index';
import { verifyFirebaseToken, requireAdmin } from '../middleware/auth';

const router = Router();

router.use('/products',   productsRouter);
router.use('/categories', categoriesRouter);
router.use('/cart',       cartRouter);
router.use('/customers',  customersRouter);
router.use('/shipping',   shippingRouter);
router.use('/payments',   paymentsRouter);
router.use('/orders',     ordersRouter);
router.use('/webhooks',   webhooksRouter);

// All admin routes require a valid Firebase token with role=admin
router.use('/admin', verifyFirebaseToken, requireAdmin, adminRouter);

export default router;
