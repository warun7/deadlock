import express from 'express';
import { createServer } from 'http';
import crypto from 'crypto';
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

function isAuthorizedDebugRequest(req: express.Request): boolean {
  if (config.nodeEnv !== 'production') {
    return true;
  }

  if (!config.adminSecret) {
    return false;
  }

  const provided = req.header('x-admin-secret');
  if (!provided) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(config.adminSecret);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

async function main(): Promise<void> {
  console.log(banner);
  
  // Validate environment variables
  validateEnv();
  
  // Validate configuration
  validateConfig();
  
  // Create Express app
  const app = express();
  let socketServer: DeadlockSocketServer | null = null;
  
  // Security middleware
  app.use(securityHeaders);
  app.use(requestLogger);
  
  // CORS
  // Accepts any origin in FRONTEND_URL (comma-separated), plus requests with no
  // Origin header at all (health probes, curl, server-to-server calls).
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || config.frontendUrls.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  }));
  
  // Body parser
  app.use(express.json({ limit: '1mb' })); // Limit payload size
  
  // Rate limiting on all routes
  app.use(apiLimiter);
  
  // Health check endpoint
  // Reports the state of the dependencies that actually matter, so that
  // `docker compose ps` / an uptime monitor can distinguish "process is up"
  // from "the app can serve matches".
  app.get('/health', async (req, res) => {
    const redisOk = await redisService.ping();

    res.status(redisOk ? 200 : 503).json({
      status: redisOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      redis: {
        connected: redisOk,
        state: redisService.getStatus(),
      },
      judge0: {
        url: config.judge0.url,
      },
      queue: {
        length: socketServer?.getQueueLength() ?? 0,
      },
    });
  });
  
  // Stats endpoint
  app.get('/stats', async (req, res) => {
    try {
      const redisMetrics = redisService.getMetricsSnapshot();
      res.json({
        status: 'ok',
        queue: {
          length: socketServer?.getQueueLength() ?? 0,
        },
        redis: {
          since: redisMetrics.since,
          calls: redisMetrics.totals.calls,
          success: redisMetrics.totals.success,
          failure: redisMetrics.totals.failure,
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
  app.use('/debug/', (req, res, next) => {
    if (!isAuthorizedDebugRequest(req)) {
      res.status(403).json({
        status: 'error',
        message: 'Forbidden',
      });
      return;
    }

    next();
  });
  
  // Debug endpoint - shows full queue contents
  app.get('/debug/queue', async (req, res) => {
    try {
      res.json({
        status: 'ok',
        queue: socketServer?.getQueue() ?? [],
        count: socketServer?.getQueueLength() ?? 0,
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
      const { matches, userMatches } = await redisService.getDebugMatchesSnapshot();
      
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

  app.get('/debug/redis-metrics', (req, res) => {
    res.json({
      status: 'ok',
      metrics: redisService.getMetricsSnapshot(),
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/debug/redis-metrics/reset', (req, res) => {
    redisService.resetMetrics();
    res.json({
      status: 'ok',
      message: 'Redis metrics reset',
      timestamp: new Date().toISOString(),
    });
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
  socketServer = new DeadlockSocketServer(httpServer);
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
