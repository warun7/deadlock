import { Server as SocketServer } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import { redisService } from "./RedisService";
import { judgeService, sanitizeSubmissionResult } from "./JudgeService";
import { problemService } from "./ProblemService";
import { BotCompletionResult } from "./BotPlayer";
import { config } from "../config";
import type { MatchmakingService } from "./MatchmakingService";
import type { RoomService } from "./RoomService";
import type { IntegrityService, MatchEndReason } from "./IntegrityService";
import {
  AuthenticatedSocket,
  SubmitCodePayload,
  SubmissionResult,
  MatchState,
  ServerToClientEvents,
  ClientToServerEvents,
} from "../types";

// Initialize Supabase client for persistence
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

/**
 * GameService - Handles the game loop, submissions, and win conditions
 *
 * This is the core game logic:
 * 1. Receives code submissions
 * 2. Broadcasts progress to opponent (psychological warfare!)
 * 3. Executes code via Judge0
 * 4. Handles atomic win condition
 * 5. Persists match history to PostgreSQL
 */
export class GameService {
  private io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private submissionsInFlight = new Set<string>();
  private lastSubmissionAt = new Map<string, number>();
  private static readonly SUBMISSION_COOLDOWN_MS = 3000;
  private matchmakingService: MatchmakingService | null = null;
  private roomService: RoomService | null = null;
  private integrityService: IntegrityService | null = null;

  constructor(io: SocketServer<ClientToServerEvents, ServerToClientEvents>) {
    this.io = io;
  }

  /**
   * Set MatchmakingService reference (for bot cleanup)
   */
  setMatchmakingService(matchmakingService: MatchmakingService): void {
    this.matchmakingService = matchmakingService;
  }

  /** Set RoomService reference (friend matches keep score in their room) */
  setRoomService(roomService: RoomService): void {
    this.roomService = roomService;
  }

  /** Set IntegrityService reference (fair play signals for ranked matches) */
  setIntegrityService(integrityService: IntegrityService): void {
    this.integrityService = integrityService;
  }

  /**
   * Handle code submission from a player
   */
  /**
   * Handle code submission from a player.
   *
   * Every submission runs the full test set on the Judge0 instance that shares
   * this server, so each player gets one submission in flight at a time and a
   * short cooldown between them. The client already prevents double submits;
   * this is what stops a script from doing it.
   */
  async handleSubmission(
    socket: AuthenticatedSocket,
    payload: SubmitCodePayload
  ): Promise<void> {
    const userId = socket.user.id;

    if (this.submissionsInFlight.has(userId)) {
      socket.emit("error", {
        message: "Your last submission is still being judged.",
        code: "SUBMISSION_IN_PROGRESS",
      });
      return;
    }

    const now = Date.now();
    const sinceLast = now - (this.lastSubmissionAt.get(userId) ?? 0);
    if (sinceLast < GameService.SUBMISSION_COOLDOWN_MS) {
      const wait = Math.ceil((GameService.SUBMISSION_COOLDOWN_MS - sinceLast) / 1000);
      socket.emit("error", {
        message: `Wait ${wait}s before submitting again.`,
        code: "SUBMISSION_TOO_FAST",
      });
      return;
    }

    this.submissionsInFlight.add(userId);
    this.lastSubmissionAt.set(userId, now);
    if (this.lastSubmissionAt.size > 5000) {
      for (const [id, at] of this.lastSubmissionAt) {
        if (now - at > GameService.SUBMISSION_COOLDOWN_MS) this.lastSubmissionAt.delete(id);
      }
    }

    try {
      await this.runSubmission(socket, payload);
    } finally {
      this.submissionsInFlight.delete(userId);
    }
  }

