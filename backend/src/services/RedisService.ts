import Redis from "ioredis";
import { config } from "../config";
import { FairPlayEvent, MatchMode, MatchState, Room, RoomPlayer } from "../types";
import { createModuleLogger } from "../utils/logger";
import { DEFAULT_ROOM_DIFFICULTY, isRoomDifficulty } from "../config/roomDifficulty";

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

// Base Redis connection options.
// TLS is applied conditionally by buildRedisOptions() so that the same build
// works against a managed TLS provider (Upstash, rediss://) and a plain
// Redis on a private network / same VPS (redis://).
const REDIS_OPTIONS = {
  maxRetriesPerRequest: null, // Disable per-request retry limit to prevent unhandled rejections
  enableReadyCheck: false, // Faster reconnect
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
 * Decide whether TLS is required for this Redis endpoint.
 *
 * A `rediss://` URL always implies TLS (Upstash, Redis Cloud, ElastiCache with
 * in-transit encryption). A plain `redis://` URL does not, which is what you
 * get from a local Redis, a Docker Compose service, or Redis bound to a
 * private network on the same host. REDIS_TLS=true forces TLS on regardless,
 * for providers that hand out a redis:// URL but still require TLS.
 */
function shouldUseTls(redisUrl: string): boolean {
  if (redisUrl.startsWith("rediss://")) {
    return true;
  }

  return process.env.REDIS_TLS === "true";
}

function buildRedisOptions(redisUrl: string) {
  if (!shouldUseTls(redisUrl)) {
    return REDIS_OPTIONS;
  }

  return { ...REDIS_OPTIONS, tls: {} };
}

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
    this.client = new Redis(config.redisUrl, buildRedisOptions(config.redisUrl));
    this.setupEventHandlers();
  }

  /**
   * Current ioredis connection state: 'wait' | 'connecting' | 'connect' |
   * 'ready' | 'reconnecting' | 'end'. Exposed for the health endpoint.
   */
  getStatus(): string {
    return this.client.status;
  }

  /**
   * Round-trip liveness probe. Used by /health so an orchestrator (or a human)
   * can tell "process is up" apart from "process can actually reach Redis".
   */
  async ping(): Promise<boolean> {
    try {
      const reply = await this.client.ping();
      return reply === "PONG";
    } catch {
      return false;
    }
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
        mode: matchState.mode,
        roomCode: matchState.roomCode || "",
        problemRating: matchState.problemRating?.toString() || "",
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
      // Matches created before modes existed: a bot seat means practice
      mode: (data.mode as MatchMode) || (data.player2_socketId === "bot" ? "practice" : "ranked"),
      roomCode: data.roomCode || undefined,
      problemRating: data.problemRating ? parseInt(data.problemRating, 10) : undefined,
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
      // A player who started another match since (a rematch, a new queue
      // pop) now maps to that one; only forget mappings still pointing here
      for (const playerId of [match.player1.id, match.player2.id]) {
        await this.measure(operation, "EVAL", () =>
          this.client.eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
            1,
            config.redisKeys.userMatch(playerId),
            matchId
          )
        );
      }
    }
    await this.measure(operation, "DEL", () =>
      this.client.del(config.redisKeys.match(matchId))
    );
    console.log(`🗑️  Deleted match ${matchId}`);
  }

  // ============================================
  // Duel Rooms
  // ============================================
  //
  // One hash per room: the two seats, each seat's ready flag and wins, and
  // the latest match started from it. Every write is a script that refuses to
  // touch a room that no longer exists, so an expired room is never
  // recreated as a partial hash without a TTL.

  /** Create a room; false when the code is already taken */
  async createRoom(code: string, host: RoomPlayer, operation = "room_create"): Promise<boolean> {
    const script = `
      if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
      redis.call('HSET', KEYS[1],
        'code', ARGV[1], 'status', 'open', 'createdAt', ARGV[2],
        'host_id', ARGV[3], 'host_username', ARGV[4], 'host_elo', ARGV[5], 'host_ready', '0', 'host_wins', '0',
        'guest_id', '', 'guest_username', '', 'guest_elo', '', 'guest_ready', '0', 'guest_wins', '0',
        'matchId', '', 'difficulty', ARGV[7], 'recentProblems', '')
      redis.call('EXPIRE', KEYS[1], ARGV[6])
      return 1
    `;
    const created = await this.measure(operation, "EVAL", () =>
      this.client.eval(
        script,
        1,
        config.redisKeys.room(code),
        code,
        Date.now().toString(),
        host.id,
        host.username,
        host.elo.toString(),
        config.room.ttlSeconds.toString(),
        DEFAULT_ROOM_DIFFICULTY
      )
    );
    return created === 1;
  }

  async getRoom(code: string, operation = "room_get"): Promise<Room | null> {
    const data = await this.measure(operation, "HGETALL", () =>
      this.client.hgetall(config.redisKeys.room(code))
    );
    if (!data || !data.code) return null;

    return {
      code: data.code,
      status: data.status === "open" ? "open" : "closed",
      host: {
        id: data.host_id,
        username: data.host_username,
        elo: parseInt(data.host_elo, 10) || 0,
      },
      guest: data.guest_id
        ? {
            id: data.guest_id,
            username: data.guest_username,
            elo: parseInt(data.guest_elo, 10) || 0,
          }
        : null,
      hostReady: data.host_ready === "1",
      guestReady: data.guest_ready === "1",
      hostWins: parseInt(data.host_wins, 10) || 0,
      guestWins: parseInt(data.guest_wins, 10) || 0,
      matchId: data.matchId || null,
      // Rooms opened before difficulty existed play at the default
      difficulty: isRoomDifficulty(data.difficulty) ? data.difficulty : DEFAULT_ROOM_DIFFICULTY,
      recentProblemIds: data.recentProblems ? data.recentProblems.split(",") : [],
      createdAt: parseInt(data.createdAt, 10) || 0,
    };
  }

  /** Set fields on an open room; false if the room is gone or closed */
  async updateRoom(code: string, fields: Record<string, string>, operation = "room_update"): Promise<boolean> {
    const script = `
      if redis.call('HGET', KEYS[1], 'status') ~= 'open' then return 0 end
      for i = 2, #ARGV, 2 do redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1]) end
      redis.call('EXPIRE', KEYS[1], ARGV[1])
      return 1
    `;
    const args = Object.entries(fields).flat();
    const done = await this.measure(operation, "EVAL", () =>
      this.client.eval(script, 1, config.redisKeys.room(code), config.room.ttlSeconds.toString(), ...args)
    );
    return done === 1;
  }

  /**
   * Seat a player: the host gets their seat back, anyone else takes the empty
   * guest seat or their own. A new guest starts the score from 0-0. Joining
   * always starts out not ready.
   */
  async claimRoomSeat(
    code: string,
    player: RoomPlayer,
    operation = "room_claim_seat"
  ): Promise<"host" | "guest" | "full" | "closed" | "missing"> {
    const script = `
      local status = redis.call('HGET', KEYS[1], 'status')
      if not status then return 'missing' end
      if status ~= 'open' then return 'closed' end
      if redis.call('HGET', KEYS[1], 'host_id') == ARGV[1] then
        redis.call('HSET', KEYS[1], 'host_username', ARGV[2], 'host_elo', ARGV[3], 'host_ready', '0')
        redis.call('EXPIRE', KEYS[1], ARGV[4])
        return 'host'
      end
      local guest = redis.call('HGET', KEYS[1], 'guest_id')
      if guest == ARGV[1] then
        redis.call('HSET', KEYS[1], 'guest_username', ARGV[2], 'guest_elo', ARGV[3], 'guest_ready', '0')
        redis.call('EXPIRE', KEYS[1], ARGV[4])
        return 'guest'
      end
      if guest and guest ~= '' then return 'full' end
      redis.call('HSET', KEYS[1],
        'guest_id', ARGV[1], 'guest_username', ARGV[2], 'guest_elo', ARGV[3], 'guest_ready', '0',
        'host_wins', '0', 'guest_wins', '0')
      redis.call('EXPIRE', KEYS[1], ARGV[4])
      return 'guest'
    `;
    const seat = await this.measure(operation, "EVAL", () =>
      this.client.eval(
        script,
        1,
        config.redisKeys.room(code),
        player.id,
        player.username,
        player.elo.toString(),
        config.room.ttlSeconds.toString()
      )
    );
    return seat as "host" | "guest" | "full" | "closed" | "missing";
  }

  /** Set a seat's ready flag in an open room; false if the room is gone or closed */
  async setRoomReady(
    code: string,
    seat: "host" | "guest",
    ready: boolean,
    operation = "room_set_ready"
  ): Promise<boolean> {
    const script = `
      if redis.call('HGET', KEYS[1], 'status') ~= 'open' then return 0 end
      redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
      redis.call('EXPIRE', KEYS[1], ARGV[3])
      return 1
    `;
    const done = await this.measure(operation, "EVAL", () =>
      this.client.eval(
        script,
        1,
        config.redisKeys.room(code),
        `${seat}_ready`,
        ready ? "1" : "0",
        config.room.ttlSeconds.toString()
      )
    );
    return done === 1;
  }

  /**
   * Claim the start of a match: only one caller wins, and only while the same
   * two players are seated and both are ready. Clears both ready flags.
   */
  async claimRoomStart(
    code: string,
    hostId: string,
    guestId: string,
    matchId: string,
    operation = "room_claim_start"
  ): Promise<boolean> {
    const script = `
      if redis.call('HGET', KEYS[1], 'status') ~= 'open' then return 0 end
      if redis.call('HGET', KEYS[1], 'host_id') ~= ARGV[1] then return 0 end
      if redis.call('HGET', KEYS[1], 'guest_id') ~= ARGV[2] then return 0 end
      if redis.call('HGET', KEYS[1], 'host_ready') ~= '1' then return 0 end
      if redis.call('HGET', KEYS[1], 'guest_ready') ~= '1' then return 0 end
      redis.call('HSET', KEYS[1], 'host_ready', '0', 'guest_ready', '0', 'matchId', ARGV[3])
      redis.call('EXPIRE', KEYS[1], ARGV[4])
      return 1
    `;
    const claimed = await this.measure(operation, "EVAL", () =>
      this.client.eval(
        script,
        1,
        config.redisKeys.room(code),
        hostId,
        guestId,
        matchId,
        config.room.ttlSeconds.toString()
      )
    );
    return claimed === 1;
  }

  /**
   * Count a win for the room's latest match. Returns [hostWins, guestWins], or
   * null when the match is not this room's latest or the winner is no longer seated.
   */
  async recordRoomWin(
    code: string,
    matchId: string,
    winnerId: string,
    operation = "room_record_win"
  ): Promise<[number, number] | null> {
    const script = `
      if redis.call('HGET', KEYS[1], 'matchId') ~= ARGV[1] then return nil end
      local field
      if redis.call('HGET', KEYS[1], 'host_id') == ARGV[2] then field = 'host_wins'
      elseif redis.call('HGET', KEYS[1], 'guest_id') == ARGV[2] then field = 'guest_wins'
      else return nil end
      redis.call('HINCRBY', KEYS[1], field, 1)
      redis.call('EXPIRE', KEYS[1], ARGV[3])
      return {redis.call('HGET', KEYS[1], 'host_wins'), redis.call('HGET', KEYS[1], 'guest_wins')}
    `;
    const result = (await this.measure(operation, "EVAL", () =>
      this.client.eval(
        script,
        1,
        config.redisKeys.room(code),
        matchId,
        winnerId,
        config.room.ttlSeconds.toString()
      )
    )) as [string, string] | null;
    if (!result) return null;
    return [parseInt(result[0], 10) || 0, parseInt(result[1], 10) || 0];
  }

  /** Free the guest seat if this player holds it; the score resets with it */
  async clearRoomGuest(code: string, guestId: string, operation = "room_clear_guest"): Promise<boolean> {
    const script = `
      if redis.call('HGET', KEYS[1], 'guest_id') ~= ARGV[1] then return 0 end
      redis.call('HSET', KEYS[1],
        'guest_id', '', 'guest_username', '', 'guest_elo', '', 'guest_ready', '0',
        'host_wins', '0', 'guest_wins', '0')
      redis.call('EXPIRE', KEYS[1], ARGV[2])
      return 1
    `;
    const cleared = await this.measure(operation, "EVAL", () =>
      this.client.eval(script, 1, config.redisKeys.room(code), guestId, config.room.ttlSeconds.toString())
    );
    return cleared === 1;
  }

  /**
   * Close a room (host only). It lingers for a few minutes so a late visitor
   * is told it was closed rather than that it never existed.
   */
  async closeRoom(code: string, hostId: string, operation = "room_close"): Promise<boolean> {
    const script = `
      if redis.call('HGET', KEYS[1], 'host_id') ~= ARGV[1] then return 0 end
      redis.call('HSET', KEYS[1], 'status', 'closed', 'host_ready', '0', 'guest_ready', '0')
      redis.call('EXPIRE', KEYS[1], 600)
      if redis.call('GET', KEYS[2]) == ARGV[2] then redis.call('DEL', KEYS[2]) end
      return 1
    `;
    const closed = await this.measure(operation, "EVAL", () =>
      this.client.eval(script, 2, config.redisKeys.room(code), config.redisKeys.userRoom(hostId), hostId, code)
    );
    return closed === 1;
  }

  /** The open room this user hosts, if they have one */
  async getUserRoomCode(userId: string, operation = "room_get_user_room"): Promise<string | null> {
    return this.measure(operation, "GET", () => this.client.get(config.redisKeys.userRoom(userId)));
  }

  async setUserRoomCode(userId: string, code: string, operation = "room_set_user_room"): Promise<void> {
    await this.measure(operation, "SET", () =>
      this.client.set(config.redisKeys.userRoom(userId), code, "EX", config.room.ttlSeconds)
    );
  }

  // ============================================
  // Fair Play Counters
  // ============================================
  //
  // One hash per match, fields prefixed with the player's id
  // ("<userId>:away_ms"). It outlives the match by an hour so the result can
  // be written after the match ends.

  private integrityTtlSeconds(): number {
    return Math.ceil(config.match.timeoutMs / 1000) + 3600;
  }

  /**
   * Count one fair play event. Returns true when it changed something worth
   * telling the opponent about (a player left or came back), and for every
   * counted blocked action. Events past the cap are ignored.
   */
  async recordFairPlayEvent(
    matchId: string,
    userId: string,
    event: FairPlayEvent,
    maxEvents: number,
    operation = "fair_play_event"
  ): Promise<boolean> {
    const script = `
      local p = ARGV[1] .. ':'
      local n = redis.call('HINCRBY', KEYS[1], p .. 'events', 1)
      redis.call('EXPIRE', KEYS[1], ARGV[5])
      if n > tonumber(ARGV[6]) then return 0 end
      local kind = ARGV[2]
      if kind == 'away' then
        if redis.call('HSETNX', KEYS[1], p .. 'away_since', ARGV[4]) == 1 then
          redis.call('HINCRBY', KEYS[1], p .. 'away_count', 1)
          return 1
        end
        return 0
      elseif kind == 'back' then
        local since = redis.call('HGET', KEYS[1], p .. 'away_since')
        if not since then return 0 end
        redis.call('HDEL', KEYS[1], p .. 'away_since')
        redis.call('HINCRBY', KEYS[1], p .. 'away_ms', math.max(0, tonumber(ARGV[4]) - tonumber(since)))
        return 1
      end
      redis.call('HINCRBY', KEYS[1], p .. kind, 1)
      if kind == 'paste_blocked' then
        local max = tonumber(redis.call('HGET', KEYS[1], p .. 'paste_max') or '0')
        if tonumber(ARGV[3]) > max then redis.call('HSET', KEYS[1], p .. 'paste_max', ARGV[3]) end
      end
      return 1
    `;
    const chars = "chars" in event ? Math.max(0, Math.floor(event.chars)) : 0;
    const changed = await this.measure(operation, "EVAL", () =>
      this.client.eval(
        script,
        1,
        config.redisKeys.integrity(matchId),
        userId,
        event.kind,
        chars.toString(),
        Date.now().toString(),
        this.integrityTtlSeconds().toString(),
        maxEvents.toString()
      )
    );
    return changed === 1;
  }

  /** Store the latest submission's editor counts for a player */
  async recordFairPlaySubmission(
    matchId: string,
    userId: string,
    fields: Record<string, number>,
    operation = "fair_play_submission"
  ): Promise<void> {
    const key = config.redisKeys.integrity(matchId);
    const prefixed = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [`${userId}:${k}`, String(v)])
    );
    await this.measure(operation, "HSET", () => this.client.hset(key, prefixed));
    await this.measure(operation, "HINCRBY", () => this.client.hincrby(key, `${userId}:submissions`, 1));
    await this.measure(operation, "EXPIRE", () => this.client.expire(key, this.integrityTtlSeconds()));
  }

  async getFairPlayCounters(matchId: string, operation = "fair_play_read"): Promise<Record<string, string>> {
    return this.measure(operation, "HGETALL", () => this.client.hgetall(config.redisKeys.integrity(matchId)));
  }

  /** Only the first caller writes a match's fair play result */
  async claimFairPlayFinalize(matchId: string, operation = "fair_play_finalize"): Promise<boolean> {
    const key = config.redisKeys.integrity(matchId);
    const claimed = await this.measure(operation, "HSETNX", () => this.client.hsetnx(key, "finalized", "1"));
    await this.measure(operation, "EXPIRE", () => this.client.expire(key, this.integrityTtlSeconds()));
    return claimed === 1;
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
