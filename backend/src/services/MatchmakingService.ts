import { Server as SocketServer } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@supabase/supabase-js";
import { redisService } from "./RedisService";
import { problemService } from "./ProblemService";
import { BotPlayer, BotCompletionResult } from "./BotPlayer";
import { config } from "../config";
import {
  QueueEntry,
  MatchState,
  MatchFoundPayload,
  MatchMode,
  AuthenticatedSocket,
  ServerToClientEvents,
  ClientToServerEvents,
} from "../types";
import {
  averageElo,
  botDifficultyForElo,
  botOpponentEloForHuman,
} from "../utils/ratingBand";

// Supabase client for premium checks
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey,
);

/**
 * MatchmakingService - Handles the queue and match creation
 *
 * Supports two modes:
 * - Unranked: FIFO queue, open to all users
 * - Ranked: ELO-based matchmaking, premium users only
 */
export class MatchmakingService {
  private io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
  private processInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private activeBots: Map<string, BotPlayer> = new Map();
  private gameService: any;

  constructor(io: SocketServer<ClientToServerEvents, ServerToClientEvents>) {
    this.io = io;
  }

  /**
   * Set GameService reference (called by SocketServer)
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
      `🎮 Starting matchmaking loop (interval: ${config.match.matchmakingIntervalMs}ms)`,
    );

    this.processInterval = setInterval(
      () => this.processQueue(),
      config.match.matchmakingIntervalMs,
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
   * @param mode - 'ranked' or 'unranked' (default: 'unranked')
   */
  async joinQueue(
    socket: AuthenticatedSocket,
    mode: MatchMode = "unranked",
  ): Promise<void> {
    const user = socket.user;

    console.log(
      `\n🎮 JOIN_QUEUE request from ${user.username} (${user.id}) [${mode}]`,
    );

    // Premium gate for ranked mode
    if (mode === "ranked") {
      const isPremium = await this.checkPremiumStatus(user.id);
      if (!isPremium) {
        console.log(`   ❌ ${user.username} is not premium - ranked denied`);
        socket.emit("error", {
          message: "Premium subscription required for ranked mode",
          code: "PREMIUM_REQUIRED",
        });
        return;
      }
    }

    const freshElo = await this.fetchCurrentRating(user.id);
    user.elo = freshElo;

    const activeMatchId = await redisService.getActiveMatchIdForUser(user.id);
    if (activeMatchId) {
      console.log(`   ❌ User already in active match: ${activeMatchId}`);
      socket.emit("error", {
        message: "You are already in a match",
        code: "ALREADY_IN_MATCH",
      });
      return;
    }

    // Check if already in queue
    const isInQueue = await redisService.isUserInQueue(user.id);
    if (isInQueue) {
      const position = await redisService.getQueuePosition(user.id);
      console.log(`   ⚠️ Already in queue at position ${position}`);
      socket.emit("queue_joined", { position });
      return;
    }

    // Create queue entry with mode
    const entry: QueueEntry = {
      userId: user.id,
      socketId: socket.id,
      username: user.username,
      elo: freshElo,
      joinedAt: Date.now(),
      mode,
    };

    // Add to the appropriate queue
    const position = await redisService.enqueue(entry);

    if (position > 0) {
      socket.emit("queue_joined", { position });
      console.log(`   ✅ Added to ${mode} queue at position ${position}`);

      const queueLength = await redisService.getQueueLength(mode);
      console.log(`   📊 Current ${mode} queue size: ${queueLength}`);
    } else {
      console.log(`   ❌ Failed to add to queue (position: ${position})`);
    }
  }