  private async runSubmission(
    socket: AuthenticatedSocket,
    payload: SubmitCodePayload
  ): Promise<void> {
    const user = socket.user;
    const matchId = socket.data.currentMatchId;

    if (!matchId) {
      socket.emit("error", {
        message: "You are not in a match",
        code: "NOT_IN_MATCH",
      });
      return;
    }

    // Get match state
    const match = await redisService.getMatch(matchId, "submission_read_match");

    if (!match) {
      socket.emit("error", {
        message: "Match not found",
        code: "MATCH_NOT_FOUND",
      });
      return;
    }

    // Validate match is still active
    if (match.status !== "active") {
      socket.emit("error", {
        message: "Match is not active",
        code: "MATCH_NOT_ACTIVE",
      });
      return;
    }

    console.log(`📝 ${user.username} submitted code in match ${matchId}`);

    // How the code was entered (ranked only); never holds up judging
    await this.integrityService
      ?.recordSubmission(match, user.id, payload.code, payload.telemetry)
      .catch((error) => console.error("⚠️ Could not record submission telemetry:", error));

    // Stop bot if this is a bot match
    if (this.matchmakingService) {
      const bot = this.matchmakingService.getBot(matchId);
      if (bot) {
        console.log(`🤖 Stopping bot for match ${matchId} - human submitted`);
        bot.stop();
      }
    }

    // === PSYCHOLOGICAL WARFARE ===
    // Broadcast to opponent that this player is testing
    this.io.to(matchId).emit("opponent_progress", {
      playerId: user.id,
      status: "Testing...",
    });

    // Get problem with test cases
    const problem = await problemService.getProblemById(match.problemId);

    if (!problem || problem.testCases.length === 0) {
      socket.emit("error", {
        message: "Problem test cases not found",
        code: "PROBLEM_NOT_FOUND",
      });
      return;
    }

    try {
      // Execute code against all test cases
      // Pass checker info for problems with multiple valid answers
      const result = await judgeService.executeCode(
        payload.code,
        payload.languageId,
        problem.testCases,
        problem.checkerType || "exact", // Default to exact match
        problem.checkerCode
      );

      // Broadcast progress (e.g., "3/10 tests passed")
      this.io.to(matchId).emit("opponent_progress", {
        playerId: user.id,
        status: result.status === "accepted" ? "Checking..." : "Testing...",
        testsProgress: `${result.passed}/${result.total}`,
      });

      // Send private result to submitter (hidden tests reduced to pass/fail)
      socket.emit("submission_result", sanitizeSubmissionResult(result));

      // === CHECK WIN CONDITION ===
      if (result.status === "accepted") {
        await this.handlePotentialWin(
          socket,
          match,
          result,
          payload.languageId
        );
      } else {
        // Broadcast failed attempt
        this.io.to(matchId).emit("opponent_progress", {
          playerId: user.id,
          status: "❌ Failed",
          testsProgress: `${result.passed}/${result.total}`,
        });
      }
    } catch (error: any) {
      console.error(`❌ Execution error for ${user.username}:`, error.message);

      // Broadcast error
      this.io.to(matchId).emit("opponent_progress", {
        playerId: user.id,
        status: "⚠️ Error",
      });

      socket.emit("submission_result", {
        status: "runtime_error",
        passed: 0,
        total: problem.testCases.length,
        stderr: error.message,
      });
    }
  }

  /**
   * Handle potential win - atomic operation
   * This is the critical "race condition" logic!
   */
  private async handlePotentialWin(
    socket: AuthenticatedSocket,
    match: MatchState,
    result: SubmissionResult,
    languageId: number
  ): Promise<void> {
    const user = socket.user;
    const matchId = match.id;

    console.log(`🏁 ${user.username} solved the problem in match ${matchId}!`);

    // Atomic operation to set winner
    // Only the first correct submission wins
    const wonTheRace = await redisService.setMatchWinner(
      matchId,
      user.id,
      "submission_set_winner"
    );

    if (!wonTheRace) {
      // Someone else already won
      console.log(`⏱️  ${user.username} was too late - match already finished`);
      socket.emit("error", {
        message: "Match already finished",
        code: "MATCH_FINISHED",
      });
      return;
    }

    // WE WON THE RACE!
    console.log(`🏆 ${user.username} WINS match ${matchId}!`);

    // Broadcast that this player has won (before game_over)
    this.io.to(matchId).emit("opponent_progress", {
      playerId: user.id,
      status: "✅ Solved!",
      testsProgress: `${result.passed}/${result.total}`,
    });

    const duration = Math.floor((Date.now() - match.startedAt) / 1000);
    const loserId = match.player1.id === user.id ? match.player2.id : match.player1.id;

    if (match.player2.socketId === "bot") {
      // Practice: unrated and not recorded
      this.matchmakingService?.cleanupBot(matchId);
      socket.emit("game_over", { winnerId: user.id, reason: "You solved it first!", practice: true });
      this.scheduleCleanup(matchId);
      return;
    }

    await this.recordHumanResult(
      match,
      user.id,
      loserId,
      duration,
      this.getLanguageName(languageId),
      { winner: "You solved it first!", loser: "Opponent solved first" },
      "solved"
    );
  }

