import express, { Application, Request, Response } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createServer } from 'http';
import path from 'path';
import { startWhatsApp } from './services/whatsappService';
import { webSocketService } from './services/websocketService';
import cron from 'node-cron';
import fetchAndStore from './utils/fillDB';

// Load environment variables
dotenv.config();

// Import routes
import indexRoutes from './routes/index';

// Create Express app and HTTP server
const app: Application = express();
const server = createServer(app);
const PORT: number = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  hsts: false, // Disable HSTS to allow HTTP
  crossOriginOpenerPolicy: false, // Disable COOP for HTTP
  crossOriginEmbedderPolicy: false, // Disable COEP for HTTP
  originAgentCluster: false // Disable Origin-Agent-Cluster for HTTP
})); // Security headers
app.use(cors({
  origin: true, // Allow all origins
  credentials: true
})); // Enable CORS
app.set('trust proxy', 1); // Trust first proxy

// Add security headers for VPS deployment
app.use((req, res, next) => {
  // Disable security headers that cause issues on HTTP
  res.removeHeader('Cross-Origin-Opener-Policy');
  res.removeHeader('Cross-Origin-Embedder-Policy');
  res.removeHeader('Origin-Agent-Cluster');
  next();
});

app.use(morgan('combined')); // Logging
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api', indexRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    message: 'NimmoBot server is running',
    timestamp: new Date().toISOString()
  });
});

// QR Scanner page
app.get('/qr', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/qrScan.html'));
});

// 404 handler
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found'
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Something went wrong!'
  });
});

// Connect to MongoDB
const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nimmobot';
    await mongoose.connect(mongoURI);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Start server
const startServer = async (): Promise<void> => {
  try {
    await connectDB();
    
    // Initialize WebSocket service
    webSocketService.initialize(server);
    
    // Start WhatsApp service
    startWhatsApp();

    // Start cron job to fetch and store data every hour
    cron.schedule('0 * * * *', async () => {
      console.log('⏰ Running scheduled DB fill...');
      await fetchAndStore();
    });
    
    server.listen(PORT, () => {
      console.log(`🚀 NimmoBot server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(`📱 QR Scanner: http://localhost:${PORT}/qrScan.html`);
    });
  } catch (error) {
    console.error('❌ Server startup error:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  mongoose.connection.close().then(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  mongoose.connection.close().then(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});

// Start the server
startServer();

export default app;
