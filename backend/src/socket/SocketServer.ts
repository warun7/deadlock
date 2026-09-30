import { Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { validate as isUuid } from "uuid";
import { redisService } from "../services/RedisService";
import { problemService } from "../services/ProblemService";
import { MatchmakingService } from "../services/MatchmakingService";
import { GameService } from "../services/GameService";
import {
  authMiddleware,
  devAuthMiddleware,
} from "../middleware/AuthMiddleware";
import { config } from "../config";
import {
  AuthenticatedSocket,
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  QueueEntry,
  SubmitCodePayload,
  SocketData,
} from "../types";

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
        // Same allow-list as the Express layer (FRONTEND_URL, comma-separated).
        origin: config.frontendUrls,
        methods: ["GET", "POST"],
        credentials: true,
      },
      transports: ["websocket", "polling"],
      pingInterval: 25000,
      pingTimeout: 20000,
    });

    // Initialize services
    this.matchmakingService = new MatchmakingService(this.io);
    this.gameService = new GameService(this.io);

    // Wire up service references (for bot system)
    this.matchmakingService.setGameService(this.gameService);
    this.gameService.setMatchmakingService(this.matchmakingService);
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

    // Start matchmaking
    this.matchmakingService.start();

    console.log("✅ Socket server initialized");
  }

  /**
   * Setup Redis adapter for pub/sub across multiple instances
   */
  private async setupRedisAdapter(): Promise<void> {
    if (!config.socket.enableRedisAdapter) {
      console.log("ℹ️  Redis adapter disabled (single-instance mode)");
      return;
    }

    try {
      const pubClient = redisService.getClient().duplicate();
      const subClient = redisService.getClient().duplicate();

      await Promise.all([pubClient.connect(), subClient.connect()]);

      this.io.adapter(createAdapter(pubClient, subClient));

      console.log("✅ Redis adapter configured");
    } catch (error) {
      console.warn(
        "⚠️  Redis adapter setup failed, running without clustering"
      );
      console.warn("   This is fine for single-instance deployments");
    }
  }

  /**
   * Setup authentication middleware
   */
  private setupMiddleware(): void {
    // Use dev middleware in development (allows demo tokens)
    const middleware =
      config.nodeEnv === "development" ? devAuthMiddleware : authMiddleware;

    this.io.use(middleware);

    console.log(`✅ Auth middleware configured (mode: ${config.nodeEnv})`);
  }

  /**
   * Setup socket event handlers
   */
  private setupEventHandlers(): void {
    this.io.on("connection", async (socket) => {
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
        console.log(
          `🔔 Event received: "${eventName}" from ${user.username} (${socket.id})`,
          args.length > 0 ? args : ""
        );
      });

      // ============================================
      // Queue Events
      // ============================================

      socket.on("join_queue", async () => {
        console.log(`📥 ${user.username} requesting to join queue`);
        await this.matchmakingService.joinQueue(authSocket);
      });

      socket.on("leave_queue", async () => {
        console.log(`📤 ${user.username} requesting to leave queue`);
        await this.matchmakingService.leaveQueue(authSocket);
      });

      // ============================================
      // Game Events
      // ============================================

      socket.on("submit_code", async (payload) => {
        if (!this.isValidSubmitPayload(payload)) {
          socket.emit("error", {
            message: "Invalid submission payload",
            code: "BAD_PAYLOAD",
          });
          return;
        }

        console.log(`📝 ${user.username} submitting code`);
        await this.gameService.handleSubmission(authSocket, payload);
      });

      socket.on("forfeit", async () => {
        console.log(`🏳️ ${user.username} forfeiting`);
        await this.gameService.handleForfeit(authSocket);
      });

      socket.on("rejoin_match", async (matchId: string) => {
        if (!isUuid(matchId)) {
          socket.emit("error", {
            message: "Invalid match ID",
            code: "BAD_MATCH_ID",
          });
          return;
        }

        console.log(
          `🔄 ${user.username} requesting to rejoin match ${matchId}`
        );
        await this.handleRejoinMatch(authSocket, matchId);
      });

      socket.on("check_active_match", async () => {
        console.log(`🔍 ${user.username} checking for active match`);
        await this.handleCheckActiveMatch(authSocket);
      });

      // ============================================
      // Disconnect
      // ============================================

      socket.on("disconnect", async (reason) => {
        console.log(`🔌 Disconnected: ${user.username} (${reason})`);
        await this.matchmakingService.handleDisconnect(authSocket);
      });

      // ============================================
      // Async initialization (AFTER event listeners)
      // ============================================

      // Store socket mapping for reconnection
      await redisService.setUserSocket(
        user.id,
        socket.id,
        "socket_connect_set_user_socket"
      );

      // Check for existing match (reconnection)
      await this.handleReconnection(authSocket);
    });
  }

  private isValidSubmitPayload(payload: unknown): payload is SubmitCodePayload {
    if (!payload || typeof payload !== "object") {
      return false;
    }

    const candidate = payload as Partial<SubmitCodePayload>;
    if (typeof candidate.code !== "string") {
      return false;
    }

    if (
      typeof candidate.languageId !== "number" ||
      !Number.isInteger(candidate.languageId)
    ) {
      return false;
    }

    return candidate.code.length > 0 && candidate.code.length <= 100_000;
  }

  /**
   * Handle reconnection - check if user has an active match on socket connect
   */
  private async handleReconnection(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;

    // Check if user has an active match stored
    const matchId = await redisService.getUserMatchId(
      user.id,
      "socket_reconnect_get_user_match"
    );

    if (matchId) {
      const match = await redisService.getMatch(
        matchId,
        "socket_reconnect_read_match"
      );

      if (match && match.status === "active") {
        // Just join the room and update socket ID
        // Client will call rejoin_match explicitly if needed
        socket.join(matchId);
        socket.data.currentMatchId = matchId;

        // Update socket ID in Redis
        const socketField =
          match.player1.id === user.id ? "player1_socketId" : "player2_socketId";
        await redisService.updateMatchSocketId(
          matchId,
          socketField,
          socket.id,
          "socket_reconnect_update_socket"
        );

        console.log(
          `🔄 ${user.username} reconnected - has active match ${matchId}`
        );
      }
    }
  }

  /**
   * Handle explicit rejoin match request from client
   * Called when client loads /game/:matchId and needs match data
   */
  private async handleRejoinMatch(
    socket: AuthenticatedSocket,
    matchId: string
  ): Promise<void> {
    const user = socket.user;

    try {
      // Fetch match from Redis
      const match = await redisService.getMatch(matchId, "rejoin_read_match");

      if (!match) {
        socket.emit("error", {
          message: "Match not found or has ended",
          code: "MATCH_NOT_FOUND",
        });
        return;
      }

      // Verify user is a participant
      const isPlayer1 = match.player1.id === user.id;
      const isPlayer2 = match.player2.id === user.id;

      if (!isPlayer1 && !isPlayer2) {
        socket.emit("error", {
          message: "You are not a participant in this match",
          code: "NOT_PARTICIPANT",
        });
        return;
      }

      // Fetch problem data EARLY before doing state checks
      const problem = await problemService.getProblemById(match.problemId);

      if (!problem) {
        socket.emit("error", {
          message: "Problem data not found",
          code: "PROBLEM_NOT_FOUND",
        });
        return;
      }

      // Determine opponent
      const opponent = isPlayer1 ? match.player2 : match.player1;

      // Check match status
      if (match.status !== "active") {
        if (match.status === "finished" && match.winnerId) {
          // If the match naturally finished (someone won), send the state then trigger game over
          const isWinner = match.winnerId === user.id;
          const reason = isWinner ? "You solved it first!" : "Opponent solved it first or you forfeited";
          
          socket.emit("match_found", {
            matchId: match.id,
            problem: {
              id: problem.id,
              title: problem.title,
              description: problem.description,
              difficulty: problem.difficulty,
              testCases: problem.testCases.filter((tc) => !tc.isHidden),
            },
            opponent: {
              id: opponent.id,
              username: opponent.username,
              elo: opponent.elo,
            },
            startTime: match.startedAt,
          });

          // Allow UI to settle
          setTimeout(() => {
            socket.emit("game_over", {
              winnerId: match.winnerId,
              reason,
            });
          }, 500);
          return;
        } else {
          socket.emit("error", {
            message: `Match has ended (status: ${match.status})`,
            code: "MATCH_ENDED",
          });
          return;
        }
      }

      // Join the match room
      socket.join(matchId);
      socket.data.currentMatchId = matchId;

      // Update socket ID in Redis
      const socketField =
        match.player1.id === user.id ? "player1_socketId" : "player2_socketId";
      await redisService.updateMatchSocketId(
        matchId,
        socketField,
        socket.id,
        "rejoin_update_socket"
      );

      // Emit match_found with full data
      socket.emit("match_found", {
        matchId: match.id,
        problem: {
          id: problem.id,
          title: problem.title,
          description: problem.description,
          difficulty: problem.difficulty,
          testCases: problem.testCases.filter((tc) => !tc.isHidden), // Only visible test cases
        },
        opponent: {
          id: opponent.id,
          username: opponent.username,
          elo: opponent.elo,
        },
        startTime: match.startedAt,
      });

      console.log(`✅ ${user.username} rejoined match ${matchId}`);
    } catch (error: any) {
      console.error(`❌ Error rejoining match: ${error.message}`);
      socket.emit("error", {
        message: "Failed to rejoin match",
        code: "REJOIN_ERROR",
      });
    }
  }

  /**
   * Handle check for active match - used when user loads dashboard
   * Notifies client if they have an active match they should rejoin
   */
  private async handleCheckActiveMatch(
    socket: AuthenticatedSocket
  ): Promise<void> {
    const user = socket.user;

    try {
      // Check if user has an active match stored in Redis
      const matchId = await redisService.getUserMatchId(
        user.id,
        "check_active_match_get_user_match"
      );

      if (matchId) {
        const match = await redisService.getMatch(
          matchId,
          "check_active_match_read_match"
        );

        if (match && match.status === "active") {
          // Notify client they have an active match
          socket.emit("active_match_found", { matchId });
          console.log(`✅ ${user.username} has active match ${matchId}`);
          return;
        }
      }

      // No active match found - this is not an error, just means user is free
      console.log(`ℹ️  ${user.username} has no active match`);
    } catch (error: any) {
      console.error(`❌ Error checking active match: ${error.message}`);
      // Don't emit error - this is not critical
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log("🛑 Shutting down socket server...");

    // Stop matchmaking
    this.matchmakingService.stop();

    // Clear all cleanup timers to prevent memory leaks
    this.gameService.clearAllTimers();

    // Close all connections
    this.io.close();

    console.log("✅ Socket server shut down");
  }

  /**
   * Get the Socket.IO server instance
   */
  getIO(): SocketServer {
    return this.io;
  }

  getQueueLength(): number {
    return this.matchmakingService.getQueueLength();
  }

  getQueue(): QueueEntry[] {
    return this.matchmakingService.getQueue();
  }
}