  /**
   * Handle player forfeit
   */
  async handleForfeit(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.user;
    const matchId = socket.data.currentMatchId;

    if (!matchId) return;

    const match = await redisService.getMatch(matchId, "forfeit_read_match");
    if (!match || match.status !== "active") return;

    // Determine winner (the other player)
    const winnerId =
      match.player1.id === user.id ? match.player2.id : match.player1.id;

    const wonTheRace = await redisService.setMatchWinner(
      matchId,
      winnerId,
      "forfeit_set_winner"
    );

    if (wonTheRace) {
      console.log(`🏳️ ${user.username} forfeited match ${matchId}`);

      // Check if this is a bot match (bot is always player2 with socketId "bot")
      const isBotMatch = match.player2.socketId === "bot";

      if (isBotMatch) {
        // Practice: unrated and not recorded
        this.matchmakingService?.cleanupBot(matchId);
        socket.emit("game_over", { winnerId, reason: "You forfeited", practice: true });
        this.scheduleCleanup(matchId);
        return;
      }

      await this.recordHumanResult(
        match,
        winnerId,
        user.id,
        Math.floor((Date.now() - match.startedAt) / 1000),
        "unknown",
        { winner: "Opponent forfeited", loser: "You forfeited" },
        "forfeit"
      );
    }
  }

  /**
   * Handle bot completion (win or fail)
   */
  async handleBotCompletion(
    matchId: string,
    result: BotCompletionResult
  ): Promise<void> {
    try {
      console.log(`🤖 Bot completion for match ${matchId}:`, result);

      const match = await redisService.getMatch(
        matchId,
        "bot_completion_read_match"
      );

      if (!match) {
        console.warn(`[Bot] Match ${matchId} not found`);
        return;
      }

      if (match.status !== "active") {
        console.warn(
          `[Bot] Match ${matchId} is not active (status: ${match.status})`
        );
        return;
      }

      // Determine winner
      let winnerId: string;
      let loserId: string;
      let reason: string;

      if (result.result === "success") {
        // Bot won
        winnerId = result.botId;
        loserId = match.player1.id; // Human is player1
        reason = "Opponent solved first";
      } else {
        // Bot failed - human wins by default
        winnerId = match.player1.id; // Human is player1
        loserId = result.botId;
        reason = `Opponent failed (${result.testsPassed}/${result.totalTests} tests passed)`;
      }

      // Set winner atomically
      const wonTheRace = await redisService.setMatchWinner(
        matchId,
        winnerId,
        "bot_completion_set_winner"
      );

      if (!wonTheRace) {
        console.log(`[Bot] Race condition: human already won match ${matchId}`);
        return;
      }

      console.log(
        `🏆 Bot match ${matchId} ended - Winner: ${
          winnerId === result.botId ? "BOT" : "HUMAN"
        }`
      );

      // Practice: unrated and not recorded
      const humanSocket = this.io.sockets.sockets.get(match.player1.socketId);

      if (humanSocket) {
        humanSocket.emit("game_over", {
          winnerId,
          reason,
          practice: true,
        });
      }

      // Cleanup bot
      if (this.matchmakingService) {
        this.matchmakingService.cleanupBot(matchId);
      }

      this.scheduleCleanup(matchId);
    } catch (error) {
      console.error(`❌ Error in handleBotCompletion:`, error);
    }
  }

