import { Server as SocketServer } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import { redisService } from "./RedisService";
import { judgeService } from "./JudgeService";
import { problemService } from "./ProblemService";
import { BotCompletionResult } from "./BotPlayer";
import { config } from "../config";
import type { MatchmakingService } from "./MatchmakingService";
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
  private matchmakingService: MatchmakingService | null = null;

  constructor(io: SocketServer<ClientToServerEvents, ServerToClientEvents>) {
    this.io = io;
  }

  /**
   * Set MatchmakingService reference (for bot cleanup)
   */
  setMatchmakingService(matchmakingService: MatchmakingService): void {
    this.matchmakingService = matchmakingService;
  }

  /**
   * Handle code submission from a player
   */
  async handleSubmission(
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

      // Send private result to submitter
      socket.emit("submission_result", result);

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

    // Get updated match state
    const finalMatch = await redisService.getMatch(
      matchId,
      "submission_read_final_match"
    );

    if (!finalMatch) return;

    // Calculate match duration
    const duration = Math.floor((Date.now() - match.startedAt) / 1000);

    // Determine loser
    const loserId =
      match.player1.id === user.id ? match.player2.id : match.player1.id;

    // === PERSIST TO POSTGRESQL ===
    // Calculate ELO changes (simplified K=32 formula)
    const winnerElo =
      user.id === match.player1.id ? match.player1.elo : match.player2.elo;
    const loserElo =
      user.id === match.player1.id ? match.player2.elo : match.player1.elo;
    const eloChange = this.calculateEloChange(winnerElo, loserElo);

    await this.saveMatchToDatabase({
      matchId,
      winnerId: user.id,
      loserId,
      problemId: match.problemId,
      problemTitle: match.problemTitle,
      duration,
      player1Id: match.player1.id,
      player2Id: match.player2.id,
      eloChange, // Pass the calculated ELO change
      language: this.getLanguageName(languageId), // Track language used
    });

    // Get winner and loser sockets
    const winnerSocket = socket; // The one who solved it
    const loserSocketId =
      match.player1.id === user.id
        ? match.player2.socketId
        : match.player1.socketId;
    const loserSocket = this.io.sockets.sockets.get(loserSocketId);

    // Send personalized messages
    if (winnerSocket) {
      winnerSocket.emit("game_over", {
        winnerId: user.id,
        reason: "You solved it first!",
        newElo: winnerElo + eloChange,
      });
    }

    if (loserSocket) {
      loserSocket.emit("game_over", {
        winnerId: user.id,
        reason: "Opponent solved first",
        newElo: loserElo - eloChange,
      });
    }

    // Schedule cleanup with timer tracking to prevent memory leaks
    const timerId = setTimeout(async () => {
      this.cleanupTimers.delete(matchId);
      await this.cleanupMatch(matchId);
    }, 60000); // 60 second delay for review
    this.cleanupTimers.set(matchId, timerId);
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
        // Bot match - save using bot match method
        const bot = this.matchmakingService?.getBot(matchId);
        const botDifficulty = bot?.getDifficulty() || "medium";

        await this.saveBotMatchToDatabase({
          matchId,
          humanId: match.player1.id,
          botId: match.player2.id,
          botUsername: match.player2.username, // Get bot username from match state
          winnerId,
          problemId: match.problemId,
          problemTitle: match.problemTitle,
          duration: Math.floor((Date.now() - match.startedAt) / 1000),
          botDifficulty,
        });

        // Clean up bot
        if (this.matchmakingService) {
          this.matchmakingService.cleanupBot(matchId);
        }
      } else {
        // Human vs human match
        const winnerElo =
          winnerId === match.player1.id ? match.player1.elo : match.player2.elo;
        const loserElo =
          user.id === match.player1.id ? match.player1.elo : match.player2.elo;
        const eloChange = this.calculateEloChange(winnerElo, loserElo);

        await this.saveMatchToDatabase({
          matchId,
          winnerId,
          loserId: user.id,
          problemId: match.problemId,
          problemTitle: match.problemTitle,
          duration: Math.floor((Date.now() - match.startedAt) / 1000),
          player1Id: match.player1.id,
          player2Id: match.player2.id,
          result: "forfeit",
          eloChange,
          language: "unknown", // Forfeit - no language tracked
        });
      }

      // Get winner and loser sockets
      const winnerSocket =
        match.player1.id === winnerId
          ? this.io.sockets.sockets.get(match.player1.socketId)
          : this.io.sockets.sockets.get(match.player2.socketId);

      const loserSocket = socket; // The one who forfeited

      // Send personalized messages
      if (winnerSocket) {
        winnerSocket.emit("game_over", {
          winnerId,
          reason: "Opponent forfeited",
        });
      }

      if (loserSocket) {
        loserSocket.emit("game_over", {
          winnerId,
          reason: "You forfeited",
        });
      }

      // Schedule cleanup with timer tracking
      const timerId = setTimeout(async () => {
        this.cleanupTimers.delete(matchId);
        await this.cleanupMatch(matchId);
      }, 60000);
      this.cleanupTimers.set(matchId, timerId);
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

      // Save to database (only for human player)
      const bot = this.matchmakingService?.getBot(matchId);
      await this.saveBotMatchToDatabase({
        matchId,
        humanId: match.player1.id,
        botId: result.botId,
        botUsername: match.player2.username, // Get bot username from match state
        winnerId,
        problemId: match.problemId,
        problemTitle: match.problemTitle,
        duration: Math.floor((Date.now() - match.startedAt) / 1000),
        botDifficulty: bot?.getDifficulty() || "medium",
      });

      // Get human socket
      const humanSocket = this.io.sockets.sockets.get(match.player1.socketId);

      if (humanSocket) {
        humanSocket.emit("game_over", {
          winnerId,
          reason,
        });
      }

      // Cleanup bot
      if (this.matchmakingService) {
        this.matchmakingService.cleanupBot(matchId);
      }

      // Schedule match cleanup
      const timerId = setTimeout(async () => {
        this.cleanupTimers.delete(matchId);
        await this.cleanupMatch(matchId);
      }, 60000);
      this.cleanupTimers.set(matchId, timerId);
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
  }): Promise<void> {
    try {
      const ratingChange = data.eloChange || 25; // Use calculated ELO or default to 25
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
      } else {
        console.log(`💾 Match records saved for both players`);
        console.log(`📊 Stats will be auto-updated by database trigger`);
      }

      // NOTE: Stats are automatically updated by the database trigger
      // `update_user_stats_after_match` - no need to manually update here!
    } catch (error) {
      console.error("❌ Error in saveMatchToDatabase:", error);
    }
  }

  /**
   * Save bot match to PostgreSQL
   * Only creates ONE record for the human player
   */
  public async saveBotMatchToDatabase(data: {
    matchId: string;
    humanId: string;
    botId: string;
    botUsername?: string; // Optional bot display name
    winnerId: string;
    problemId: string;
    problemTitle: string;
    duration: number;
    botDifficulty: "easy" | "medium" | "hard";
  }): Promise<void> {
    try {
      const result = data.winnerId === data.humanId ? "won" : "lost";

      // Insert match record for human player
      const { error } = await supabase.from("matches").insert({
        player_id: data.humanId,
        opponent_id: "00000000-0000-0000-0000-000000000000", // Dummy bot profile UUID
        problem_id: data.problemId,
        problem_title: data.problemTitle,
        language: "unknown", // We don't track language for bot matches yet
        result,
        rating_change: 0, // No rating change for bot matches
        duration_seconds: data.duration,
        is_bot_match: true,
        bot_difficulty: data.botDifficulty,
        bot_username: data.botUsername || "Bot Player", // Store actual bot name
        completed_at: new Date().toISOString(),
      });

      if (error) {
        console.error("❌ Error saving bot match record:", error);
      } else {
        console.log(`💾 Bot match record saved for human player`);
        console.log(`📊 Stats will be auto-updated by database trigger`);
      }
    } catch (error) {
      console.error("❌ Error in saveBotMatchToDatabase:", error);
    }
  }

  /**
   * Calculate ELO change (simplified K=32 formula)
   */
  private calculateEloChange(winnerElo: number, loserElo: number): number {
    const K = 32;
    const expectedScore = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    return Math.round(K * (1 - expectedScore));
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

    // Remove sockets from room
    const sockets = await this.io.in(matchId).fetchSockets();
    for (const socket of sockets) {
      socket.leave(matchId);
      socket.data.currentMatchId = undefined;
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
