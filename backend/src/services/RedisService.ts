import Redis from "ioredis";
import { config } from "../config";
import { MatchState } from "../types";
import { createModuleLogger } from "../utils/logger";

interface RedisMetricBucket {
  calls: number;
  success: number;
  failure: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number;
}

interface RedisMetricsSnapshot {
  since: string;
  totals: RedisMetricBucket;
  operations: Record<string, RedisMetricBucket>;
  commands: Record<string, RedisMetricBucket>;
}

interface RedisDebugMatchesSnapshot {
  matches: Array<Record<string, string>>;
  userMatches: Array<{ key: string; matchId: string | null }>;
}

const redisLogger = createModuleLogger("redis");

// Redis connection options for Upstash (TLS required)
const REDIS_OPTIONS = {
  maxRetriesPerRequest: null, // Disable per-request retry limit to prevent unhandled rejections
  enableReadyCheck: false, // Faster reconnect
  tls: {}, // Required for Upstash - enables TLS connection
  retryStrategy: (times: number) => {
    // Exponential backoff: 100ms, 200ms, 400ms... max 5 seconds
    const delay = Math.min(times * 100, 5000);
    console.log(`🔄 Redis reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  reconnectOnError: (err: Error) => {
    // Reconnect on connection reset errors
    if (
      err.message.includes("READONLY") ||
      err.message.includes("ECONNRESET")
    ) {
      return true;
    }
    return false;
  },
  lazyConnect: true,
  keepAlive: 30000, // Keep connection alive every 30 seconds
  connectTimeout: 15000, // 15 second connection timeout
};

/**
 * RedisService - Manages all Redis operations for the real-time layer
 *
 * Redis is the source of truth for active match state and reconnect support.
 * Matchmaking queue state is event-driven and kept in-process.
 */
export class RedisService {
  private client: Redis;
  private metricsStartedAt = new Date();
  private totals: RedisMetricBucket = this.createEmptyBucket();
  private operationMetrics: Map<string, RedisMetricBucket> = new Map();
  private commandMetrics: Map<string, RedisMetricBucket> = new Map();

  constructor() {
    this.client = new Redis(config.redisUrl, REDIS_OPTIONS);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on("error", (err) => {
      console.error("❌ Redis Client Error:", err.message);
    });

    this.client.on("connect", () => {
      console.log("✅ Redis Client connected");
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  private createEmptyBucket(): RedisMetricBucket {
    return {
      calls: 0,
      success: 0,
      failure: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      lastDurationMs: 0,
    };
  }

  private updateBucket(
    bucket: RedisMetricBucket,
    durationMs: number,
    success: boolean
  ): void {
    bucket.calls += 1;
    bucket.totalDurationMs += durationMs;
    bucket.lastDurationMs = durationMs;
    bucket.maxDurationMs = Math.max(bucket.maxDurationMs, durationMs);

    if (success) {
      bucket.success += 1;
    } else {
      bucket.failure += 1;
    }
  }

  private recordMetric(
    operation: string,
    command: string,
    durationMs: number,
    success: boolean
  ): void {
    this.updateBucket(this.totals, durationMs, success);

    const operationBucket =
      this.operationMetrics.get(operation) ?? this.createEmptyBucket();
    this.updateBucket(operationBucket, durationMs, success);
    this.operationMetrics.set(operation, operationBucket);

    const commandBucket =
      this.commandMetrics.get(command) ?? this.createEmptyBucket();
    this.updateBucket(commandBucket, durationMs, success);
    this.commandMetrics.set(command, commandBucket);
  }

  private cloneBucket(bucket: RedisMetricBucket): RedisMetricBucket {
    return {
      calls: bucket.calls,
      success: bucket.success,
      failure: bucket.failure,
      totalDurationMs: Number(bucket.totalDurationMs.toFixed(2)),
      maxDurationMs: Number(bucket.maxDurationMs.toFixed(2)),
      lastDurationMs: Number(bucket.lastDurationMs.toFixed(2)),
    };
  }

  private mapToRecord(
    map: Map<string, RedisMetricBucket>
  ): Record<string, RedisMetricBucket> {
    return Object.fromEntries(
      [...map.entries()]
        .sort((a, b) => b[1].calls - a[1].calls)
        .map(([key, bucket]) => [key, this.cloneBucket(bucket)])
    );
  }

  private async measure<T>(
    operation: string,
    command: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = process.hrtime.bigint();

    try {
      const result = await fn();
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      this.recordMetric(operation, command, durationMs, true);
      return result;
    } catch (error: any) {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      this.recordMetric(operation, command, durationMs, false);
      redisLogger.error("Redis command failed", {
        operation,
        command,
        durationMs: Number(durationMs.toFixed(2)),
        error: error?.message || "Unknown Redis error",
      });
      throw error;
    }
  }

  getMetricsSnapshot(): RedisMetricsSnapshot {
    return {
      since: this.metricsStartedAt.toISOString(),
      totals: this.cloneBucket(this.totals),
      operations: this.mapToRecord(this.operationMetrics),
      commands: this.mapToRecord(this.commandMetrics),
    };
  }

  resetMetrics(): void {
    this.metricsStartedAt = new Date();
    this.totals = this.createEmptyBucket();
    this.operationMetrics.clear();
    this.commandMetrics.clear();
  }

  async getDebugMatchesSnapshot(): Promise<RedisDebugMatchesSnapshot> {
    const matchKeys = await this.measure("debug_matches_keys", "KEYS", () =>
      this.client.keys("match:*")
    );
    const userMatchKeys = await this.measure(
      "debug_matches_user_keys",
      "KEYS",
      () => this.client.keys("user:*:match")
    );

    const matches: Array<Record<string, string>> = [];
    for (const key of matchKeys) {
      const data = await this.measure("debug_matches_hgetall", "HGETALL", () =>
        this.client.hgetall(key)
      );
      matches.push({ key, ...data });
    }

    const userMatches: Array<{ key: string; matchId: string | null }> = [];
    for (const key of userMatchKeys) {
      const matchId = await this.measure("debug_matches_get", "GET", () =>
        this.client.get(key)
      );
      userMatches.push({ key, matchId });
    }

    return { matches, userMatches };
  }

  // ============================================
  // Match Operations
  // ============================================

  /**
   * Create a new match state in Redis
   */
  async createMatch(
    matchState: MatchState,
    operation = "match_create"
  ): Promise<void> {
    const key = config.redisKeys.match(matchState.id);

    // Store as hash for easy field access
    await this.measure(operation, "HSET", () =>
      this.client.hset(key, {
        id: matchState.id,
        player1_id: matchState.player1.id,
        player1_socketId: matchState.player1.socketId,
        player1_username: matchState.player1.username,
        player1_elo: matchState.player1.elo.toString(),
        player2_id: matchState.player2.id,
        player2_socketId: matchState.player2.socketId,
        player2_username: matchState.player2.username,
        player2_elo: matchState.player2.elo.toString(),
        problemId: matchState.problemId,
        problemTitle: matchState.problemTitle,
        status: matchState.status,
        winnerId: matchState.winnerId || "",
        startedAt: matchState.startedAt.toString(),
        finishedAt: matchState.finishedAt?.toString() || "",
      })
    );

    // Set expiry (match + buffer time)
    await this.measure(operation, "EXPIRE", () =>
      this.client.expire(key, Math.ceil(config.match.timeoutMs / 1000) + 300)
    );

    // Map users to match
    await this.measure(operation, "SET", () =>
      this.client.set(
        config.redisKeys.userMatch(matchState.player1.id),
        matchState.id,
        "EX",
        Math.ceil(config.match.timeoutMs / 1000) + 300
      )
    );
    await this.measure(operation, "SET", () =>
      this.client.set(
        config.redisKeys.userMatch(matchState.player2.id),
        matchState.id,
        "EX",
        Math.ceil(config.match.timeoutMs / 1000) + 300
      )
    );

    console.log(
      `🎮 Created match ${matchState.id}: ${matchState.player1.username} vs ${matchState.player2.username}`
    );
  }

  /**
   * Get match state by ID
   */
  async getMatch(
    matchId: string,
    operation = "get_match"
  ): Promise<MatchState | null> {
    const key = config.redisKeys.match(matchId);
    const data = await this.measure(operation, "HGETALL", () =>
      this.client.hgetall(key)
    );

    if (!data || !data.id) {
      return null;
    }

    return {
      id: data.id,
      player1: {
        id: data.player1_id,
        socketId: data.player1_socketId,
        username: data.player1_username,
        elo: parseInt(data.player1_elo, 10),
      },
      player2: {
        id: data.player2_id,
        socketId: data.player2_socketId,
        username: data.player2_username,
        elo: parseInt(data.player2_elo, 10),
      },
      problemId: data.problemId,
      problemTitle: data.problemTitle,
      status: data.status as MatchState["status"],
      winnerId: data.winnerId || null,
      startedAt: parseInt(data.startedAt, 10),
      finishedAt: data.finishedAt ? parseInt(data.finishedAt, 10) : null,
    };
  }

  /**
   * Get user's current match ID
   */
  async getUserMatchId(
    userId: string,
    operation = "get_user_match_id"
  ): Promise<string | null> {
    return this.measure(operation, "GET", () =>
      this.client.get(config.redisKeys.userMatch(userId))
    );
  }

  /**
   * Update socket ID for a player in a match (for reconnection)
   */
  async updateMatchSocketId(
    matchId: string,
    socketField: "player1_socketId" | "player2_socketId",
    newSocketId: string,
    operation = "update_match_socket_id"
  ): Promise<void> {
    const key = config.redisKeys.match(matchId);
    await this.measure(operation, "HSET", () =>
      this.client.hset(key, socketField, newSocketId)
    );
  }

  /**
   * Atomic operation to set match winner
   * Returns true if this call set the winner, false if already set
   */
  async setMatchWinner(
    matchId: string,
    winnerId: string,
    operation = "set_match_winner"
  ): Promise<boolean> {
    const key = config.redisKeys.match(matchId);

    // Use Lua script for atomicity
    const luaScript = `
      local status = redis.call('HGET', KEYS[1], 'status')
      if status ~= 'active' then
        return 0
      end
      redis.call('HSET', KEYS[1], 'status', 'finished')
      redis.call('HSET', KEYS[1], 'winnerId', ARGV[1])
      redis.call('HSET', KEYS[1], 'finishedAt', ARGV[2])
      return 1
    `;

    const result = await this.measure(operation, "EVAL", () =>
      this.client.eval(luaScript, 1, key, winnerId, Date.now().toString())
    );

    return result === 1;
  }

  /**
   * Update match status
   */
  async updateMatchStatus(
    matchId: string,
    status: MatchState["status"],
    operation = "update_match_status"
  ): Promise<void> {
    const key = config.redisKeys.match(matchId);
    await this.measure(operation, "HSET", () =>
      this.client.hset(key, "status", status)
    );
  }

  /**
   * Delete match (cleanup)
   */
  async deleteMatch(matchId: string, operation = "delete_match"): Promise<void> {
    const match = await this.getMatch(matchId, `${operation}_read_match`);
    if (match) {
      await this.measure(operation, "DEL", () =>
        this.client.del(config.redisKeys.userMatch(match.player1.id))
      );
      await this.measure(operation, "DEL", () =>
        this.client.del(config.redisKeys.userMatch(match.player2.id))
      );
    }
    await this.measure(operation, "DEL", () =>
      this.client.del(config.redisKeys.match(matchId))
    );
    console.log(`🗑️  Deleted match ${matchId}`);
  }

  // ============================================
  // Socket Mapping (for reconnection)
  // ============================================

  async setUserSocket(
    userId: string,
    socketId: string,
    operation = "set_user_socket"
  ): Promise<void> {
    await this.measure(operation, "SET", () =>
      this.client.set(
        config.redisKeys.userSocket(userId),
        socketId,
        "EX",
        3600 // 1 hour
      )
    );
  }

  async getUserSocket(
    userId: string,
    operation = "get_user_socket"
  ): Promise<string | null> {
    return this.measure(operation, "GET", () =>
      this.client.get(config.redisKeys.userSocket(userId))
    );
  }

  async deleteUserSocket(
    userId: string,
    operation = "delete_user_socket"
  ): Promise<void> {
    await this.measure(operation, "DEL", () =>
      this.client.del(config.redisKeys.userSocket(userId))
    );
  }

  // ============================================
  // Cleanup Operations
  // ============================================

  /**
   * Clear a user's match association (for stuck users)
   */
  async clearUserMatch(userId: string): Promise<boolean> {
    const matchId = await this.getUserMatchId(userId, "clear_user_match_get");
    if (matchId) {
      await this.measure("clear_user_match", "DEL", () =>
        this.client.del(config.redisKeys.userMatch(userId))
      );
      console.log(
        `🧹 Cleared match association for user ${userId} (was: ${matchId})`
      );
      return true;
    }
    return false;
  }

  /**
   * Clear all match-related data (nuclear option for development)
   */
  async clearAllMatchData(): Promise<{
    matches: number;
    userMatches: number;
    queue: number;
  }> {
    let matches = 0;
    let userMatches = 0;

    // Clear all match:* keys using SCAN (production-safe)
    const matchKeys: string[] = [];
    let cursor = "0";
    do {
      const [newCursor, keys] = await this.measure(
        "clear_all_match_data",
        "SCAN",
        () =>
          this.client.scan(cursor, "MATCH", "match:*", "COUNT", 100)
      );
      cursor = newCursor;
      matchKeys.push(...keys);
    } while (cursor !== "0");

    if (matchKeys.length > 0) {
      await this.measure("clear_all_match_data", "DEL", () =>
        this.client.del(...matchKeys)
      );
      matches = matchKeys.length;
    }

    // Clear all user:*:match keys using SCAN
    const userMatchKeys: string[] = [];
    cursor = "0";
    do {
      const [newCursor, keys] = await this.measure(
        "clear_all_match_data",
        "SCAN",
        () =>
          this.client.scan(cursor, "MATCH", "user:*:match", "COUNT", 100)
      );
      cursor = newCursor;
      userMatchKeys.push(...keys);
    } while (cursor !== "0");

    if (userMatchKeys.length > 0) {
      await this.measure("clear_all_match_data", "DEL", () =>
        this.client.del(...userMatchKeys)
      );
      userMatches = userMatchKeys.length;
    }

    console.log(
      `🧹 Cleared: ${matches} matches, ${userMatches} user-match associations`
    );

    return { matches, userMatches, queue: 0 };
  }
}

// Singleton instance
export const redisService = new RedisService();
