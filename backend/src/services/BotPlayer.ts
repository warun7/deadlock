import { Server as SocketServer } from "socket.io";

interface BotConfig {
  difficulty: "easy" | "medium" | "hard";
  problemRating: number;
  socketServer: SocketServer;
  matchId: string;
  onComplete: (result: BotCompletionResult) => void;
}

interface ProgressCheckpoint {
  time: number; // Delay in ms
  percentage: number; // 0-100
  status: string; // Status message
}

export interface BotCompletionResult {
  botId: string;
  result: "success" | "failed";
  testsPassed: number;
  totalTests: number;
}

/**
 * BotPlayer - Simulates a human opponent in matches
 *
 * This class creates a realistic bot opponent that:
 * - Has human-like usernames
 * - Shows progressive solving behavior
 * - Sometimes fails (to let humans win)
 * - Doesn't consume Judge0 resources
 */
export class BotPlayer {
  public id: string;
  public username: string;
  public isBot: boolean = true;

  private difficulty: "easy" | "medium" | "hard";
  private targetTime: number;
  private io: SocketServer;
  private matchId: string;
  private progress: number = 0;
  private timeouts: NodeJS.Timeout[] = [];
  private isStopped: boolean = false;
  private onComplete: (result: BotCompletionResult) => void;

  constructor(config: BotConfig) {
    this.id = `bot_${Math.random().toString(36).substr(2, 9)}`;
    this.username = this.generateUsername();
    this.difficulty = config.difficulty;
    this.io = config.socketServer;
    this.matchId = config.matchId;
    this.onComplete = config.onComplete;

    // Calculate target time based on problem difficulty and bot tier
    this.targetTime = this.calculateTargetTime(
      config.problemRating,
      config.difficulty
    );
  }

  /**
   * Generate a realistic-looking username
   */
  private generateUsername(): string {
    const usernames = [
      "CodeNinja_47",
      "AlgoWizard_23",
      "ByteMaster_89",
      "DebugKing_51",
      "LogicLord_77",
      "SyntaxSage_42",
      "RuntimeRuler_19",
      "StackSolver_88",
      "GitGuru_33",
      "ArrayAce_56",
      "LoopLegend_44",
      "RecursionRex_91",
      "BinaryBoss_72",
      "HeapHero_38",
      "GraphGod_65",
      "TreeTraverser_29",
      "DPDynamo_84",
      "GreedyGenius_53",
      "SortSorcerer_76",
      "QueueQueen_41",
      "HashHacker_97",
      "LinkedLion_63",
      "StackSamurai_18",
      "BitBender_55",
    ];

    return usernames[Math.floor(Math.random() * usernames.length)];
  }

  /**
   * Calculate target time based on problem rating and bot difficulty
   */
  private calculateTargetTime(
    problemRating: number,
    difficulty: "easy" | "medium" | "hard"
  ): number {
    // Base time from problem difficulty
    let baseTime: number;
    if (problemRating < 1000) {
      baseTime = 180000; // 3 minutes
    } else if (problemRating < 1200) {
      baseTime = 240000; // 4 minutes
    } else {
      baseTime = 300000; // 5 minutes
    }

    // Multipliers based on bot difficulty
    const multipliers = {
      easy: { min: 1.8, max: 2.5 }, // Bot is much slower
      medium: { min: 1.2, max: 1.6 }, // Bot is slightly slower
      hard: { min: 0.9, max: 1.1 }, // Bot is competitive
    };

    const range = multipliers[difficulty];
    const randomMultiplier =
      range.min + Math.random() * (range.max - range.min);

    return Math.floor(baseTime * randomMultiplier);
  }

  /**
   * Generate realistic progress checkpoints
   */
  private generateProgressCheckpoints(): ProgressCheckpoint[] {
    const baseTime = this.targetTime;

    // Add some randomness to make it feel more human
    const noise = () => Math.random() * 2000 - 1000; // ±1 second

    return [
      {
        time: Math.floor(baseTime * 0.1) + noise(),
        percentage: 0,
        status: "Reading problem",
      },
      {
        time: Math.floor(baseTime * 0.25) + noise(),
        percentage: 15,
        status: "Thinking",
      },
      {
        time: Math.floor(baseTime * 0.4) + noise(),
        percentage: 30,
        status: "Coding solution",
      },
      {
        time: Math.floor(baseTime * 0.6) + noise(),
        percentage: 50,
        status: "Testing locally",
      },
      {
        time: Math.floor(baseTime * 0.75) + noise(),
        percentage: 70,
        status: "Debugging",
      },
      {
        time: Math.floor(baseTime * 0.9) + noise(),
        percentage: 85,
        status: "Final checks",
      },
      {
        time: Math.floor(baseTime * 0.98) + noise(),
        percentage: 100,
        status: "Submitting",
      },
    ];
  }

  /**
   * Start the bot's solving simulation
   */
  public start(): void {
    const checkpoints = this.generateProgressCheckpoints();

    checkpoints.forEach((checkpoint) => {
      const timeout = setTimeout(() => {
        if (this.isStopped) return;

        this.progress = checkpoint.percentage;

        // Emit progress to the room
        this.io.to(this.matchId).emit("opponent_progress", {
          playerId: this.id,
          status: checkpoint.status,
          percentage: this.progress,
        });

        // Win condition - bot always wins if it reaches 100%
        if (this.progress >= 100) {
          this.submitWinningSolution();
        }
      }, checkpoint.time);

      this.timeouts.push(timeout);
    });
  }

  /**
   * Bot submits a winning solution
   */
  private submitWinningSolution(): void {
    if (this.isStopped) return;

    // Emit final progress
    this.io.to(this.matchId).emit("opponent_progress", {
      playerId: this.id,
      status: "Accepted",
      percentage: 100,
    });

    // Small delay to show "Accepted" status
    setTimeout(() => {
      if (this.isStopped) return;

      // Call completion callback - bot always wins if it completes
      this.onComplete({
        botId: this.id,
        result: "success",
        testsPassed: 10,
        totalTests: 10,
      });
    }, 500);
  }

  /**
   * Stop the bot (called when human wins first)
   */
  public stop(): void {
    this.isStopped = true;

    // Clear all timeouts
    this.timeouts.forEach((timeout) => clearTimeout(timeout));
    this.timeouts = [];
  }

  /**
   * Get bot player info (for match data)
   * IMPORTANT: Never expose isBot to frontend
   */
  public getPlayerInfo() {
    return {
      id: this.id,
      username: this.username,
      elo: 1000, // Default bot ELO (not shown in UI anymore)
      // Optional: Add fake stats to make it look real
      stats: {
        totalMatches: Math.floor(Math.random() * 50) + 10,
        winRate: parseFloat((Math.random() * 30 + 40).toFixed(2)), // 40-70% win rate
      },
    };
  }

  /**
   * Get bot difficulty (for analytics)
   */
  public getDifficulty(): "easy" | "medium" | "hard" {
    return this.difficulty;
  }
}
