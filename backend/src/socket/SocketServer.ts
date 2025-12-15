import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisService } from '../services/RedisService';
import { MatchmakingService } from '../services/MatchmakingService';
import { GameService } from '../services/GameService';
import { authMiddleware, devAuthMiddleware } from '../middleware/AuthMiddleware';
import { config } from '../config';
import {
  AuthenticatedSocket,
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '../types';

/**
 * SocketServer - Main WebSocket server setup
 * 
 * Initializes Socket.io with:
 * - Redis adapter for horizontal scaling
 * - Authentication middleware
 * - Event handlers for matchmaking and gameplay
 */
export class DeadlockSocketServer {
  private io: SocketServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >;
  private matchmakingService: MatchmakingService;
  private gameService: GameService;
  
  constructor(httpServer: HttpServer) {
    // Initialize Socket.IO
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: config.frontendUrl,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingInterval: 25000,
      pingTimeout: 20000,
    });
    
    // Initialize services
    this.matchmakingService = new MatchmakingService(this.io as any);
    this.gameService = new GameService(this.io as any);
  }
  
  /**
   * Initialize the socket server with Redis adapter and middleware
   */
  async initialize(): Promise<void> {
    // Setup Redis adapter for horizontal scaling
    await this.setupRedisAdapter();
    
    // Setup authentication middleware
    this.setupMiddleware();
    
    // Setup event handlers
    this.setupEventHandlers();
    
    // Start matchmaking loop
    this.matchmakingService.start();
    
    console.log('✅ Socket server initialized');
  }
  
  /**
   * Setup Redis adapter for pub/sub across multiple instances
   */
  private async setupRedisAdapter(): Promise<void> {
    try {
      const pubClient = redisService.getClient().duplicate();
      const subClient = redisService.getClient().duplicate();
      
      await Promise.all([pubClient.connect(), subClient.connect()]);
      
      this.io.adapter(createAdapter(pubClient, subClient));
      
      console.log('✅ Redis adapter configured');
    } catch (error) {
      console.warn('⚠️  Redis adapter setup failed, running without clustering');
      console.warn('   This is fine for single-instance deployments');
    }
  }
  
  /**
   * Setup authentication middleware
   */
  private setupMiddleware(): void {
    // Use dev middleware in development (allows demo tokens)
    const middleware = config.nodeEnv === 'development'
      ? devAuthMiddleware
      : authMiddleware;
    
    this.io.use(middleware);
    
    console.log(`✅ Auth middleware configured (mode: ${config.nodeEnv})`);
  }
  
  /**
   * Setup socket event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', async (socket) => {
      const authSocket = socket as AuthenticatedSocket;
      const user = authSocket.user;
      
      console.log(`\n🔌 CONNECTION at ${new Date().toISOString()}`);
      console.log(`   User: ${user.username} (${user.id})`);
      console.log(`   Socket ID: ${socket.id}`);
      console.log(`   Client Address: ${socket.handshake.address}`);
      
      // ============================================
      // CRITICAL: Register event listeners IMMEDIATELY
      // before any async operations!
      // ============================================
      
      console.log(`   🎧 Registering event listeners for socket ${socket.id}`);
      
      // Debug: Log ALL incoming events
      socket.onAny((eventName, ...args) => {
        console.log(`🔔 Event received: "${eventName}" from ${user.username} (${socket.id})`, args.length > 0 ? args : '');
      });
      
      // ============================================
      // Queue Events
      // ============================================
      
      socket.on('join_queue', async () => {
        console.log(`📥 ${user.username} requesting to join queue`);
        await this.matchmakingService.joinQueue(authSocket);
      });
      
      socket.on('leave_queue', async () => {
        console.log(`📤 ${user.username} requesting to leave queue`);
        await this.matchmakingService.leaveQueue(authSocket);
      });
      
      // ============================================
      // Game Events
      // ============================================
      
      socket.on('submit_code', async (payload) => {
        console.log(`📝 ${user.username} submitting code`);
        await this.gameService.handleSubmission(authSocket, payload);
      });
      
      socket.on('forfeit', async () => {
        console.log(`🏳️ ${user.username} forfeiting`);
        await this.gameService.handleForfeit(authSocket);
      });
      
      // ============================================
      // Disconnect
      // ============================================
      
      socket.on('disconnect', async (reason) => {
        console.log(`🔌 Disconnected: ${user.username} (${reason})`);
        await this.matchmakingService.handleDisconnect(authSocket);
      });
      
      // ============================================
      // Async initialization (AFTER event listeners)
      // ============================================
      
      // Store socket mapping for reconnection
      await redisService.setUserSocket(user.id, socket.id);
      
      // Check for existing match (reconnection)
      await this.handleReconnection(authSocket);
    });
  }
  
  /**
   * Handle reconnection - rejoin match if active
   */
  private async handleReconnection(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;
    
    // Check if user has an active match
    const matchId = await redisService.getUserMatchId(user.id);
    
    if (matchId) {
      const match = await redisService.getMatch(matchId);
      
      if (match && match.status === 'active') {
        // Rejoin the match room
        socket.join(matchId);
        socket.data.currentMatchId = matchId;
        
        console.log(`🔄 ${user.username} reconnected to match ${matchId}`);
        
        // Update socket ID in match state
        const isPlayer1 = match.player1.id === user.id;
        if (isPlayer1) {
          match.player1.socketId = socket.id;
        } else {
          match.player2.socketId = socket.id;
        }
        
        // Re-emit match found with current state
        const opponent = isPlayer1 ? match.player2 : match.player1;
        
        // TODO: Fetch problem data and emit match_found
        // For now, just notify client they're in a match
        socket.emit('error', {
          message: 'Reconnected to match',
          code: 'RECONNECTED',
        });
      }
    }
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down socket server...');
    
    // Stop matchmaking
    this.matchmakingService.stop();
    
    // Clear all cleanup timers to prevent memory leaks
    this.gameService.clearAllTimers();
    
    // Close all connections
    this.io.close();
    
    console.log('✅ Socket server shut down');
  }
  
  /**
   * Get the Socket.IO server instance
   */
  getIO(): SocketServer {
    return this.io;
  }
}