  /**
   * Save match to PostgreSQL
   * Creates TWO records - one for each player with their perspective
   */
  public async saveMatchToDatabase(data: {
    matchId: string;
    winnerId: string;
    loserId: string;
    problemId: string;
    problemTitle?: string;
    duration: number;
    player1Id: string;
    player2Id: string;
    result?: string;
    language?: string;
    eloChange?: number;
  }): Promise<boolean> {
    try {
      const ratingChange = data.eloChange ?? 0;
      // Migration 006 dropped the original 8-argument signature and redefined
      // this function with `p_problem_id_ref` (no default) so it can write the
      // canonical `game_sessions` row. PostgREST resolves RPCs by argument
      // name, so omitting it made EVERY call fail with PGRST202 "function not
      // found" -- swallowed by the catch below, meaning human-vs-human matches
      // were never saved at all. Bot matches were unaffected because they
      // insert into `matches` directly.
      //
      // `problemId` is the numeric `problems.id` (ProblemService returns
      // `problem.id.toString()`), so it doubles as the integer FK. The fallback
      // problem has a non-numeric id, hence the NaN guard.
      const problemIdRef = Number.parseInt(data.problemId, 10);
      const { error } = await supabase.rpc("record_match_pair", {
        p_winner_id: data.winnerId,
        p_loser_id: data.loserId,
        p_problem_id: data.problemId,
        p_problem_id_ref: Number.isNaN(problemIdRef) ? null : problemIdRef,
        p_problem_title: data.problemTitle || "Unknown Problem",
        p_language: data.language || "unknown",
        p_duration_seconds: data.duration,
        p_rating_change: ratingChange,
        p_completed_at: new Date().toISOString(),
      });

      if (error) {
        // This used to be an easy-to-miss log line, which is exactly how the
        // stale 8-argument call above went unnoticed while every finished
        // match silently failed to save. Say what was actually lost.
        console.error(
          "❌ MATCH NOT RECORDED — record_match_pair failed, no match history or " +
            "stats were written for this game:",
          { matchId: data.matchId, problemId: data.problemId, error }
        );
        return false;
      } else {
        console.log(`💾 Match records saved for both players`);
        console.log(`📊 Stats and ratings are updated by database triggers`);
        return true;
      }

      // NOTE: Stats are automatically updated by the database trigger
      // `update_user_stats_after_match` - no need to manually update here!
    } catch (error) {
      console.error("❌ Error in saveMatchToDatabase:", error);
      return false;
    }
  }

    /**
   * Calculate ELO change (simplified K=32 formula)
   */
  private calculateEloChange(winnerElo: number, loserElo: number): number {
    const K = 32;
    const expectedScore = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    // A win is always worth at least one point, even against a far weaker player
    return Math.max(1, Math.round(K * (1 - expectedScore)));
  }

  /**
   * Score a finished human-vs-human match: rate it with both players' current
   * ratings (read fresh, since a socket can outlive several matches), write
   * both history rows (a database trigger applies the rating change), tell
   * each player their own result, and schedule cleanup.
   *
   * Friend matches stop short of the database: they are unrated and stay off
   * the record, and their room keeps the score instead.
   */
  public async recordHumanResult(
    match: MatchState,
    winnerId: string,
    loserId: string,
    duration: number,
    language: string,
    reasons: { winner: string; loser: string },
    endReason: MatchEndReason
  ): Promise<void> {
    if (match.mode === "friend") {
      await this.finishFriendMatch(match, winnerId, loserId, reasons);
      return;
    }

    const ratings = await this.fetchRatings([winnerId, loserId]);
    const winnerRating = ratings.get(winnerId) ?? this.ratingFromMatch(match, winnerId);
    const loserRating = ratings.get(loserId) ?? this.ratingFromMatch(match, loserId);
    const change = this.calculateEloChange(winnerRating, loserRating);

    const saved = await this.saveMatchToDatabase({
      matchId: match.id,
      winnerId,
      loserId,
      problemId: match.problemId,
      problemTitle: match.problemTitle,
      duration,
      player1Id: match.player1.id,
      player2Id: match.player2.id,
      eloChange: change,
      language,
    });

    // Only promise a rating change the database actually recorded
    this.emitToUser(winnerId, "game_over", {
      winnerId,
      reason: reasons.winner,
      ...(saved ? { ratingChange: change, newRating: winnerRating + change } : {}),
    });
    this.emitToUser(loserId, "game_over", {
      winnerId,
      reason: reasons.loser,
      ...(saved ? { ratingChange: -change, newRating: Math.max(0, loserRating - change) } : {}),
    });

    // Fair play signals for both players; runs after the result is out
    void this.integrityService?.finalize(match, winnerId, endReason);

    this.scheduleCleanup(match.id);
  }

