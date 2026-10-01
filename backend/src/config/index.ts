import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// The site's public origin: the first FRONTEND_URL entry
const siteOrigin = (process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/+$/, "");

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // Frontend
  // Comma-separated list so one build serves local dev, a preview URL and
  // production without code changes. FRONTEND_URL stays for compatibility.
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  frontendUrls: (process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  siteOrigin,
  // The app's index.html, which invite link pages fill in with a room's link
  // preview. In Docker this is the frontend container (no trip out and back in).
  appShellUrl: process.env.APP_SHELL_URL || `${siteOrigin}/index.html`,

  // Admin / debug
  adminSecret: process.env.ADMIN_SECRET || "",

  // Proxy hops in front of Express. In production the edge Caddy is the one
  // hop, so req.ip (and with it the rate limiter) sees the player's address
  // instead of Caddy's. 0 when the server is reached directly.
  trustProxy: parseInt(
    process.env.TRUST_PROXY ?? (process.env.NODE_ENV === "production" ? "1" : "0"),
    10
  ) || 0,

  // Redis
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  // Socket / scaling
  socket: {
    enableRedisAdapter: process.env.ENABLE_REDIS_ADAPTER === "true",
  },

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    jwtSecret: process.env.SUPABASE_JWT_SECRET || "",
  },

  // Judge0
  // Defaults to the standard Judge0 port on the local host. In the Docker
  // deployment this is overridden with the internal service URL
  // (http://judge0-server:2358) so Judge0 never needs to be publicly exposed.
  judge0: {
    url: process.env.JUDGE0_URL || "http://localhost:2358",
    apiKey: process.env.JUDGE0_API_KEY || "",
    // Compile once and run every test in one Judge0 run (see BatchJudge).
    // JUDGE0_BATCH=false goes back to one Judge0 submission per test.
    batch: process.env.JUDGE0_BATCH !== "false",
    // Wall-clock limit for each test in a batch run
    testTimeLimitMs: parseInt(process.env.JUDGE_TEST_TIME_LIMIT_MS || "3000", 10),
    // Submissions judged at the same time. Time limits are wall-clock, so on
    // a 1-vCPU server a second run would push the first into false TLEs.
    maxParallelRuns: Math.max(1, parseInt(process.env.JUDGE0_MAX_PARALLEL_RUNS || "1", 10) || 1),
    // Concurrent Judge0 requests when judging test by test
    perTestConcurrency: Math.max(1, parseInt(process.env.JUDGE0_PER_TEST_CONCURRENCY || "2", 10) || 2),
    requestTimeoutMs: parseInt(process.env.JUDGE0_TIMEOUT_MS || "60000", 10),
  },

  // Match settings
  match: {
    timeoutMs: parseInt(process.env.MATCH_TIMEOUT_MS || "1800000", 10), // 30 minutes default
    // How long a player who drops out of an active match (refresh, network
    // blip, laptop sleep) has to come back before the opponent is awarded
    // the win.
    reconnectGraceMs: parseInt(process.env.RECONNECT_GRACE_MS || "45000", 10),
  },

  // Duel rooms (invite a friend with a link)
  room: {
    // A room is forgotten after this long without activity
    ttlSeconds: parseInt(process.env.ROOM_TTL_SECONDS || "10800", 10), // 3 hours
  },

  // Bot configuration
  bot: {
    // Practice mode (bots never join ranked). BOT_ENABLED=false turns it off.
    enabled: process.env.BOT_ENABLED !== "false",
    defaultDifficulty: (process.env.BOT_DEFAULT_DIFFICULTY || "medium") as
      | "easy"
      | "medium"
      | "hard",

    // Time multipliers per difficulty
    timeMultipliers: {
      easy: { min: 1.8, max: 2.5 },
      medium: { min: 1.2, max: 1.6 },
      hard: { min: 0.9, max: 1.1 },
    },
  },

  // Redis keys
  redisKeys: {
    match: (matchId: string) => `match:${matchId}`,
    userMatch: (userId: string) => `user:${userId}:match`,
    userSocket: (userId: string) => `user:${userId}:socket`,
    room: (code: string) => `room:${code}`,
    userRoom: (userId: string) => `user:${userId}:room`, // the open room this user hosts
    integrity: (matchId: string) => `integrity:${matchId}`, // fair play counters per player
  },
} as const;

// Validate required config
export function validateConfig(): void {
  const required = ["SUPABASE_URL", "SUPABASE_JWT_SECRET"];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missing.join(", ")}`);
    console.warn("   Some features may not work correctly.");
  }
}
