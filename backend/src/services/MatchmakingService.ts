import { Server as SocketServer } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { redisService } from "./RedisService";
import { problemService } from "./ProblemService";
import { BotPlayer, BotCompletionResult } from "./BotPlayer";
import { config } from "../config";
import type { GameService } from "./GameService";
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
 * Runs a FIFO queue in memory and reacts to join/leave events immediately.
 * Redis is reserved for active match state and reconnect support.
 */
export class MatchmakingService {
  private io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
  private queuedPlayers: Map<string, QueueEntry> = new Map();
  private queueOrder: string[] = [];
  private botTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private isProcessingQueue = false;
  private shouldProcessQueueAgain = false;
  private activeBots: Map<string, BotPlayer> = new Map(); // Track active bots by matchId
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map(); // `${matchId}:${userId}` -> forfeit timer
  private gameService: GameService | null = null; // Set by GameService (for saving match results)

  constructor(io: SocketServer<ClientToServerEvents, ServerToClientEvents>) {
    this.io = io;
  }

  /**
   * Set GameService reference (called by SocketServer)
   */
  setGameService(gameService: GameService): void {
    this.gameService = gameService;
  }

  /**
   * Start matchmaking
   */
  start(): void {
    console.log("🎮 Matchmaking ready (event-driven mode)");
  }

  /**
   * Stop matchmaking and clear queue timers
   */
  stop(): void {
    for (const timeout of this.botTimeouts.values()) {
      clearTimeout(timeout);
    }

    this.botTimeouts.clear();
    this.queuedPlayers.clear();
    this.queueOrder = [];
    console.log("🛑 Matchmaking stopped");
  }

  getQueueLength(): number {
    return this.queueOrder.length;
  }

  getQueue(): QueueEntry[] {
    return this.queueOrder.flatMap((userId) => {
      const entry = this.queuedPlayers.get(userId);
      return entry ? [entry] : [];
    });
  }

  getQueuePosition(userId: string): number {
    const index = this.queueOrder.indexOf(userId);
    return index === -1 ? -1 : index + 1;
  }

  private clearBotTimeout(userId: string): void {
    const timeout = this.botTimeouts.get(userId);
    if (timeout) {
      clearTimeout(timeout);
      this.botTimeouts.delete(userId);
    }
  }

  private scheduleBotFallback(entry: QueueEntry): void {
    if (!config.bot.enabled) {
      return;
    }

    this.clearBotTimeout(entry.userId);

    const remainingDelay = Math.max(
      config.bot.triggerDelay - (Date.now() - entry.joinedAt),
      0
    );

    const timeout = setTimeout(() => {
      void this.handleBotTimeout(entry.userId);
    }, remainingDelay);

    this.botTimeouts.set(entry.userId, timeout);
  }

  private addToQueue(entry: QueueEntry, insertAtFront = false): number {
    const existing = this.queuedPlayers.get(entry.userId);

    if (existing) {
      const updatedEntry = {
        ...entry,
        joinedAt: existing.joinedAt,
      };

      this.queuedPlayers.set(entry.userId, updatedEntry);
      this.scheduleBotFallback(updatedEntry);
      return this.getQueuePosition(entry.userId);
    }

    this.queuedPlayers.set(entry.userId, entry);

    if (insertAtFront) {
      this.queueOrder.unshift(entry.userId);
    } else {
      this.queueOrder.push(entry.userId);
    }

    this.scheduleBotFallback(entry);
    return this.getQueuePosition(entry.userId);
  }

  private removeFromQueue(userId: string): QueueEntry | null {
    const entry = this.queuedPlayers.get(userId);
    if (!entry) {
      return null;
    }

    this.queuedPlayers.delete(userId);
    this.clearBotTimeout(userId);

    const index = this.queueOrder.indexOf(userId);
    if (index !== -1) {
      this.queueOrder.splice(index, 1);
    }

    return entry;
  }

