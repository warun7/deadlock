import { Server as SocketServer } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { redisService } from "./RedisService";
import { problemService } from "./ProblemService";
import { BotPlayer, BotCompletionResult } from "./BotPlayer";
import { config } from "../config";
import { ROOM_DIFFICULTIES, RoomDifficulty } from "../config/roomDifficulty";
import type { GameService } from "./GameService";
import type { IntegrityService } from "./IntegrityService";
import type { LobbyService } from "./LobbyService";
import type { NotifyService } from "./NotifyService";
import { analyticsService } from "./AnalyticsService";
import { cleanTimeline, GhostPlayer, ghostService } from "./GhostService";
import { NotAvailableError } from "./db";
import {
  QueueEntry,
  MatchState,
  MatchFoundPayload,
  AuthenticatedSocket,
  RoomPlayer,
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
  private isProcessingQueue = false;
  private shouldProcessQueueAgain = false;
  private activeBots: Map<string, BotPlayer> = new Map(); // Track active bots by matchId
  private activeGhosts: Map<string, GhostPlayer> = new Map(); // Ghost replays by matchId
  private startingGhost = new Set<string>(); // players whose ghost duel is being set up
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map(); // `${matchId}:${userId}` -> forfeit timer
  private gameService: GameService | null = null; // Set by GameService (for saving match results)
  private integrityService: IntegrityService | null = null; // Fair play signals when a ranked match ends
  private lobbyService: LobbyService | null = null; // Live lobby counts
  private notifyService: NotifyService | null = null; // "Someone is waiting" alerts

  constructor(io: SocketServer<ClientToServerEvents, ServerToClientEvents>) {
    this.io = io;
  }

  /**
   * Set GameService reference (called by SocketServer)
   */
  setGameService(gameService: GameService): void {
    this.gameService = gameService;
  }

  setIntegrityService(integrityService: IntegrityService): void {
    this.integrityService = integrityService;
  }

  setLobbyService(lobbyService: LobbyService): void {
    this.lobbyService = lobbyService;
  }

  setNotifyService(notifyService: NotifyService): void {
    this.notifyService = notifyService;
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

  private addToQueue(entry: QueueEntry, insertAtFront = false): number {
    const existing = this.queuedPlayers.get(entry.userId);

    if (existing) {
      const updatedEntry = {
        ...entry,
        joinedAt: existing.joinedAt,
      };

      this.queuedPlayers.set(entry.userId, updatedEntry);
      return this.getQueuePosition(entry.userId);
    }

    this.queuedPlayers.set(entry.userId, entry);

    if (insertAtFront) {
      this.queueOrder.unshift(entry.userId);
    } else {
      this.queueOrder.push(entry.userId);
    }

    this.lobbyService?.touch();
    return this.getQueuePosition(entry.userId);
  }

  private removeFromQueue(userId: string): QueueEntry | null {
    const entry = this.queuedPlayers.get(userId);
    if (!entry) {
      return null;
    }

    this.queuedPlayers.delete(userId);

    const index = this.queueOrder.indexOf(userId);
    if (index !== -1) {
      this.queueOrder.splice(index, 1);
    }

    this.notifyService?.playerStoppedWaiting(userId);
    this.lobbyService?.touch();
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

  /**
   * Tell the player and return true when they already have an active match.
   * A finished or missing match does not count.
   */
  private async refuseIfInMatch(socket: AuthenticatedSocket): Promise<boolean> {
    const existingMatchId = await redisService.getUserMatchId(
      socket.user.id,
      "queue_join_get_user_match"
    );
    if (!existingMatchId) return false;

    const match = await redisService.getMatch(existingMatchId, "queue_join_read_existing_match");
    if (match && match.status === "active") {
      console.log(`   ❌ User already in active match: ${existingMatchId}`);
      socket.emit("error", {
        message: "You are already in a match",
        code: "ALREADY_IN_MATCH",
      });
      return true;
    }
    return false;
  }

  /**
   * Start a Practice match against a bot right away.
   *
   * Ranked is people only; bots live here, labelled as bots. Practice matches
   * are unrated and never recorded, so they cannot move a rating, a record or
   * match history.
   */
  async startPractice(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;
    console.log(`\n🤖 PRACTICE request from ${user.username} (${user.id})`);

    if (!config.bot.enabled) {
      socket.emit("error", { message: "Practice is not available right now.", code: "PRACTICE_DISABLED" });
      return;
    }
    if (await this.refuseIfInMatch(socket)) return;

    // Leaving ranked for practice
    this.removeFromQueue(user.id);

    await this.createBotMatch(socket, {
      userId: user.id,
      socketId: socket.id,
      username: user.username,
      elo: user.elo,
      joinedAt: Date.now(),
    });
  }

  /**
   * Start a ghost duel: race a recording of someone's ranked win, on their
   * problem and their clock. Rated for this player only (see
   * GameService.recordGhostResult). The ghost seat's id is the recording's,
   * never the real player's, so nothing reaches them.
   */
  async startGhost(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;
    if (!config.ghost.enabled) {
      socket.emit("error", { message: "Ghost duels are switched off right now.", code: "GHOST_DISABLED" });
      return;
    }
    // A double click must not start two races
    if (this.startingGhost.has(user.id)) return;
    this.startingGhost.add(user.id);
    try {
      await this.setUpGhost(socket);
    } finally {
      this.startingGhost.delete(user.id);
    }
  }

  private async setUpGhost(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;
    if (await this.refuseIfInMatch(socket)) return;
    this.removeFromQueue(user.id);

    let recording;
    try {
      recording = await ghostService.pick(user.id, user.elo);
    } catch (error) {
      if (error instanceof NotAvailableError) {
        socket.emit("error", { message: "Ghost duels are not available yet.", code: "GHOST_UNAVAILABLE" });
      } else {
        console.error("❌ Could not pick a ghost:", error);
        socket.emit("error", { message: "Could not find a ghost to race. Try again.", code: "GHOST_ERROR" });
      }
      return;
    }
    const timeline = recording ? cleanTimeline(recording.timeline ?? []) : null;
    if (!recording || !timeline) {
      socket.emit("error", {
        message: "No ghosts to race yet. Every ranked win records one, so check back after a few ranked matches.",
        code: "NO_GHOSTS",
      });
      return;
    }
    const problem = await problemService.getProblemById(recording.problem_id);
    if (!problem) {
      socket.emit("error", { message: "Could not load the ghost's problem. Try again.", code: "GHOST_ERROR" });
      return;
    }

    const matchId = uuidv4();
    const seatId = `ghost_${recording.id}`;
    const startedAt = Date.now();
    const matchState: MatchState = {
      id: matchId,
      player1: { id: user.id, socketId: socket.id, username: user.username, elo: user.elo },
      player2: { id: seatId, socketId: "ghost", username: recording.username, elo: recording.player_rating },
      problemId: problem.id,
      problemTitle: problem.title,
      status: "active",
      winnerId: null,
      startedAt,
      finishedAt: null,
      mode: "ghost",
      problemRating: problem.difficulty,
      ghost: {
        recordingId: recording.id,
        playerId: recording.player_id,
        username: recording.username,
        rating: recording.player_rating,
      },
    };
    await redisService.createMatch(matchState, "ghost_match_create");

    // The ghost's winning code, shown under "Compare solutions" afterwards
    const solved = timeline[timeline.length - 1];
    await redisService
      .storeLastSubmission(matchId, [user.id, seatId], seatId, {
        code: recording.code,
        languageId: recording.language_id,
        status: "accepted",
        passed: solved.passed,
        total: solved.total,
        submittedAt: startedAt + solved.t,
      })
      .catch((error) => console.error("⚠️ Could not keep the ghost's code for comparing:", error));

    socket.join(matchId);
    socket.data.currentMatchId = matchId;

    const ghost = new GhostPlayer(this.io, matchId, seatId, timeline, () => {
      void this.gameService?.handleGhostSolved(matchId);
    });
    this.activeGhosts.set(matchId, ghost);

    socket.emit("match_found", {
      matchId,
      problem: {
        id: problem.id,
        title: problem.title,
        description: problem.description,
        difficulty: problem.difficulty,
        testCases: problem.testCases.filter((tc) => !tc.isHidden),
      },
      opponent: { id: seatId, username: recording.username, elo: recording.player_rating, isGhost: true },
      startTime: startedAt,
      mode: "ghost",
    });
    ghost.start();

    console.log(`👻 Ghost match ${matchId}: ${user.username} (${user.elo}) vs ${recording.username}'s ghost (${recording.player_rating})`);
    console.log(`   Problem: ${problem.title}; the ghost solves at ${Math.round(recording.solve_ms / 1000)}s`);
    analyticsService.matchStarted(matchState);
    this.lobbyService?.touch();
    this.setMatchTimeout(matchId, matchState);
  }

  getGhost(matchId: string): GhostPlayer | undefined {
    return this.activeGhosts.get(matchId);
  }

  /** Stop a ghost's replay when its match ends */
  cleanupGhost(matchId: string): void {
    const ghost = this.activeGhosts.get(matchId);
    if (ghost) {
      ghost.stop();
      this.activeGhosts.delete(matchId);
    }
  }

  /**
   * Add player to queue
   */
  async joinQueue(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;

    console.log(`\n🎮 JOIN_QUEUE request from ${user.username} (${user.id})`);

    if (await this.refuseIfInMatch(socket)) return;

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

    // Alone in the queue: if nobody turns up soon, tell people who asked to hear
    if (this.getQueueLength() === 1) {
      this.notifyService?.playerWaiting(entry, () => this.queuedPlayers.has(entry.userId) && this.getQueueLength() === 1);
    }

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
          elo: player.elo, // Practice is unrated; mirrors the player
        },
        problemId: problem.id,
        problemTitle: problem.title,
        status: "active",
        winnerId: null,
        startedAt: Date.now(),
        finishedAt: null,
        mode: "practice",
        problemRating: problem.difficulty,
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
        mode: "practice",
      };

      // Emit match_found to player
      socket.emit("match_found", matchFoundPayload);
      analyticsService.matchStarted(matchState);
      this.lobbyService?.touch();

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

    // A problem near both players' rating; the old pool if that band is empty
    const band = this.rankedBand(player1.elo, player2.elo);
    const problem =
      (await problemService.getRandomProblem(band)) ?? (await problemService.getRandomProblem());

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
      mode: "ranked",
      problemRating: problem.difficulty,
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
      mode: "ranked",
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
      mode: "ranked",
    };

    // Emit match found to each player
    socket1.emit("match_found", payload1);
    socket2.emit("match_found", payload2);
    analyticsService.matchStarted(matchState);
    this.lobbyService?.touch();

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
   * Start a friend match between the two players of a duel room. Called by
   * RoomService once both are ready. Unrated and not recorded (see
   * GameService.recordHumanResult); otherwise it plays exactly like ranked,
   * reconnect window and match timeout included.
   *
   * Every socket a player has in the room gets the match, so a second tab
   * on the room page follows along.
   *
   * Returns the problem's id, or null when no problem could be served.
   */
  async startFriendMatch(args: {
    matchId: string;
    roomCode: string;
    host: RoomPlayer;
    hostSockets: AuthenticatedSocket[];
    guest: RoomPlayer;
    guestSockets: AuthenticatedSocket[];
    difficulty: RoomDifficulty;
    /** The room's recent problems, so a rematch gets a new one */
    excludeProblemIds: string[];
  }): Promise<string | null> {
    const { matchId, roomCode, host, guest, hostSockets, guestSockets } = args;

    const band = ROOM_DIFFICULTIES[args.difficulty];
    const problem = await problemService.getRandomProblem({
      minRating: band.minRating,
      maxRating: band.maxRating,
      excludeIds: args.excludeProblemIds,
    });
    if (!problem) {
      console.error(`❌ Failed to get a ${args.difficulty} problem for friend match in room ${roomCode}`);
      return null;
    }

    // Neither is waiting for a ranked opponent any more
    this.removeFromQueue(host.id);
    this.removeFromQueue(guest.id);

    const matchState: MatchState = {
      id: matchId,
      player1: { ...host, socketId: hostSockets[0].id },
      player2: { ...guest, socketId: guestSockets[0].id },
      problemId: problem.id,
      problemTitle: problem.title,
      status: "active",
      winnerId: null,
      startedAt: Date.now(),
      finishedAt: null,
      mode: "friend",
      roomCode,
      problemRating: problem.difficulty,
    };
    await redisService.createMatch(matchState, "friend_match_create");

    const problemPayload = {
      id: problem.id,
      title: problem.title,
      description: problem.description,
      difficulty: problem.difficulty,
      testCases: problem.testCases.filter((tc) => !tc.isHidden),
    };
    const seats: Array<[AuthenticatedSocket[], RoomPlayer]> = [
      [hostSockets, guest],
      [guestSockets, host],
    ];
    for (const [sockets, opponent] of seats) {
      for (const socket of sockets) {
        socket.join(matchId);
        socket.data.currentMatchId = matchId;
        socket.emit("match_found", {
          matchId,
          problem: problemPayload,
          opponent: { id: opponent.id, username: opponent.username, elo: opponent.elo },
          startTime: matchState.startedAt,
          mode: "friend",
          roomCode,
        });
      }
    }

    analyticsService.matchStarted(matchState);
    this.lobbyService?.touch();
    console.log(`🤝 Friend match ${matchId} in room ${roomCode}: ${host.username} vs ${guest.username}`);
    console.log(`   Problem: ${problem.title} (${problem.difficulty}, ${args.difficulty})`);

    this.setMatchTimeout(matchId, matchState);
    return problem.id;
  }

  /**
   * The problem band for a ranked match: up to 100 above the two players'
   * average rating and 300 below it, inside what the problem bank holds
   * (800-2400). New players (1000) get 800-1100, close to the old pool.
   */
  rankedBand(rating1: number, rating2: number): { minRating: number; maxRating: number } {
    const average = ((Number.isFinite(rating1) ? rating1 : 1000) + (Number.isFinite(rating2) ? rating2 : 1000)) / 2;
    const center = Math.round(average / 100) * 100;
    const maxRating = Math.min(2400, Math.max(1000, center + 100));
    return { minRating: Math.max(800, maxRating - 300), maxRating };
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
        this.cleanupGhost(matchId);
        this.io.to(matchId).emit("game_over", {
          winnerId: null,
          reason: "Match timed out - no winner",
          ...(match.mode === "ghost" && { ghost: true }),
        });
        void this.integrityService?.finalize(match, null, "timeout");
        analyticsService.matchEnded(match, null);

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
    const isGhostMatch = match.mode === "ghost";
    const winnerId = match.player1.id === userId ? match.player2.id : match.player1.id;
    const loserId = userId;

    if (!isBotMatch && !isGhostMatch && !this.isUserInMatchRoom(matchId, winnerId)) {
      await redisService.updateMatchStatus(matchId, "finished", "disconnect_both_gone");
      this.io.to(matchId).emit("game_over", {
        winnerId: null,
        reason: "Both players disconnected",
      });
      void this.integrityService?.finalize(match, null, "abandoned");
      analyticsService.matchEnded(match, null);
      console.log(`🏁 Match ${matchId} ended: both players disconnected`);
      return;
    }

    const won = await redisService.setMatchWinner(matchId, winnerId, "disconnect_finish_match");
    if (!won) return;

    console.log(`🏆 ${winnerId} wins by disconnect in match ${matchId}`);
    const duration = Math.floor((Date.now() - match.startedAt) / 1000);

    if (isBotMatch) {
      // Practice: unrated and not recorded. The player is the one who left.
      this.cleanupBot(matchId);
      this.io.to(matchId).emit("game_over", { winnerId, reason: "You disconnected", practice: true });
      analyticsService.matchEnded(match, winnerId);
      return;
    }

    if (isGhostMatch) {
      // The racer left and did not come back: a loss to the ghost, rated
      this.cleanupGhost(matchId);
      await this.gameService?.recordGhostResult(match, false, duration, "unknown", "disconnect");
      return;
    }

    if (this.gameService) {
      await this.gameService.recordHumanResult(
        match,
        winnerId,
        loserId,
        duration,
        "unknown",
        { winner: "Opponent disconnected", loser: "You disconnected" },
        "disconnect"
      );
      return; // recordHumanResult notifies both players with their rating changes
    }

    this.io.to(matchId).emit("game_over", {
      winnerId,
      reason: "Opponent disconnected",
    });
  }
}
