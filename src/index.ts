import * as dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { prisma } from './config/prisma';

const PORT = parseInt(process.env.PORT ?? '5016', 10);

async function bootstrap() {
  // Verify database connection before accepting traffic
  await prisma.$connect();
  console.log('Database connected');

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
