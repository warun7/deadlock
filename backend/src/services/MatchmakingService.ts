import { Server as SocketServer } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { redisService } from "./RedisService";
import { problemService } from "./ProblemService";
import { BotPlayer, BotCompletionResult } from "./BotPlayer";
import { config } from "../config";
import {
  QueueEntry,
  MatchState,
  MatchFoundPayload,
  AuthenticatedSocket,
  ServerToClientEvents,
  ClientToServerEvents,
} from "../types";

/**
 * MatchmakingService - Handles the queue and match creation
 *
 * Runs a FIFO queue with periodic processing to match players.
 * Future: Can be extended to support ELO-based matchmaking.
 */
export class MatchmakingService {
  private io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
  private processInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private activeBots: Map<string, BotPlayer> = new Map(); // Track active bots by matchId
  private gameService: any; // Will be set by GameService

  constructor(io: SocketServer<ClientToServerEvents, ServerToClientEvents>) {
    this.io = io;
  }

  /**
   * Set GameService reference (called by GameService)
   */
  setGameService(gameService: any): void {
    this.gameService = gameService;
  }

  /**
   * Start the matchmaking loop
   */
  start(): void {
    if (this.processInterval) {
      console.log("⚠️  Matchmaking already running");
      return;
    }

    console.log(
      `🎮 Starting matchmaking loop (interval: ${config.match.matchmakingIntervalMs}ms)`
    );

    this.processInterval = setInterval(
      () => this.processQueue(),
      config.match.matchmakingIntervalMs
    );
  }

