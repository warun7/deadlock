import Redis from 'ioredis';
import { config } from '../config';
import { QueueEntry, MatchState } from '../types';

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
    if (err.message.includes('READONLY') || err.message.includes('ECONNRESET')) {
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
 * Philosophy: Redis is the source of truth during the match.
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
    this.client.on('error', (err) => {
      console.error('❌ Redis Client Error:', err.message);
    });
    
    this.client.on('connect', () => {
      console.log('✅ Redis Client connected');
    });
    
    this.subscriber.on('error', (err) => {
      console.error('❌ Redis Subscriber Error:', err.message);
    });
  }
  
  async connect(): Promise<void> {
    await Promise.all([
      this.client.connect(),
      this.subscriber.connect(),
    ]);
  }
  
  async disconnect(): Promise<void> {
    await Promise.all([
      this.client.quit(),
      this.subscriber.quit(),
    ]);
  }
  
  getClient(): Redis {
    return this.client;
  }
  
  getSubscriber(): Redis {
    return this.subscriber;
  }
  
  // ============================================
  // Queue Operations
  // ============================================
  
  /**
   * Add user to the matchmaking queue
   * Uses RPUSH for FIFO ordering
   */
  async enqueue(entry: QueueEntry): Promise<number> {
    // First check if user is already in queue
    const isInQueue = await this.isUserInQueue(entry.userId);
    if (isInQueue) {
      console.log(`⚠️  User ${entry.userId} already in queue, skipping`);
      return -1;
    }
    
    const position = await this.client.rpush(
      config.redisKeys.queue,
      JSON.stringify(entry)
    );
    
    console.log(`📥 Enqueued user ${entry.username} (${entry.userId}) at position ${position}`);
    return position;
  }
  
  /**
   * Remove user from queue (if they cancel)
   * Uses Lua script for atomic read-remove operation
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
    
    const result = await this.client.eval(
      luaScript,
      1,
      config.redisKeys.queue,
      userId
    );
    
    if (result === 1) {
      console.log(`📤 Dequeued user ${userId}`);
      return true;
    }
    return false;
  }
  
  /**
   * Get queue length
   */
  async getQueueLength(): Promise<number> {
    return this.client.llen(config.redisKeys.queue);
  }
  
  /**
   * Pop two players from the queue atomically
   * Returns null if less than 2 players available
   */
  async popTwoPlayers(): Promise<[QueueEntry, QueueEntry] | null> {
    // Use MULTI/EXEC for atomicity
    const multi = this.client.multi();
    multi.lpop(config.redisKeys.queue);
    multi.lpop(config.redisKeys.queue);
    
    const results = await multi.exec();
    
    if (!results || results.length !== 2) {
      return null;
    }
    
    const [result1, result2] = results;
    
    // Check if both pops succeeded
    if (!result1 || result1[0] || !result1[1] || !result2 || result2[0] || !result2[1]) {
      // If only one popped, push it back
      if (result1 && result1[1] && (!result2 || !result2[1])) {
        await this.client.lpush(config.redisKeys.queue, result1[1] as string);
      }
      return null;
    }
    
    const player1: QueueEntry = JSON.parse(result1[1] as string);
    const player2: QueueEntry = JSON.parse(result2[1] as string);
    
    console.log(`🎮 Popped two players: ${player1.username} vs ${player2.username}`);
    return [player1, player2];
  }
  
  /**
   * Check if user is already in queue
   */
  async isUserInQueue(userId: string): Promise<boolean> {
    const queueData = await this.client.lrange(config.redisKeys.queue, 0, -1);
    return queueData.some(entry => {
      const parsed: QueueEntry = JSON.parse(entry);
      return parsed.userId === userId;
    });
  }
  
  /**
   * Get user's position in queue (1-indexed)
   */
  async getQueuePosition(userId: string): Promise<number> {
    const queueData = await this.client.lrange(config.redisKeys.queue, 0, -1);
    const index = queueData.findIndex(entry => {
      const parsed: QueueEntry = JSON.parse(entry);
      return parsed.userId === userId;
    });
    return index === -1 ? -1 : index + 1;
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
      winnerId: matchState.winnerId || '',
      startedAt: matchState.startedAt.toString(),
      finishedAt: matchState.finishedAt?.toString() || '',
    });
    
    // Set expiry (match + buffer time)
    await this.client.expire(key, Math.ceil(config.match.timeoutMs / 1000) + 300);
    
    // Map users to match
    await this.client.set(
      config.redisKeys.userMatch(matchState.player1.id),
      matchState.id,
      'EX',
      Math.ceil(config.match.timeoutMs / 1000) + 300
    );
    await this.client.set(
      config.redisKeys.userMatch(matchState.player2.id),
      matchState.id,
      'EX',
      Math.ceil(config.match.timeoutMs / 1000) + 300
    );
    
    console.log(`🎮 Created match ${matchState.id}: ${matchState.player1.username} vs ${matchState.player2.username}`);
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
      status: data.status as MatchState['status'],
      winnerId: data.winnerId || null,
      startedAt: parseInt(data.startedAt, 10),
      finishedAt: data.finishedAt ? parseInt(data.finishedAt, 10) : null,
    };
  }
  
  /**
   * Get user's current match ID
   */
  async getUserMatchId(userId: string): Promise<string | null> {
    return this.client.get(config.redisKeys.userMatch(userId));
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
      Date.now().toString()
    );
    
    return result === 1;
  }
  
  /**
   * Update match status
   */
  async updateMatchStatus(matchId: string, status: MatchState['status']): Promise<void> {
    const key = config.redisKeys.match(matchId);
    await this.client.hset(key, 'status', status);
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
      'EX',
      3600 // 1 hour
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
    const length = await this.client.llen(config.redisKeys.queue);
    if (length > 0) {
      await this.client.del(config.redisKeys.queue);
    }
    return length;
  }
  
  /**
   * Clear a user's match association (for stuck users)
   */
  async clearUserMatch(userId: string): Promise<boolean> {
    const matchId = await this.getUserMatchId(userId);
    if (matchId) {
      await this.client.del(config.redisKeys.userMatch(userId));
      console.log(`🧹 Cleared match association for user ${userId} (was: ${matchId})`);
      return true;
    }
    return false;
  }
  
  /**
   * Clear all match-related data (nuclear option for development)
   */
  async clearAllMatchData(): Promise<{ matches: number; userMatches: number; queue: number }> {
    let matches = 0;
    let userMatches = 0;
    
    // Clear all match:* keys using SCAN (production-safe)
    const matchKeys: string[] = [];
    let cursor = '0';
    do {
      const [newCursor, keys] = await this.client.scan(
        cursor,
        'MATCH', 'match:*',
        'COUNT', 100
      );
      cursor = newCursor;
      matchKeys.push(...keys);
    } while (cursor !== '0');
    
    if (matchKeys.length > 0) {
      await this.client.del(...matchKeys);
      matches = matchKeys.length;
    }
    
    // Clear all user:*:match keys using SCAN
    const userMatchKeys: string[] = [];
    cursor = '0';
    do {
      const [newCursor, keys] = await this.client.scan(
        cursor,
        'MATCH', 'user:*:match',
        'COUNT', 100
      );
      cursor = newCursor;
      userMatchKeys.push(...keys);
    } while (cursor !== '0');
    
    if (userMatchKeys.length > 0) {
      await this.client.del(...userMatchKeys);
      userMatches = userMatchKeys.length;
    }
    
    // Clear queue
    const queue = await this.clearQueue();
    
    console.log(`🧹 Cleared: ${matches} matches, ${userMatches} user-match associations, ${queue} queue entries`);
    
    return { matches, userMatches, queue };
  }
}

// Singleton instance
export const redisService = new RedisService();