  private requestQueueProcessing(): void {
    if (this.isProcessingQueue) {
      this.shouldProcessQueueAgain = true;
      return;
    }

    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      this.shouldProcessQueueAgain = true;
      return;
    }

    this.isProcessingQueue = true;

    try {
      do {
        this.shouldProcessQueueAgain = false;

        while (this.getQueueLength() >= 2) {
          const players = this.getNextMatchPair();
          if (!players) {
            break;
          }

          const [player1, player2] = players;
          const socket1 = this.io.sockets.sockets.get(player1.socketId);
          const socket2 = this.io.sockets.sockets.get(player2.socketId);

          if (!socket1 || !socket2) {
            if (socket1) {
              console.log(`⚠️  Player 2 disconnected, re-queueing player 1`);
              this.addToQueue(player1, true);
            }
            if (socket2) {
              console.log(`⚠️  Player 1 disconnected, re-queueing player 2`);
              this.addToQueue(player2, true);
            }
            continue;
          }

          const created = await this.createMatch(
            socket1 as AuthenticatedSocket,
            socket2 as AuthenticatedSocket,
            player1,
            player2
          );

          if (!created) {
            break;
          }
        }
      } while (this.shouldProcessQueueAgain);
    } catch (error) {
      console.error("❌ Error processing queue:", error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private getNextMatchPair(): [QueueEntry, QueueEntry] | null {
    const staleUserIds: string[] = [];
    const candidates: QueueEntry[] = [];

    for (const userId of this.queueOrder) {
      const entry = this.queuedPlayers.get(userId);
      if (!entry) {
        staleUserIds.push(userId);
        continue;
      }

      if (!this.io.sockets.sockets.has(entry.socketId)) {
        staleUserIds.push(userId);
        continue;
      }

      candidates.push(entry);

      if (candidates.length === 2) {
        break;
      }
    }

    for (const staleUserId of staleUserIds) {
      const removed = this.removeFromQueue(staleUserId);
      if (removed) {
        console.log(`🧹 Removed stale queue entry for ${removed.username}`);
      }
    }

    if (candidates.length < 2) {
      return null;
    }

    this.removeFromQueue(candidates[0].userId);
    this.removeFromQueue(candidates[1].userId);
    return [candidates[0], candidates[1]];
  }

  private async handleBotTimeout(userId: string): Promise<void> {
    this.botTimeouts.delete(userId);

    const entry = this.removeFromQueue(userId);
    if (!entry) {
      return;
    }

    const waitTime = Date.now() - entry.joinedAt;
    console.log(
      `\n🤖 BOT MATCH: Player ${entry.username} waited ${
        waitTime / 1000
      }s, creating bot match...`
    );

    const socket = this.io.sockets.sockets.get(entry.socketId);
    if (!socket) {
      console.log(`   ❌ Player socket not found, skipping`);
      return;
    }

    const created = await this.createBotMatch(socket as AuthenticatedSocket, entry);

    if (!created) {
      this.addToQueue(
        {
          ...entry,
          joinedAt: Date.now(),
        },
        true
      );
    }
  }

  /**
   * Add player to queue
   */
  async joinQueue(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;

    console.log(`\n🎮 JOIN_QUEUE request from ${user.username} (${user.id})`);

    // Check if user is already in a match
    const existingMatchId = await redisService.getUserMatchId(
      user.id,
      "queue_join_get_user_match"
    );
    if (existingMatchId) {
      // Check if the match is still active
      const match = await redisService.getMatch(
        existingMatchId,
        "queue_join_read_existing_match"
      );
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
    const existingQueueEntry = this.queuedPlayers.get(user.id);
    if (existingQueueEntry) {
      this.addToQueue({
        ...existingQueueEntry,
        socketId: socket.id,
      });

      const position = this.getQueuePosition(user.id);
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
    const position = this.addToQueue(entry);
    socket.emit("queue_joined", { position });
    console.log(`   ✅ Added to queue at position ${position}`);
    console.log(`   📊 Current queue size: ${this.getQueueLength()}`);

    this.requestQueueProcessing();
  }

  /**
   * Remove player from queue
   */
  async leaveQueue(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;

    const removed = this.removeFromQueue(user.id);

    if (removed) {
      socket.emit("queue_left");
      console.log(`📤 ${user.username} left queue`);
    }
  }

  /**
   * Create a match with a bot opponent
   */
  private async createBotMatch(
    socket: AuthenticatedSocket,
    player: QueueEntry
  ): Promise<boolean> {
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
        return false;
      }

      // Determine bot difficulty (for now, use default from config)
      // TODO: Later, adjust based on player stats
      const botDifficulty = config.bot.defaultDifficulty;

      // Create bot instance
      const bot = new BotPlayer({
        difficulty: botDifficulty,
        problemRating: problem.difficulty ?? 1000,
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
      await redisService.createMatch(matchState, "bot_match_create");

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
          testCases: problem.testCases.filter((tc) => !tc.isHidden), // Only visible test cases
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

      return true;
    } catch (error) {
      console.error("❌ Error creating bot match:", error);
      socket.emit("error", {
        message: "Failed to create match. Please try again.",
      });
      return false;
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
  ): Promise<boolean> {
    // Generate match ID
    const matchId = uuidv4();

    // Get a random problem for the match
    const problem = await problemService.getRandomProblem();

    if (!problem) {
      console.error("❌ Failed to get problem for match");
      this.addToQueue(player2, true);
      this.addToQueue(player1, true);
      setTimeout(() => this.requestQueueProcessing(), 5000);
      return false;
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
      await redisService.createMatch(matchState, "match_create");

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
    return true;
  }

  /**
   * Set timeout for match - force end if it runs too long
   */
  private setMatchTimeout(matchId: string, matchState: MatchState): void {
    const timeoutMs = config.match.timeoutMs || 1800000; // Default 30 minutes

    setTimeout(async () => {
      const match = await redisService.getMatch(matchId, "match_timeout_read");

      if (match && match.status === "active") {
        console.log(`⏰ Match ${matchId} timed out after ${timeoutMs / 1000}s`);

        // Force draw - no winner
        await redisService.updateMatchStatus(
          matchId,
          "finished",
          "match_timeout_finish"
        );

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
   * Handle player disconnect during queue/match.
   *
   * Leaving the queue is immediate. Dropping out of an active match is not:
   * a refresh, a network blip or a laptop lid closing all look like a
   * disconnect, so the player gets a grace period to come back (see
   * markReconnected) before the opponent is awarded the win.
   */
  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;

    // Remove from queue if present
    const removedFromQueue = this.removeFromQueue(user.id);
    if (removedFromQueue) {
      console.log(`📤 ${user.username} removed from queue on disconnect`);
    }

    // Only forget the socket mapping if it still points at this socket; a
    // second tab or an already-reconnected socket may own it now.
    const mappedSocketId = await redisService.getUserSocket(user.id, "disconnect_get_user_socket");
    if (!mappedSocketId || mappedSocketId === socket.id) {
      await redisService.deleteUserSocket(user.id, "disconnect_delete_user_socket");
    }

    const matchId =
      socket.data.currentMatchId ||
      (await redisService.getUserMatchId(user.id, "disconnect_get_user_match"));
    if (!matchId) return;

    const match = await redisService.getMatch(matchId, "disconnect_read_match");
    if (!match || match.status !== "active") return;

    // Another tab of the same player is still in the match: nothing is lost
    if (this.isUserInMatchRoom(matchId, user.id, socket.id)) return;

    const key = this.disconnectKey(matchId, user.id);
    if (this.disconnectTimers.has(key)) return;

    const graceMs = config.match.reconnectGraceMs;
    const deadline = Date.now() + graceMs;
    console.log(`⏳ ${user.username} dropped out of match ${matchId}; holding it for ${graceMs / 1000}s`);

    this.io.to(matchId).emit("opponent_progress", {
      playerId: user.id,
      status: "Disconnected",
      reconnectDeadline: deadline,
    });

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(key);
      void this.resolveDisconnect(matchId, user.id).catch((error) =>
        console.error(`❌ Error resolving disconnect for match ${matchId}:`, error)
      );
    }, graceMs);
    this.disconnectTimers.set(key, timer);
  }

  /**
   * A player is back in their match (new socket joined the room). Cancels a
   * pending disconnect forfeit and tells the opponent.
   */
  markReconnected(matchId: string, userId: string): void {
    const key = this.disconnectKey(matchId, userId);
    const timer = this.disconnectTimers.get(key);
    if (!timer) return;

    clearTimeout(timer);
    this.disconnectTimers.delete(key);
    console.log(`🔄 ${userId} is back in match ${matchId} before the grace period ran out`);
    this.io.to(matchId).emit("opponent_progress", {
      playerId: userId,
      status: "Reconnected",
    });
  }

  /** Clear pending disconnect timers (server shutdown) */
  clearDisconnectTimers(): void {
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
    this.disconnectTimers.clear();
  }

  private disconnectKey(matchId: string, userId: string): string {
    return `${matchId}:${userId}`;
  }

  /**
   * Whether this player has a live socket in the match room (other than the
   * one given). Single-instance: checks this server's sockets.
   */
  private isUserInMatchRoom(matchId: string, userId: string, exceptSocketId?: string): boolean {
    for (const s of this.io.sockets.sockets.values()) {
      if (s.id === exceptSocketId) continue;
      if ((s as AuthenticatedSocket).user?.id === userId && s.rooms.has(matchId)) return true;
    }
    return false;
  }

  /**
   * The grace period ran out. If the player still is not back, the opponent
   * wins by disconnect; if both players are gone, the match ends with no
   * winner and nothing is recorded.
   */
  private async resolveDisconnect(matchId: string, userId: string): Promise<void> {
    const match = await redisService.getMatch(matchId, "disconnect_resolve_read_match");
    if (!match || match.status !== "active") return;
    if (this.isUserInMatchRoom(matchId, userId)) return;

    const isBotMatch = match.player2.socketId === "bot";
    const winnerId = match.player1.id === userId ? match.player2.id : match.player1.id;
    const loserId = userId;

    if (!isBotMatch && !this.isUserInMatchRoom(matchId, winnerId)) {
      await redisService.updateMatchStatus(matchId, "finished", "disconnect_both_gone");
      this.io.to(matchId).emit("game_over", {
        winnerId: null,
        reason: "Both players disconnected",
      });
      console.log(`🏁 Match ${matchId} ended: both players disconnected`);
      return;
    }

    const won = await redisService.setMatchWinner(matchId, winnerId, "disconnect_finish_match");
    if (!won) return;

    console.log(`🏆 ${winnerId} wins by disconnect in match ${matchId}`);
    const duration = Math.floor((Date.now() - match.startedAt) / 1000);

    if (this.gameService) {
      if (isBotMatch) {
        // Bot match - save only for human player
        const bot = this.activeBots.get(matchId);
        await this.gameService.saveBotMatchToDatabase({
          matchId,
          humanId: match.player1.id,
          botId: match.player2.id,
          botUsername: match.player2.username,
          winnerId,
          problemId: match.problemId,
          problemTitle: match.problemTitle,
          duration,
          botDifficulty: bot?.getDifficulty() || "medium",
        });
        this.cleanupBot(matchId);
      } else {
        await this.gameService.recordHumanResult(match, winnerId, loserId, duration, "unknown", {
          winner: "Opponent disconnected",
          loser: "You disconnected",
        });
        return; // recordHumanResult notifies both players with their rating changes
      }
    }

    this.io.to(matchId).emit("game_over", {
      winnerId,
      reason: "Opponent disconnected",
    });
  }
}