  /** Latest ELO from Postgres for matchmaking + queue entries */
  private async fetchCurrentRating(userId: string): Promise<number> {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("current_rating")
        .eq("id", userId)
        .single();

      const r = profile?.current_rating;
      if (typeof r === "number" && Number.isFinite(r)) {
        return Math.max(100, Math.round(r));
      }
    } catch (e) {
      console.error(`❌ fetchCurrentRating ${userId}:`, e);
    }
    return 1200;
  }

  /**
   * Check if a user has an active premium subscription
   */
  private async checkPremiumStatus(userId: string): Promise<boolean> {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_premium, premium_expires_at")
        .eq("id", userId)
        .single();

      if (!profile) return false;

      // Check if premium and not expired
      if (profile.is_premium) {
        if (profile.premium_expires_at) {
          return new Date(profile.premium_expires_at) > new Date();
        }
        return true; // Premium with no expiry (lifetime or active sub)
      }

      return false;
    } catch (error) {
      console.error(`❌ Error checking premium status for ${userId}:`, error);
      return false;
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
   * Process both queues - called periodically
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Process both queues
      await Promise.all([
        this.processUnrankedQueue(),
        this.processRankedQueue(),
      ]);
    } catch (error) {
      console.error("❌ Error processing queues:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process the unranked queue (FIFO)
   */
  private async processUnrankedQueue(): Promise<void> {
    const queueLength = await redisService.getQueueLength("unranked");

    if (queueLength > 0) {
      console.log(`🔍 Unranked queue check: ${queueLength} player(s) waiting`);
    }

    if (queueLength >= 2) {
      const unrankedQueue = await redisService.getQueue("unranked");
      const now = Date.now();
      let maxWaitTime = 0;
      for (const entry of unrankedQueue) {
        const waitTime = now - entry.joinedAt;
        if (waitTime > maxWaitTime) maxWaitTime = waitTime;
      }

      const expansions = Math.floor(
        maxWaitTime / config.unranked.expandIntervalMs,
      );
      const eloRange = Math.min(
        config.unranked.initialEloRange +
          expansions * config.unranked.expandAmount,
        config.unranked.maxEloRange,
      );

      console.log(
        `\n🎯 UNRANKED MATCHMAKING: ${queueLength} players, ELO range ±${eloRange} (longest wait: ${Math.round(maxWaitTime / 1000)}s)`,
      );

      let players = await redisService.findUnrankedMatch(eloRange);

      if (!players && maxWaitTime >= 90000 && queueLength >= 2) {
        console.log(
          `   ⏳ No pair within ±${eloRange} after long wait — FIFO fallback`,
        );
        players = await redisService.popTwoPlayers();
      }

      if (players) {
        const [player1, player2] = players;

        const socket1 = this.io.sockets.sockets.get(player1.socketId);
        const socket2 = this.io.sockets.sockets.get(player2.socketId);

        if (!socket1 || !socket2) {
          if (socket1) await redisService.enqueue(player1);
          if (socket2) await redisService.enqueue(player2);
        } else {
          await this.createMatch(
            socket1 as AuthenticatedSocket,
            socket2 as AuthenticatedSocket,
            player1,
            player2,
            "unranked",
          );
        }
      }
    }

    if (config.bot.enabled && queueLength > 0) {
      await this.checkForBotMatches("unranked");
    }
  }

  /**
   * Process the ranked queue (ELO-based matching)
   */
  private async processRankedQueue(): Promise<void> {
    const queueLength = await redisService.getQueueLength("ranked");

    if (queueLength > 0) {
      console.log(`🔍 Ranked queue check: ${queueLength} player(s) waiting`);
    }

    if (queueLength >= 2) {
      const rankedQueue = await redisService.getQueue("ranked");
      const now = Date.now();
      let maxWaitTime = 0;
      for (const entry of rankedQueue) {
        const waitTime = now - entry.joinedAt;
        if (waitTime > maxWaitTime) maxWaitTime = waitTime;
      }

      const expansions = Math.floor(
        maxWaitTime / config.ranked.expandIntervalMs,
      );
      const eloRange = Math.min(
        config.ranked.initialEloRange +
          expansions * config.ranked.expandAmount,
        config.ranked.maxEloRange,
      );

      console.log(
        `\n🎯 RANKED MATCHMAKING: ${queueLength} players, ELO range: ±${eloRange} (longest wait: ${Math.round(maxWaitTime / 1000)}s)`,
      );

      const players = await redisService.findRankedMatch(eloRange);
      if (players) {
        const [player1, player2] = players;

        const socket1 = this.io.sockets.sockets.get(player1.socketId);
        const socket2 = this.io.sockets.sockets.get(player2.socketId);

        if (!socket1 || !socket2) {
          if (socket1) await redisService.enqueue(player1);
          if (socket2) await redisService.enqueue(player2);
        } else {
          await this.createMatch(
            socket1 as AuthenticatedSocket,
            socket2 as AuthenticatedSocket,
            player1,
            player2,
            "ranked",
          );
        }
      }
    }

    if (config.bot.enabled && queueLength > 0) {
      await this.checkForBotMatches("ranked");
    }
  }

  /**
   * Check if any players have waited too long and create bot matches
   */
  private async checkForBotMatches(mode: MatchMode): Promise<void> {
    try {
      const queue = await redisService.getQueue(mode);
      const now = Date.now();

      for (const entry of queue) {
        const waitTime = now - entry.joinedAt;

        if (waitTime >= config.bot.triggerDelay) {
          console.log(
            `\n🤖 BOT MATCH [${mode}]: Player ${entry.username} waited ${
              waitTime / 1000
            }s, creating bot match...`,
          );

          const lockToken = await redisService.acquireBotMatchLock(entry.userId);
          if (!lockToken) {
            continue;
          }

          try {
            const activeBotMatchId =
              await redisService.getActiveMatchIdForUser(entry.userId);
            if (activeBotMatchId) {
              console.log(
                `   ⚠️ User ${entry.username} already in active match ${activeBotMatchId}, skip bot`,
              );
              continue;
            }

            const removed = await redisService.dequeue(entry.userId);
            if (!removed) {
              continue;
            }

            const socket = this.io.sockets.sockets.get(entry.socketId);
            if (!socket) {
              console.log(
                `   ❌ Player socket not found (likely disconnected); dropped from queue`,
              );
              continue;
            }

            await this.createBotMatch(
              socket as AuthenticatedSocket,
              entry,
              mode,
            );
          } finally {
            await redisService.releaseBotMatchLock(entry.userId, lockToken);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error checking for bot matches:", error);
    }
  }

  /** Same socket instance still registered (not disconnected during async work). */
  private isBotTargetSocketLive(
    socket: AuthenticatedSocket,
    player: QueueEntry,
  ): boolean {
    return (
      socket.connected &&
      this.io.sockets.sockets.get(player.socketId) === socket
    );
  }

  /**
   * Create a match with a bot opponent
   */
  private async createBotMatch(
    socket: AuthenticatedSocket,
    player: QueueEntry,
    mode: MatchMode = "unranked",
  ): Promise<void> {
    try {
      // Generate match ID
      const matchId = uuidv4();

      const humanElo = player.elo;
      const problem = await problemService.getRandomProblemForSkill(
        humanElo,
        mode,
      );

      if (!problem) {
        console.error("❌ Failed to get problem for bot match");
        if (this.isBotTargetSocketLive(socket, player)) {
          await redisService.enqueue(player);
          socket.emit("error", {
            message: "Failed to create match. Please try again.",
          });
        }
        return;
      }

      const botDifficulty = botDifficultyForElo(humanElo);
      const syntheticBotElo = botOpponentEloForHuman(humanElo);

      const bot = new BotPlayer({
        difficulty: botDifficulty,
        problemRating: parseInt(problem.difficulty || "1000", 10),
        displayElo: syntheticBotElo,
        socketServer: this.io,
        matchId,
        onComplete: (result: BotCompletionResult) => {
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
          socketId: "bot",
          username: bot.username,
          elo: syntheticBotElo,
        },
        problemId: problem.id,
        problemTitle: problem.title,
        status: "active",
        winnerId: null,
        startedAt: Date.now(),
        finishedAt: null,
        matchType: mode,
      };

      // Store match in Redis
      await redisService.createMatch(matchState);

      // Join socket to match room
      socket.join(matchId);
      socket.data.currentMatchId = matchId;

      // Prepare match found payload
      const matchFoundPayload: MatchFoundPayload = {
        matchId,
        matchType: mode,
        problem: {
          id: problem.id,
          title: problem.title,
          description: problem.description,
          difficulty: problem.difficulty,
          testCases: problem.testCases.filter((tc) => !tc.isHidden),
        },
        opponent: bot.getPlayerInfo(),
        startTime: Date.now(),
      };

      // Emit match_found to player
      socket.emit("match_found", matchFoundPayload);

      console.log(`   ✅ Bot match created: ${matchId} [${mode}]`);
      console.log(`   🤖 Bot: ${bot.username} (${botDifficulty})`);
      console.log(`   👤 Human: ${player.username}`);
      console.log(`   📝 Problem: ${problem.title} (${problem.difficulty})`);

      // Start bot after a delay (simulate bot "connecting")
      setTimeout(() => {
        bot.start();
      }, 3000); // 3 second delay
    } catch (error) {
      console.error("❌ Error creating bot match:", error);
      try {
        const stillActive = await redisService.getActiveMatchIdForUser(
          player.userId,
        );
        if (!stillActive && this.isBotTargetSocketLive(socket, player)) {
          await redisService.enqueue(player);
        }
      } catch (requeueErr) {
        console.error("❌ Failed to re-queue after bot match error:", requeueErr);
      }
      if (this.isBotTargetSocketLive(socket, player)) {
        socket.emit("error", {
          message: "Failed to create match. Please try again.",
        });
      }
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
    player2: QueueEntry,
    mode: MatchMode = "unranked",
  ): Promise<void> {
    const matchId = uuidv4();

    const skillCenter = averageElo([player1.elo, player2.elo]);
    const problem = await problemService.getRandomProblemForSkill(
      skillCenter,
      mode,
    );

    if (!problem) {
      console.error("❌ Failed to get problem for match");
      await redisService.enqueue(player1);
      await redisService.enqueue(player2);
      return;
    }

    // Create match state with mode
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
      matchType: mode,
    };

    await redisService.createMatch(matchState);

    socket1.join(matchId);
    socket2.join(matchId);
    socket1.data.currentMatchId = matchId;
    socket2.data.currentMatchId = matchId;

    // Prepare payloads (each player sees the other as opponent)
    const payload1: MatchFoundPayload = {
      matchId,
      matchType: mode,
      problem: {
        id: problem.id,
        title: problem.title,
        description: problem.description,
        difficulty: problem.difficulty,
        testCases: problem.testCases.filter((tc) => !tc.isHidden),
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
      matchType: mode,
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

    socket1.emit("match_found", payload1);
    socket2.emit("match_found", payload2);

    console.log(`🎮 ${mode.toUpperCase()} match created: ${matchId}`);
    console.log(
      `   ${player1.username} (${player1.elo}) vs ${player2.username} (${player2.elo})`,
    );
    console.log(`   Problem: ${problem.title}`);

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

    // Remove from queue if present (checks both queues)
    await redisService.dequeue(user.id);

    // Check if in match
    const matchId =
      socket.data.currentMatchId ||
      (await redisService.getUserMatchId(user.id));

    if (matchId) {
      const match = await redisService.getMatch(matchId);

      if (match && match.status === "active") {
        const winnerId =
          match.player1.id === user.id ? match.player2.id : match.player1.id;
        const loserId = user.id;
        const isRanked = match.matchType === "ranked";

        const won = await redisService.setMatchWinner(matchId, winnerId);

        if (won) {
          console.log(`🏆 ${winnerId} wins by disconnect in match ${matchId}`);

          const duration = Math.floor((Date.now() - match.startedAt) / 1000);

          if (this.gameService) {
            const isBotMatch = match.player2.socketId === "bot";

            if (isBotMatch) {
              const bot = this.activeBots.get(matchId);
              const botDifficulty = bot?.getDifficulty() || "medium";

              await this.gameService.saveBotMatchToDatabase({
                matchId,
                humanId: match.player1.id,
                botId: match.player2.id,
                botUsername: match.player2.username,
                winnerId,
                problemId: match.problemId,
                problemTitle: match.problemTitle,
                duration,
                botDifficulty,
                matchType: match.matchType,
                humanElo: match.player1.elo,
                botElo: match.player2.elo,
              });

              this.cleanupBot(matchId);
            } else {
              const winnerElo =
                winnerId === match.player1.id
                  ? match.player1.elo
                  : match.player2.elo;
              const loserElo =
                loserId === match.player1.id
                  ? match.player1.elo
                  : match.player2.elo;

              const K = 32;
              const expectedScore =
                1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
              const eloChange = isRanked
                ? Math.round(K * (1 - expectedScore))
                : 0;

              await this.gameService.saveMatchToDatabase({
                matchId,
                winnerId,
                loserId,
                problemId: match.problemId,
                problemTitle: match.problemTitle,
                duration,
                player1Id: match.player1.id,
                player2Id: match.player2.id,
                eloChange,
                language: "unknown",
                matchType: match.matchType,
              });
            }
          }

          this.io.to(matchId).emit("game_over", {
            winnerId,
            reason: "Opponent disconnected",
            matchType: match.matchType,
          });
        }
      }
    }

    await redisService.deleteUserSocket(user.id);
  }
}
