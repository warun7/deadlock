import { Server as SocketServer } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import { redisService } from "./RedisService";
import { judgeService } from "./JudgeService";
import { problemService } from "./ProblemService";
import { BotCompletionResult } from "./BotPlayer";
import { config } from "../config";
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
  config.supabase.serviceRoleKey || config.supabase.anonKey,
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
  private matchmakingService: any; // Will be set after construction

  constructor(io: SocketServer<ClientToServerEvents, ServerToClientEvents>) {
    this.io = io;
  }

  /**
   * Set MatchmakingService reference (for bot cleanup)
   */
  setMatchmakingService(matchmakingService: any): void {
    this.matchmakingService = matchmakingService;
  }

  /**
   * Handle code submission from a player
   */
  async handleSubmission(
    socket: AuthenticatedSocket,
    payload: SubmitCodePayload,
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
    const match = await redisService.getMatch(matchId);

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
        problem.checkerCode,
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
          payload.languageId,
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
    languageId: number,
  ): Promise<void> {
    const user = socket.user;
    const matchId = match.id;

    console.log(`🏁 ${user.username} solved the problem in match ${matchId}!`);

    // Atomic operation to set winner
    // Only the first correct submission wins
    const wonTheRace = await redisService.setMatchWinner(matchId, user.id);

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
    const finalMatch = await redisService.getMatch(matchId);

    if (!finalMatch) return;

    // Calculate match duration
    const duration = Math.floor((Date.now() - match.startedAt) / 1000);

    // Determine loser
    const loserId =
      match.player1.id === user.id ? match.player2.id : match.player1.id;

    // === PERSIST TO POSTGRESQL ===
    const isRanked = match.matchType === "ranked";

    // Calculate ELO changes (simplified K=32 formula)
    const winnerElo =
      user.id === match.player1.id ? match.player1.elo : match.player2.elo;
    const loserElo =
      user.id === match.player1.id ? match.player2.elo : match.player1.elo;
    const eloChange = isRanked
      ? this.calculateEloChange(winnerElo, loserElo)
      : 0;

    await this.saveMatchToDatabase({
      matchId,
      winnerId: user.id,
      loserId,
      problemId: match.problemId,
      problemTitle: match.problemTitle,
      duration,
      player1Id: match.player1.id,
      player2Id: match.player2.id,
      eloChange,
      language: this.getLanguageName(languageId),
      matchType: match.matchType,
    });

    // Compute new rank tiers
    const newWinnerElo = winnerElo + eloChange;
    const newLoserElo = Math.max(0, loserElo - eloChange);
    const winnerTier = this.computeRankTier(newWinnerElo);
    const loserTier = this.computeRankTier(newLoserElo);

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
        newElo: newWinnerElo,
        eloChange: isRanked ? eloChange : undefined,
        matchType: match.matchType,
        newRankTier: isRanked ? winnerTier : undefined,
      });
    }

    if (loserSocket) {
      loserSocket.emit("game_over", {
        winnerId: user.id,
        reason: "Opponent solved first",
        newElo: newLoserElo,
        eloChange: isRanked ? -eloChange : undefined,
        matchType: match.matchType,
        newRankTier: isRanked ? loserTier : undefined,
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

    const match = await redisService.getMatch(matchId);
    if (!match || match.status !== "active") return;

    // Determine winner (the other player)
    const winnerId =
      match.player1.id === user.id ? match.player2.id : match.player1.id;

    const wonTheRace = await redisService.setMatchWinner(matchId, winnerId);

    if (wonTheRace) {
      console.log(`🏳️ ${user.username} forfeited match ${matchId}`);

      const isRanked = match.matchType === "ranked";

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
          botUsername: match.player2.username,
          winnerId,
          problemId: match.problemId,
          problemTitle: match.problemTitle,
          duration: Math.floor((Date.now() - match.startedAt) / 1000),
          botDifficulty,
          matchType: match.matchType,
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
        const eloChange = isRanked
          ? this.calculateEloChange(winnerElo, loserElo)
          : 0;

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
          language: "unknown",
          matchType: match.matchType,
        });
      }

      // Compute ELO info for game_over payload
      const winnerElo =
        winnerId === match.player1.id ? match.player1.elo : match.player2.elo;
      const loserElo =
        user.id === match.player1.id ? match.player1.elo : match.player2.elo;
      const eloChange = isRanked
        ? this.calculateEloChange(winnerElo, loserElo)
        : 0;

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
          newElo: isRanked ? winnerElo + eloChange : undefined,
          eloChange: isRanked ? eloChange : undefined,
          matchType: match.matchType,
          newRankTier: isRanked
            ? this.computeRankTier(winnerElo + eloChange)
            : undefined,
        });
      }

      if (loserSocket) {
        loserSocket.emit("game_over", {
          winnerId,
          reason: "You forfeited",
          newElo: isRanked ? Math.max(0, loserElo - eloChange) : undefined,
          eloChange: isRanked ? -eloChange : undefined,
          matchType: match.matchType,
          newRankTier: isRanked
            ? this.computeRankTier(Math.max(0, loserElo - eloChange))
            : undefined,
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
    result: BotCompletionResult,
  ): Promise<void> {
    try {
      console.log(`🤖 Bot completion for match ${matchId}:`, result);

      const match = await redisService.getMatch(matchId);

      if (!match) {
        console.warn(`[Bot] Match ${matchId} not found`);
        return;
      }

      if (match.status !== "active") {
        console.warn(
          `[Bot] Match ${matchId} is not active (status: ${match.status})`,
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
      const wonTheRace = await redisService.setMatchWinner(matchId, winnerId);

      if (!wonTheRace) {
        console.log(`[Bot] Race condition: human already won match ${matchId}`);
        return;
      }

      console.log(
        `🏆 Bot match ${matchId} ended - Winner: ${
          winnerId === result.botId ? "BOT" : "HUMAN"
        }`,
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
    matchType?: string;
  }): Promise<void> {
    try {
      const ratingChange = data.eloChange ?? 0;
      const matchType = data.matchType || "unranked";

      // Insert match record for winner
      const { error: winnerError } = await supabase.from("matches").insert({
        player_id: data.winnerId,
        opponent_id: data.loserId,
        problem_id: data.problemId,
        problem_title: data.problemTitle || "Unknown Problem",
        language: data.language || "unknown",
        result: "won",
        rating_change: ratingChange,
        duration_seconds: data.duration,
        match_type: matchType,
        completed_at: new Date().toISOString(),
      });

      if (winnerError) {
        console.error("❌ Error saving winner match record:", winnerError);
      }

      // Insert match record for loser
      const { error: loserError } = await supabase.from("matches").insert({
        player_id: data.loserId,
        opponent_id: data.winnerId,
        problem_id: data.problemId,
        problem_title: data.problemTitle || "Unknown Problem",
        language: data.language || "unknown",
        result: "lost",
        rating_change: -ratingChange,
        duration_seconds: data.duration,
        match_type: matchType,
        completed_at: new Date().toISOString(),
      });

      if (loserError) {
        console.error("❌ Error saving loser match record:", loserError);
      }

      if (!winnerError && !loserError) {
        console.log(
          `💾 Match records saved for both players [${matchType}${
            matchType === "ranked"
              ? ` ELO: +${ratingChange}/-${ratingChange}`
              : ""
          }]`,
        );
        console.log(`📊 Stats will be auto-updated by database trigger`);
      }

      // NOTE: Stats (including ELO for ranked) are automatically updated
      // by the database trigger `update_user_stats_after_match`
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
    botUsername?: string;
    winnerId: string;
    problemId: string;
    problemTitle: string;
    duration: number;
    botDifficulty: "easy" | "medium" | "hard";
    matchType?: string;
  }): Promise<void> {
    try {
      const result = data.winnerId === data.humanId ? "won" : "lost";
      const matchType = data.matchType || "unranked";
      const isRanked = matchType === "ranked";

      // For ranked bot matches, calculate ELO change
      // Bot ELO is 1000, human ELO needs to be fetched
      let ratingChange = 0;
      if (isRanked) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("current_rating")
          .eq("id", data.humanId)
          .single();

        const humanElo = profile?.current_rating || 1200;
        const botElo = 1000;

        if (result === "won") {
          ratingChange = this.calculateEloChange(humanElo, botElo);
        } else {
          ratingChange = -this.calculateEloChange(botElo, humanElo);
        }
      }

      // Insert match record for human player
      const { error } = await supabase.from("matches").insert({
        player_id: data.humanId,
        opponent_id: "00000000-0000-0000-0000-000000000000",
        problem_id: data.problemId,
        problem_title: data.problemTitle,
        language: "unknown",
        result,
        rating_change: ratingChange,
        duration_seconds: data.duration,
        is_bot_match: true,
        bot_difficulty: data.botDifficulty,
        bot_username: data.botUsername || "Bot Player",
        match_type: matchType,
        completed_at: new Date().toISOString(),
      });

      if (error) {
        console.error("❌ Error saving bot match record:", error);
      } else {
        console.log(
          `💾 Bot match record saved [${matchType}${
            isRanked
              ? ` ELO: ${ratingChange > 0 ? "+" : ""}${ratingChange}`
              : ""
          }]`,
        );
        console.log(`📊 Stats will be auto-updated by database trigger`);
      }
    } catch (error) {
      console.error("❌ Error in saveBotMatchToDatabase:", error);
    }
  }

  /**
   * Update player statistics after a match
   *
   * ⚠️ DEPRECATED: This function is no longer used.
   * Stats are now automatically updated by the database trigger
   * `update_user_stats_after_match` when a match is inserted.
   *
   * Keeping this function for reference/backup purposes only.
   */
  private async updatePlayerStats(
    playerId: string,
    won: boolean,
  ): Promise<void> {
    // This function is deprecated - stats are handled by DB trigger
    console.warn(
      `⚠️ updatePlayerStats called but is deprecated - using DB trigger instead`,
    );
    return;

    /* DEPRECATED CODE - kept for reference
    try {
      // Get current stats
      const { data: profile, error: fetchError } = await supabase
        .from("profiles")
        .select(
          "total_matches, matches_won, matches_lost, current_streak, best_streak"
        )
        .eq("id", playerId)
        .single();

      if (fetchError) {
        console.error(`Error fetching profile for ${playerId}:`, fetchError);
        return;
      }

      // Calculate new stats
      const totalMatches = (profile?.total_matches || 0) + 1;
      const matchesWon = (profile?.matches_won || 0) + (won ? 1 : 0);
      const matchesLost = (profile?.matches_lost || 0) + (won ? 0 : 1);
      const currentStreak = won ? (profile?.current_streak || 0) + 1 : 0;
      const bestStreak = Math.max(currentStreak, profile?.best_streak || 0);
      const winRate = totalMatches > 0 ? (matchesWon / totalMatches) * 100 : 0;

      // Update profile
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          total_matches: totalMatches,
          matches_won: matchesWon,
          matches_lost: matchesLost,
          current_streak: currentStreak,
          best_streak: bestStreak,
          win_rate: winRate,
        })
        .eq("id", playerId);

      if (updateError) {
        console.error(`Error updating profile for ${playerId}:`, updateError);
      } else {
        console.log(
          `📊 Updated stats for ${playerId}: ${matchesWon}W/${matchesLost}L`
        );
      }
    } catch (error) {
      console.error(`Error in updatePlayerStats for ${playerId}:`, error);
    }
    */
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
   * Compute rank tier from ELO rating (mirrors DB function)
   */
  private computeRankTier(elo: number): string {
    if (elo >= 1800) return "Master";
    if (elo >= 1600) return "Diamond";
    if (elo >= 1400) return "Platinum";
    if (elo >= 1200) return "Gold";
    if (elo >= 1000) return "Silver";
    if (elo >= 800) return "Bronze";
    return "Iron";
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
    await redisService.deleteMatch(matchId);
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
