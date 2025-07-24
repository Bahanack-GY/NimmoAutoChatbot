import { Router, Request, Response } from 'express';
import userRoutes from './users';
import whatsappRoutes from './whatsapp';
import aiRoutes from './ai';

const router = Router();

// Welcome route
router.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Welcome to NimmoBot API',
    version: '1.0.0',
    status: 'running',
    currency: 'FCFA'
  });
});

// Example route
router.get('/example', (req: Request, res: Response) => {
  res.json({
    message: 'This is an example endpoint',
    data: {
      timestamp: new Date().toISOString(),
      currency: 'FCFA'
    }
  });
});

// User routes
router.use('/users', userRoutes);

// WhatsApp routes
router.use('/whatsapp', whatsappRoutes);

// AI routes
router.use('/ai', aiRoutes);

export default router; 