  private async finishFriendMatch(
    match: MatchState,
    winnerId: string,
    loserId: string,
    reasons: { winner: string; loser: string }
  ): Promise<void> {
    let wins: Map<string, number> | null = null;
    if (match.roomCode && this.roomService) {
      try {
        wins = await this.roomService.recordWin(match.roomCode, match.id, winnerId);
      } catch (error) {
        console.error(`⚠️ Could not update the score in room ${match.roomCode}:`, error);
      }
    }
    const scoreFor = (you: string, opponent: string) =>
      wins ? { score: { you: wins.get(you) ?? 0, opponent: wins.get(opponent) ?? 0 } } : {};
    const common = { winnerId, friendly: true, roomCode: match.roomCode };

    this.emitToUser(winnerId, "game_over", { ...common, reason: reasons.winner, ...scoreFor(winnerId, loserId) });
    this.emitToUser(loserId, "game_over", { ...common, reason: reasons.loser, ...scoreFor(loserId, winnerId) });
    console.log(`🤝 Friend match ${match.id} won by ${winnerId} (unrated, not recorded)`);

    this.scheduleCleanup(match.id);
  }

  /** Current ratings from profiles; missing rows are simply left out */
  private async fetchRatings(userIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    try {
      const { data, error } = await supabase.from("profiles").select("id, rating").in("id", userIds);
      if (error) throw error;
      for (const row of data ?? []) {
        if (typeof row.rating === "number") out.set(row.id, row.rating);
      }
    } catch (error) {
      console.error("⚠️ Could not read current ratings, using the ones from match start:", error);
    }
    return out;
  }

  private ratingFromMatch(match: MatchState, userId: string): number {
    return match.player1.id === userId ? match.player1.elo : match.player2.elo;
  }

  /** Emit to every live socket of a player (they may have reconnected on a new one) */
  private emitToUser<E extends keyof ServerToClientEvents>(
    userId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    for (const s of this.io.sockets.sockets.values()) {
      if ((s as AuthenticatedSocket).user?.id === userId) s.emit(event, ...args);
    }
  }

  /** Keep a finished match around for a minute so players can review, then drop it */
  private scheduleCleanup(matchId: string): void {
    const existing = this.cleanupTimers.get(matchId);
    if (existing) clearTimeout(existing);
    const timerId = setTimeout(async () => {
      this.cleanupTimers.delete(matchId);
      await this.cleanupMatch(matchId);
    }, 60000);
    this.cleanupTimers.set(matchId, timerId);
  }

  /**
   * Convert Judge0 language ID to language name
   */
  private getLanguageName(languageId: number): string {
    const languageMap: Record<number, string> = {
      71: "python", // Python 3
      63: "javascript", // JavaScript (Node.js)
      54: "cpp", // C++ (GCC)
      62: "java", // Java
      73: "rust", // Rust
      60: "go", // Go
      78: "kotlin", // Kotlin
      83: "swift", // Swift
      51: "csharp", // C#
      72: "ruby", // Ruby
    };

    return languageMap[languageId] || `lang_${languageId}`;
  }

  /**
   * Cleanup match data
   */
  private async cleanupMatch(matchId: string): Promise<void> {
    // Clear timer if it exists
    const timerId = this.cleanupTimers.get(matchId);
    if (timerId) {
      clearTimeout(timerId);
      this.cleanupTimers.delete(matchId);
    }

    // Remove sockets from room. A player who went straight into a rematch
    // (or a new queue pop) is in that match now; leave their pointer alone.
    const sockets = await this.io.in(matchId).fetchSockets();
    for (const socket of sockets) {
      socket.leave(matchId);
      if (socket.data.currentMatchId === matchId) socket.data.currentMatchId = undefined;
    }

    // Delete from Redis
    await redisService.deleteMatch(matchId, "cleanup_delete_match");
  }

  /**
   * Clear all cleanup timers (call on server shutdown)
   */
  clearAllTimers(): void {
    console.log(`🧹 Clearing ${this.cleanupTimers.size} cleanup timers`);
    for (const [matchId, timerId] of this.cleanupTimers.entries()) {
      clearTimeout(timerId);
    }
    this.cleanupTimers.clear();
  }
}
