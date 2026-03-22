import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { config } from "../config";
import { QueueEntry, MatchState, MatchMode } from "../types";

// Only enable TLS if using a rediss:// URL (e.g. Upstash)
const needsTls = config.redisUrl.startsWith("rediss://");

const REDIS_OPTIONS = {
  maxRetriesPerRequest: null, // Disable per-request retry limit to prevent unhandled rejections
  enableReadyCheck: false, // Faster reconnect
  ...(needsTls ? { tls: {} } : {}), // TLS only for rediss:// connections
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
 * Redis is the source of truth during the match.
 * All live state (queue, active matches) lives here.
 */
export class RedisService {
  private client: Redis;
  private subscriber: Redis;

  constructor() {
    this.client = new Redis(config.redisUrl, REDIS_OPTIONS);

    // Separate connection for pub/sub
    this.subscriber = new Redis(config.redisUrl, REDIS_OPTIONS);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on("error", (err) => {
      console.error("❌ Redis Client Error:", err.message);
    });

    this.client.on("connect", () => {
      console.log("✅ Redis Client connected");
    });

    this.subscriber.on("error", (err) => {
      console.error("❌ Redis Subscriber Error:", err.message);
    });
  }

  async connect(): Promise<void> {
    await Promise.all([this.client.connect(), this.subscriber.connect()]);
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.client.quit(), this.subscriber.quit()]);
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  // ============================================
  // Queue Operations (supports ranked + unranked)
  // ============================================

  /**
   * Get the Redis key for a specific queue mode
   */
  private getQueueKey(mode: MatchMode = "unranked"): string {
    return mode === "ranked"
      ? config.redisKeys.queueRanked
      : config.redisKeys.queueUnranked;
  }

  /**
   * Add user to the matchmaking queue
   * Uses RPUSH for FIFO ordering
   */
  async enqueue(entry: QueueEntry): Promise<number> {
    // First check if user is already in any queue
    const isInQueue = await this.isUserInQueue(entry.userId);
    if (isInQueue) {
      console.log(`⚠️  User ${entry.userId} already in queue, skipping`);
      return -1;
    }

    const queueKey = this.getQueueKey(entry.mode);
    const position = await this.client.rpush(queueKey, JSON.stringify(entry));

    console.log(
      `📥 Enqueued user ${entry.username} (${entry.userId}) at position ${position} in ${entry.mode} queue`,
    );
    return position;
  }

  /**
   * Remove user from queue (if they cancel)
   * Checks both queues since user might be in either
   */
  async dequeue(userId: string): Promise<boolean> {
    const luaScript = `
      local queue = redis.call('LRANGE', KEYS[1], 0, -1)
      for i, entry in ipairs(queue) do
        local parsed = cjson.decode(entry)
        if parsed.userId == ARGV[1] then
          redis.call('LREM', KEYS[1], 1, entry)
          return 1
        end
      end
      return 0
    `;

    // Try unranked queue first
    let result = await this.client.eval(
      luaScript,
      1,
      config.redisKeys.queueUnranked,
      userId,
    );

    if (result === 1) {
      console.log(`📤 Dequeued user ${userId} from unranked queue`);
      return true;
    }

    // Try ranked queue
    result = await this.client.eval(
      luaScript,
      1,
      config.redisKeys.queueRanked,
      userId,
    );

    if (result === 1) {
      console.log(`📤 Dequeued user ${userId} from ranked queue`);
      return true;
    }

    return false;
  }

  /**
   * Cross-instance guard so at most one node creates a bot match for a user.
   * Value is a unique token; release only deletes the key if the token still matches
   * (avoids deleting another holder's lock after TTL expiry).
   */
  async acquireBotMatchLock(
    userId: string,
    ttlSec = 25,
  ): Promise<string | null> {
    const key = config.redisKeys.botMatchLock(userId);
    const token = randomUUID();
    const ok = await this.client.set(key, token, "EX", ttlSec, "NX");
    return ok === "OK" ? token : null;
  }

  async releaseBotMatchLock(userId: string, token: string): Promise<void> {
    const key = config.redisKeys.botMatchLock(userId);
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `;
    await this.client.eval(script, 1, key, token);
  }

  /**
   * Get queue length for a specific mode
   */
  async getQueueLength(mode?: MatchMode): Promise<number> {
    if (mode) {
      return this.client.llen(this.getQueueKey(mode));
    }
    // Return total across both queues
    const [unranked, ranked] = await Promise.all([
      this.client.llen(config.redisKeys.queueUnranked),
      this.client.llen(config.redisKeys.queueRanked),
    ]);
    return unranked + ranked;
  }

  /**
   * Pop two players from the unranked queue atomically
   * Returns null if less than 2 players available
   */
  async popTwoPlayers(): Promise<[QueueEntry, QueueEntry] | null> {
    const queueKey = config.redisKeys.queueUnranked;

    // Use MULTI/EXEC for atomicity
    const multi = this.client.multi();
    multi.lpop(queueKey);
    multi.lpop(queueKey);

    const results = await multi.exec();

    if (!results || results.length !== 2) {
      return null;
    }

    const [result1, result2] = results;

    // Check if both pops succeeded
    if (
      !result1 ||
      result1[0] ||
      !result1[1] ||
      !result2 ||
      result2[0] ||
      !result2[1]
    ) {
      // If only one popped, push it back
      if (result1 && result1[1] && (!result2 || !result2[1])) {
        await this.client.lpush(queueKey, result1[1] as string);
      }
      return null;
    }

    const player1: QueueEntry = JSON.parse(result1[1] as string);
    const player2: QueueEntry = JSON.parse(result2[1] as string);

    console.log(
      `🎮 Popped two players: ${player1.username} vs ${player2.username}`,
    );
    return [player1, player2];
  }

  /**
   * Check if user is already in any queue
   */
  async isUserInQueue(userId: string): Promise<boolean> {
    // Check both queues
    const [unrankedData, rankedData] = await Promise.all([
      this.client.lrange(config.redisKeys.queueUnranked, 0, -1),
      this.client.lrange(config.redisKeys.queueRanked, 0, -1),
    ]);

    const allEntries = [...unrankedData, ...rankedData];
    return allEntries.some((entry) => {
      const parsed: QueueEntry = JSON.parse(entry);
      return parsed.userId === userId;
    });
  }

  /**
   * Get user's position in queue (1-indexed)
   */
  async getQueuePosition(userId: string): Promise<number> {
    // Check unranked first
    const unrankedData = await this.client.lrange(
      config.redisKeys.queueUnranked,
      0,
      -1,
    );
    let index = unrankedData.findIndex((entry) => {
      const parsed: QueueEntry = JSON.parse(entry);
      return parsed.userId === userId;
    });
    if (index !== -1) return index + 1;

    // Check ranked
    const rankedData = await this.client.lrange(
      config.redisKeys.queueRanked,
      0,
      -1,
    );
    index = rankedData.findIndex((entry) => {
      const parsed: QueueEntry = JSON.parse(entry);
      return parsed.userId === userId;
    });
    return index === -1 ? -1 : index + 1;
  }

  /**
   * Get all queue entries for a specific mode.
   * NOTE: Uses full LRANGE each tick; at high concurrency consider capped windows or a secondary index (e.g. sorted sets).
   */
  async getQueue(mode?: MatchMode): Promise<QueueEntry[]> {
    if (mode) {
      const queueData = await this.client.lrange(this.getQueueKey(mode), 0, -1);
      return queueData.map((entry) => JSON.parse(entry) as QueueEntry);
    }
    // Return all entries from both queues
    const [unrankedData, rankedData] = await Promise.all([
      this.client.lrange(config.redisKeys.queueUnranked, 0, -1),
      this.client.lrange(config.redisKeys.queueRanked, 0, -1),
    ]);
    return [
      ...unrankedData.map((e) => JSON.parse(e) as QueueEntry),
      ...rankedData.map((e) => JSON.parse(e) as QueueEntry),
    ];
  }

  /**
   * Find the best ELO match in the ranked queue for a given player
   * Returns the matched pair, or null if no suitable match found.
   * NOTE: O(n²) over the full list per tick; replace with a sorted ELO structure when queues grow.
   */
  async findRankedMatch(
    eloRange: number,
  ): Promise<[QueueEntry, QueueEntry] | null> {
    const queueData = await this.client.lrange(
      config.redisKeys.queueRanked,
      0,
      -1,
    );
    const entries = queueData.map((e) => JSON.parse(e) as QueueEntry);

    if (entries.length < 2) return null;

    // Sort by ELO for efficient matching
    entries.sort((a, b) => a.elo - b.elo);

    // Find the closest ELO pair within range
    let bestPair: [QueueEntry, QueueEntry] | null = null;
    let bestDiff = Infinity;

    for (let i = 0; i < entries.length - 1; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const diff = Math.abs(entries[i].elo - entries[j].elo);
        if (diff <= eloRange && diff < bestDiff) {
          bestDiff = diff;
          bestPair = [entries[i], entries[j]];
        }
      }
    }

    if (!bestPair) return null;

    // Remove both players from queue atomically
    const luaScript = `
      local queue = redis.call('LRANGE', KEYS[1], 0, -1)
      local removed = 0
      for i, entry in ipairs(queue) do
        local parsed = cjson.decode(entry)
        if parsed.userId == ARGV[1] or parsed.userId == ARGV[2] then
          redis.call('LREM', KEYS[1], 1, entry)
          removed = removed + 1
        end
      end
      return removed
    `;

    const removed = await this.client.eval(
      luaScript,
      1,
      config.redisKeys.queueRanked,
      bestPair[0].userId,
      bestPair[1].userId,
    );

    if (removed !== 2) {
      // Race condition — someone left, abort
      console.log(`⚠️ Ranked match race condition, only removed ${removed}`);
      return null;
    }

    console.log(
      `🎯 Ranked match: ${bestPair[0].username} (${bestPair[0].elo}) vs ${bestPair[1].username} (${bestPair[1].elo}) [diff: ${bestDiff}]`,
    );
    return bestPair;
  }

  /**
   * Same as findRankedMatch but for the unranked queue (wider ELO bands from config).
   * NOTE: Same scaling characteristics as findRankedMatch (full list + O(n²) scan).
   */
  async findUnrankedMatch(
    eloRange: number,
  ): Promise<[QueueEntry, QueueEntry] | null> {
    const queueKey = config.redisKeys.queueUnranked;
    const queueData = await this.client.lrange(queueKey, 0, -1);
    const entries = queueData.map((e) => JSON.parse(e) as QueueEntry);

    if (entries.length < 2) return null;

    entries.sort((a, b) => a.elo - b.elo);

    let bestPair: [QueueEntry, QueueEntry] | null = null;
    let bestDiff = Infinity;

    for (let i = 0; i < entries.length - 1; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const diff = Math.abs(entries[i].elo - entries[j].elo);
        if (diff <= eloRange && diff < bestDiff) {
          bestDiff = diff;
          bestPair = [entries[i], entries[j]];
        }
      }
    }

    if (!bestPair) return null;

    const luaScript = `
      local queue = redis.call('LRANGE', KEYS[1], 0, -1)
      local removed = 0
      for i, entry in ipairs(queue) do
        local parsed = cjson.decode(entry)
        if parsed.userId == ARGV[1] or parsed.userId == ARGV[2] then
          redis.call('LREM', KEYS[1], 1, entry)
          removed = removed + 1
        end
      end
      return removed
    `;

    const removed = await this.client.eval(
      luaScript,
      1,
      queueKey,
      bestPair[0].userId,
      bestPair[1].userId,
    );

    if (removed !== 2) {
      console.log(`⚠️ Unranked match race condition, only removed ${removed}`);
      return null;
    }

    console.log(
      `🎯 Unranked ELO match: ${bestPair[0].username} (${bestPair[0].elo}) vs ${bestPair[1].username} (${bestPair[1].elo}) [diff: ${bestDiff}]`,
    );
    return bestPair;
  }

  // ============================================
  // Match Operations
  // ============================================

  /**
   * Create a new match state in Redis
   */
  async createMatch(matchState: MatchState): Promise<void> {
    const key = config.redisKeys.match(matchState.id);

    // Store as hash for easy field access
    await this.client.hset(key, {
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
      matchType: matchState.matchType || "unranked",
    });

    // Set expiry (match + buffer time)
    await this.client.expire(
      key,
      Math.ceil(config.match.timeoutMs / 1000) + 300,
    );

    // Map users to match
    await this.client.set(
      config.redisKeys.userMatch(matchState.player1.id),
      matchState.id,
      "EX",
      Math.ceil(config.match.timeoutMs / 1000) + 300,
    );
    await this.client.set(
      config.redisKeys.userMatch(matchState.player2.id),
      matchState.id,
      "EX",
      Math.ceil(config.match.timeoutMs / 1000) + 300,
    );

    console.log(
      `🎮 Created match ${matchState.id}: ${matchState.player1.username} vs ${matchState.player2.username}`,
    );
  }

  /**
   * Get match state by ID
   */
  async getMatch(matchId: string): Promise<MatchState | null> {
    const key = config.redisKeys.match(matchId);
    const data = await this.client.hgetall(key);

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
      matchType: (data.matchType as MatchState["matchType"]) || "unranked",
    };
  }

  /**
   * Get user's current match ID
   */
  async getUserMatchId(userId: string): Promise<string | null> {
    return this.client.get(config.redisKeys.userMatch(userId));
  }

  /**
   * Returns the match id only if user→match points at an existing active match.
   * Otherwise deletes the user→match key (missing match, finished match, or TTL skew).
   */
  async getActiveMatchIdForUser(userId: string): Promise<string | null> {
    const matchId = await this.getUserMatchId(userId);
    if (!matchId) return null;

    const match = await this.getMatch(matchId);
    if (match?.status === "active") {
      return matchId;
    }

    await this.client.del(config.redisKeys.userMatch(userId));
    console.log(
      `🧹 Cleared stale user→match for ${userId} (was ${matchId}${
        match ? `, status=${match.status}` : ", match record missing"
      })`,
    );
    return null;
  }

  /**
   * Update socket ID for a player in a match (for reconnection)
   */
  async updateMatchSocketId(
    matchId: string,
    playerId: string,
    newSocketId: string,
  ): Promise<void> {
    const key = config.redisKeys.match(matchId);
    const match = await this.getMatch(matchId);

    if (!match) return;

    // Determine which player to update
    if (match.player1.id === playerId) {
      await this.client.hset(key, "player1_socketId", newSocketId);
    } else if (match.player2.id === playerId) {
      await this.client.hset(key, "player2_socketId", newSocketId);
    }
  }

  /**
   * Atomic operation to set match winner
   * Returns true if this call set the winner, false if already set
   */
  async setMatchWinner(matchId: string, winnerId: string): Promise<boolean> {
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

    const result = await this.client.eval(
      luaScript,
      1,
      key,
      winnerId,
      Date.now().toString(),
    );

    return result === 1;
  }

  /**
   * Update match status
   */
  async updateMatchStatus(
    matchId: string,
    status: MatchState["status"],
  ): Promise<void> {
    const key = config.redisKeys.match(matchId);
    await this.client.hset(key, "status", status);
  }

  /**
   * Delete match (cleanup)
   */
  async deleteMatch(matchId: string): Promise<void> {
    const match = await this.getMatch(matchId);
    if (match) {
      await this.client.del(config.redisKeys.userMatch(match.player1.id));
      await this.client.del(config.redisKeys.userMatch(match.player2.id));
    }
    await this.client.del(config.redisKeys.match(matchId));
    console.log(`🗑️  Deleted match ${matchId}`);
  }

  // ============================================
  // Socket Mapping (for reconnection)
  // ============================================

  async setUserSocket(userId: string, socketId: string): Promise<void> {
    await this.client.set(
      config.redisKeys.userSocket(userId),
      socketId,
      "EX",
      3600, // 1 hour
    );
  }

  async getUserSocket(userId: string): Promise<string | null> {
    return this.client.get(config.redisKeys.userSocket(userId));
  }

  async deleteUserSocket(userId: string): Promise<void> {
    await this.client.del(config.redisKeys.userSocket(userId));
  }

  // ============================================
  // Cleanup Operations
  // ============================================

  /**
   * Clear the entire queue (for development/testing)
   */
  async clearQueue(): Promise<number> {
    const [unrankedLen, rankedLen] = await Promise.all([
      this.client.llen(config.redisKeys.queueUnranked),
      this.client.llen(config.redisKeys.queueRanked),
    ]);
    const total = unrankedLen + rankedLen;
    if (total > 0) {
      await Promise.all([
        this.client.del(config.redisKeys.queueUnranked),
        this.client.del(config.redisKeys.queueRanked),
      ]);
    }
    return total;
  }

  /**
   * Clear a user's match association (for stuck users)
   */
  async clearUserMatch(userId: string): Promise<boolean> {
    const matchId = await this.getUserMatchId(userId);
    if (matchId) {
      await this.client.del(config.redisKeys.userMatch(userId));
      console.log(
        `🧹 Cleared match association for user ${userId} (was: ${matchId})`,
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
      const [newCursor, keys] = await this.client.scan(
        cursor,
        "MATCH",
        "match:*",
        "COUNT",
        100,
      );
      cursor = newCursor;
      matchKeys.push(...keys);
    } while (cursor !== "0");

    if (matchKeys.length > 0) {
      await this.client.del(...matchKeys);
      matches = matchKeys.length;
    }

    // Clear all user:*:match keys using SCAN
    const userMatchKeys: string[] = [];
    cursor = "0";
    do {
      const [newCursor, keys] = await this.client.scan(
        cursor,
        "MATCH",
        "user:*:match",
        "COUNT",
        100,
      );
      cursor = newCursor;
      userMatchKeys.push(...keys);
    } while (cursor !== "0");

    if (userMatchKeys.length > 0) {
      await this.client.del(...userMatchKeys);
      userMatches = userMatchKeys.length;
    }

    // Clear queue
    const queue = await this.clearQueue();

    console.log(
      `🧹 Cleared: ${matches} matches, ${userMatches} user-match associations, ${queue} queue entries`,
    );

    return { matches, userMatches, queue };
  }
}

// Singleton instance
export const redisService = new RedisService();
