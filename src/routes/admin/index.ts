import { Router } from 'express';
import dashboardRouter  from './dashboard';
import productsRouter   from './products';
import categoriesRouter from './categories';
import ordersRouter     from './orders';

const router = Router();

router.use('/dashboard',  dashboardRouter);
router.use('/products',   productsRouter);
router.use('/categories', categoriesRouter);
router.use('/orders',     ordersRouter);

export default router;
