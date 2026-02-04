import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { validateEnv } from './config/validation';
import { config, validateConfig } from './config';
import { redisService } from './services/RedisService';
import { DeadlockSocketServer } from './socket/SocketServer';
import {
  securityHeaders,
  apiLimiter,
  debugLimiter,
  requestLogger,
  errorHandler,
} from './middleware/security';
import logger from './utils/logger';

// ASCII Art Banner
const banner = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     ██████╗ ███████╗ █████╗ ██████╗ ██╗      ██████╗  ██████╗██╗  ██╗ ║
║     ██╔══██╗██╔════╝██╔══██╗██╔══██╗██║     ██╔═══██╗██╔════╝██║ ██╔╝ ║
║     ██║  ██║█████╗  ███████║██║  ██║██║     ██║   ██║██║     █████╔╝  ║
║     ██║  ██║██╔══╝  ██╔══██║██║  ██║██║     ██║   ██║██║     ██╔═██╗  ║
║     ██████╔╝███████╗██║  ██║██████╔╝███████╗╚██████╔╝╚██████╗██║  ██╗ ║
║     ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝ ║
║                                                              ║
║              REAL-TIME ORCHESTRATOR v1.0.0                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

async function main(): Promise<void> {
  console.log(banner);
  
  // Validate environment variables
  validateEnv();
  
  // Validate configuration
  validateConfig();
  
  // Create Express app
  const app = express();
  
  // Security middleware
  app.use(securityHeaders);
  app.use(requestLogger);
  
  // CORS
  app.use(cors({
    origin: config.frontendUrl,
    credentials: true,
  }));
  
  // Body parser
  app.use(express.json({ limit: '1mb' })); // Limit payload size
  
  // Rate limiting on all routes
  app.use(apiLimiter);
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });
  
  // Stats endpoint
  app.get('/stats', async (req, res) => {
    try {
      const queueLength = await redisService.getQueueLength();
      res.json({
        status: 'ok',
        queue: {
          length: queueLength,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        status: 'error',
        message: error.message,
      });
    }
  });
  
  // Debug endpoints - with stricter rate limiting
  app.use('/debug/', debugLimiter);
  
  // Debug endpoint - shows full queue contents
  app.get('/debug/queue', async (req, res) => {
    try {
      const client = redisService.getClient();
      const queueData = await client.lrange('queue:global', 0, -1);
      const parsed = queueData.map(entry => JSON.parse(entry));
      
      // Also check if sockets are still connected
      const queueWithStatus = parsed.map(entry => ({
        ...entry,
        socketConnected: socketServer.isSocketConnected(entry.socketId),
        waitTime: Date.now() - entry.joinedAt,
      }));
      
      res.json({
        status: 'ok',
        queue: queueWithStatus,
        count: parsed.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        status: 'error',
        message: error.message,
      });
    }
  });
  
  // Debug endpoint - shows all matches
  app.get('/debug/matches', async (req, res) => {
    try {
      const client = redisService.getClient();
      const matchKeys = await client.keys('match:*');
      const userMatchKeys = await client.keys('user:*:match');
      
      const matches: any[] = [];
      for (const key of matchKeys) {
        const data = await client.hgetall(key);
        matches.push({ key, ...data });
      }
      
      const userMatches: any[] = [];
      for (const key of userMatchKeys) {
        const matchId = await client.get(key);
        userMatches.push({ key, matchId });
      }
      
      res.json({
        status: 'ok',
        matches,
        userMatches,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        status: 'error',
        message: error.message,
      });
    }
  });
  
  // Debug endpoint - CLEAR all stale data (use with caution!)
  app.post('/debug/clear-all', async (req, res) => {
    try {
      const result = await redisService.clearAllMatchData();
      console.log('🧹 Manual clear-all triggered via API');
      res.json({
        status: 'ok',
        cleared: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        status: 'error',
        message: error.message,
      });
    }
  });
  
  // Debug endpoint - Clear specific user's match association
  app.post('/debug/clear-user/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const cleared = await redisService.clearUserMatch(userId);
      res.json({
        status: 'ok',
        userId,
        cleared,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        status: 'error',
        message: error.message,
      });
    }
  });
  
  // Create HTTP server
  const httpServer = createServer(app);
  
  // Initialize Redis
  console.log('🔄 Connecting to Redis...');
  try {
    await redisService.connect();
    console.log('✅ Redis connected');
  } catch (error: any) {
    console.error('❌ Redis connection failed:', error.message);
    console.log('⚠️  Continuing without Redis (limited functionality)');
  }
  
  // Initialize Socket Server
  console.log('🔄 Initializing Socket server...');
  const socketServer = new DeadlockSocketServer(httpServer);
  await socketServer.initialize();
  
  // Error handling middleware (must be last)
  app.use(errorHandler);
  
  // Start HTTP server
  httpServer.listen(config.port, () => {
    logger.info('Server started', {
      port: config.port,
      environment: config.nodeEnv,
      frontendUrl: config.frontendUrl,
    });
    
    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log(`🚀 Server running on port ${config.port}`);
    console.log(`   Environment: ${config.nodeEnv}`);
    console.log(`   Frontend: ${config.frontendUrl}`);
    console.log(`   Judge0: ${config.judge0.url}`);
    console.log('════════════════════════════════════════════════════════');
    console.log('');
    console.log('📡 Waiting for connections...');
    console.log('');
  });
  
  // Graceful shutdown
  let isShuttingDown = false;
  
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress, ignoring signal');
      return;
    }
    
    isShuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown`, { signal });
    console.log(`\n📡 Received ${signal}, shutting down gracefully...`);
    
    // Stop accepting new connections
    httpServer.close(() => {
      logger.info('HTTP server closed');
      console.log('✅ HTTP server closed');
    });
    
    try {
      // Shutdown socket server (gives clients time to disconnect)
      logger.info('Shutting down WebSocket server...');
      await socketServer.shutdown();
      console.log('✅ Socket server closed');
      
      // Disconnect from Redis
      logger.info('Disconnecting from Redis...');
      await redisService.disconnect();
      console.log('✅ Redis disconnected');
      
      logger.info('Graceful shutdown complete');
      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };
  
  // Graceful shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    console.error('❌ Uncaught exception:', error);
    shutdown('UNCAUGHT_EXCEPTION');
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason, promise });
    console.error('❌ Unhandled rejection:', reason);
    shutdown('UNHANDLED_REJECTION');
  });
}

// Run
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