  /**
   * Stop the matchmaking loop
   */
  stop(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
      console.log("🛑 Matchmaking stopped");
    }
  }

  /**
   * Add player to queue
   */
  async joinQueue(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;

    console.log(`\n🎮 JOIN_QUEUE request from ${user.username} (${user.id})`);

    // Check if user is already in a match
    const existingMatchId = await redisService.getUserMatchId(user.id);
    if (existingMatchId) {
      // Check if the match is still active
      const match = await redisService.getMatch(existingMatchId);
      if (match && match.status === "active") {
        console.log(`   ❌ User already in active match: ${existingMatchId}`);
        socket.emit("error", {
          message: "You are already in a match",
          code: "ALREADY_IN_MATCH",
        });
        return;
      }
      // Match is finished or doesn't exist - allow joining queue
      console.log(
        `   ✅ Previous match ${existingMatchId} is finished, allowing queue join`
      );
    }

    // Check if already in queue
    const isInQueue = await redisService.isUserInQueue(user.id);
    if (isInQueue) {
      const position = await redisService.getQueuePosition(user.id);
      console.log(`   ⚠️ Already in queue at position ${position}`);
      socket.emit("queue_joined", { position });
      return;
    }

    // Create queue entry
    const entry: QueueEntry = {
      userId: user.id,
      socketId: socket.id,
      username: user.username,
      elo: user.elo,
      joinedAt: Date.now(),
    };

    // Add to queue
    const position = await redisService.enqueue(entry);

    if (position > 0) {
      socket.emit("queue_joined", { position });
      console.log(`   ✅ Added to queue at position ${position}`);

      // Log current queue state
      const queueLength = await redisService.getQueueLength();
      console.log(`   📊 Current queue size: ${queueLength}`);
    } else {
      console.log(`   ❌ Failed to add to queue (position: ${position})`);
    }
  }

  /**
   * Remove player from queue
   */
  async leaveQueue(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;

    const removed = await redisService.dequeue(user.id);

    if (removed) {
      socket.emit("queue_left");
      console.log(`📤 ${user.username} left queue`);
    }
  }

  /**
   * Process the queue - called periodically
   * Matches players in FIFO order, or creates bot matches after timeout
   */
  private async processQueue(): Promise<void> {
    // Prevent overlapping processing
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Check queue length
      const queueLength = await redisService.getQueueLength();

      // Log queue status periodically (every 5 seconds worth of checks)
      if (queueLength > 0) {
        console.log(`🔍 Queue check: ${queueLength} player(s) waiting`);
      }

      // Check for players who have waited too long and need bot matches
      if (config.bot.enabled && queueLength > 0) {
        await this.checkForBotMatches();
      }

      if (queueLength < 2) {
        return;
      }

      console.log(
        `\n🎯 MATCHMAKING: Found ${queueLength} players, attempting to match...`
      );

      // Pop two players atomically
      const players = await redisService.popTwoPlayers();

      if (!players) {
        return;
      }

      const [player1, player2] = players;

      // Validate sockets are still connected
      const socket1 = this.io.sockets.sockets.get(player1.socketId);
      const socket2 = this.io.sockets.sockets.get(player2.socketId);

      if (!socket1 || !socket2) {
        // One or both players disconnected, re-queue the connected one
        if (socket1) {
          console.log(`⚠️  Player 2 disconnected, re-queuing player 1`);
          await redisService.enqueue(player1);
        }
        if (socket2) {
          console.log(`⚠️  Player 1 disconnected, re-queuing player 2`);
          await redisService.enqueue(player2);
        }
        return;
      }

      // Create the match!
      await this.createMatch(
        socket1 as AuthenticatedSocket,
        socket2 as AuthenticatedSocket,
        player1,
        player2
      );
    } catch (error) {
      console.error("❌ Error processing queue:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Check if any players have waited too long and create bot matches
   */
  private async checkForBotMatches(): Promise<void> {
    try {
      const queue = await redisService.getQueue();
      const now = Date.now();

      for (const entry of queue) {
        const waitTime = now - entry.joinedAt;

        // If player has waited longer than bot trigger delay, create bot match
        if (waitTime >= config.bot.triggerDelay) {
          console.log(
            `\n🤖 BOT MATCH: Player ${entry.username} waited ${
              waitTime / 1000
            }s, creating bot match...`
          );

          // Remove from queue
          await redisService.dequeue(entry.userId);

          // Get socket
          const socket = this.io.sockets.sockets.get(entry.socketId);
          if (!socket) {
            console.log(`   ❌ Player socket not found, skipping`);
            continue;
          }

          // Create bot match
          await this.createBotMatch(socket as AuthenticatedSocket, entry);
        }
      }
    } catch (error) {
      console.error("❌ Error checking for bot matches:", error);
    }
  }

  /**
   * Create a match with a bot opponent
   */
  private async createBotMatch(
    socket: AuthenticatedSocket,
    player: QueueEntry
  ): Promise<void> {
    try {
      // Generate match ID
      const matchId = uuidv4();

      // Get a random problem
      const problem = await problemService.getRandomProblem();

      if (!problem) {
        console.error("❌ Failed to get problem for bot match");
        socket.emit("error", {
          message: "Failed to create match. Please try again.",
        });
        return;
      }

      // Determine bot difficulty (for now, use default from config)
      // TODO: Later, adjust based on player stats
      const botDifficulty = config.bot.defaultDifficulty;

      // Create bot instance
      const bot = new BotPlayer({
        difficulty: botDifficulty,
        problemRating: parseInt(problem.difficulty || "1000"),
        socketServer: this.io,
        matchId,
        onComplete: (result: BotCompletionResult) => {
          // Handle bot completion via GameService
          if (this.gameService) {
            this.gameService.handleBotCompletion(matchId, result);
          }
        },
      });

      // Store bot reference
      this.activeBots.set(matchId, bot);

      // Create match state
      const matchState: MatchState = {
        id: matchId,
        player1: {
          id: player.userId,
          socketId: player.socketId,
          username: player.username,
          elo: player.elo,
        },
        player2: {
          id: bot.id,
          socketId: "bot", // Bots don't have real socket IDs
          username: bot.username,
          elo: 1000, // Default bot ELO
        },
        problemId: problem.id,
        problemTitle: problem.title,
        status: "active",
        winnerId: null,
        startedAt: Date.now(),
        finishedAt: null,
      };

      // Store match in Redis
      await redisService.createMatch(matchState);

      // Join socket to match room
      socket.join(matchId);
      socket.data.currentMatchId = matchId;

      // Prepare match found payload
      const matchFoundPayload: MatchFoundPayload = {
        matchId,
        problem: {
          id: problem.id,
          title: problem.title,
          description: problem.description,
          difficulty: problem.difficulty,
          testCases: problem.testCases,
        },
        opponent: bot.getPlayerInfo(),
        startTime: Date.now(),
      };

      // Emit match_found to player
      socket.emit("match_found", matchFoundPayload);

      console.log(`   ✅ Bot match created: ${matchId}`);
      console.log(`   🤖 Bot: ${bot.username} (${botDifficulty})`);
      console.log(`   👤 Human: ${player.username}`);
      console.log(`   📝 Problem: ${problem.title} (${problem.difficulty})`);

      // Start bot after a delay (simulate bot "connecting")
      setTimeout(() => {
        bot.start();
      }, 3000); // 3 second delay
    } catch (error) {
      console.error("❌ Error creating bot match:", error);
      socket.emit("error", {
        message: "Failed to create match. Please try again.",
      });
    }
  }

  /**
   * Get bot instance for a match
   */
  getBot(matchId: string): BotPlayer | undefined {
    return this.activeBots.get(matchId);
  }

  /**
   * Clean up bot when match ends
   */
  cleanupBot(matchId: string): void {
    const bot = this.activeBots.get(matchId);
    if (bot) {
      bot.stop();
      this.activeBots.delete(matchId);
      console.log(`🧹 Cleaned up bot for match ${matchId}`);
    }
  }

  /**
   * Create a match between two players
   */
  private async createMatch(
    socket1: AuthenticatedSocket,
    socket2: AuthenticatedSocket,
    player1: QueueEntry,
    player2: QueueEntry
  ): Promise<void> {
    // Generate match ID
    const matchId = uuidv4();

    // Get a random problem for the match
    const problem = await problemService.getRandomProblem();

    if (!problem) {
      console.error("❌ Failed to get problem for match");
      // Re-queue both players
      await redisService.enqueue(player1);
      await redisService.enqueue(player2);
      return;
    }

    // Create match state
    const matchState: MatchState = {
      id: matchId,
      player1: {
        id: player1.userId,
        socketId: player1.socketId,
        username: player1.username,
        elo: player1.elo,
      },
      player2: {
        id: player2.userId,
        socketId: player2.socketId,
        username: player2.username,
        elo: player2.elo,
      },
      problemId: problem.id,
      problemTitle: problem.title,
      status: "active",
      winnerId: null,
      startedAt: Date.now(),
      finishedAt: null,
    };

    // Store match in Redis
    await redisService.createMatch(matchState);

    // Join both sockets to the match room
    socket1.join(matchId);
    socket2.join(matchId);

    // Store match reference on sockets
    socket1.data.currentMatchId = matchId;
    socket2.data.currentMatchId = matchId;

    // Prepare payloads (each player sees the other as opponent)
    const payload1: MatchFoundPayload = {
      matchId,
      problem: {
        id: problem.id,
        title: problem.title,
        description: problem.description,
        difficulty: problem.difficulty,
        testCases: problem.testCases.filter((tc) => !tc.isHidden), // Only visible test cases
      },
      opponent: {
        id: player2.userId,
        username: player2.username,
        elo: player2.elo,
      },
      startTime: matchState.startedAt,
    };

    const payload2: MatchFoundPayload = {
      matchId,
      problem: {
        id: problem.id,
        title: problem.title,
        description: problem.description,
        difficulty: problem.difficulty,
        testCases: problem.testCases.filter((tc) => !tc.isHidden),
      },
      opponent: {
        id: player1.userId,
        username: player1.username,
        elo: player1.elo,
      },
      startTime: matchState.startedAt,
    };

    // Emit match found to each player
    socket1.emit("match_found", payload1);
    socket2.emit("match_found", payload2);

    console.log(`🎮 Match created: ${matchId}`);
    console.log(
      `   ${player1.username} (${player1.elo}) vs ${player2.username} (${player2.elo})`
    );
    console.log(`   Problem: ${problem.title}`);

    // Set match timeout to prevent infinite matches
    this.setMatchTimeout(matchId, matchState);
  }

  /**
   * Set timeout for match - force end if it runs too long
   */
  private setMatchTimeout(matchId: string, matchState: MatchState): void {
    const timeoutMs = config.match.timeoutMs || 1800000; // Default 30 minutes

    setTimeout(async () => {
      const match = await redisService.getMatch(matchId);

      if (match && match.status === "active") {
        console.log(`⏰ Match ${matchId} timed out after ${timeoutMs / 1000}s`);

        // Force draw - no winner
        await redisService.updateMatchStatus(matchId, "finished");

        // Notify both players
        this.io.to(matchId).emit("game_over", {
          winnerId: null,
          reason: "Match timed out - no winner",
        });

        console.log(`🏁 Match ${matchId} ended in timeout (draw)`);
      }
    }, timeoutMs);
  }

  /**
   * Handle player disconnect during queue/match
   */
  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;

    // Remove from queue if present
    await redisService.dequeue(user.id);

    // Check if in match
    const matchId =
      socket.data.currentMatchId ||
      (await redisService.getUserMatchId(user.id));

    if (matchId) {
      const match = await redisService.getMatch(matchId);

      if (match && match.status === "active") {
        // Player disconnected during active match - opponent wins
        const winnerId =
          match.player1.id === user.id ? match.player2.id : match.player1.id;

        const won = await redisService.setMatchWinner(matchId, winnerId);

        if (won) {
          // Notify the remaining player
          this.io.to(matchId).emit("game_over", {
            winnerId,
            reason: "Opponent disconnected",
          });

          console.log(`🏆 ${winnerId} wins by disconnect in match ${matchId}`);
        }
      }
    }

    // Clean up socket mappings
    await redisService.deleteUserSocket(user.id);
  }
}
