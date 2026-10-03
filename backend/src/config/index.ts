import dotenv from "dotenv";
import os from "os";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// The site's public origin: the first FRONTEND_URL entry
const siteOrigin = (process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/+$/, "");

const csv = (value: string | undefined) =>
  (value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

/** "auto" (the default) runs one submission per CPU the server has */
function parallelRuns(value: string | undefined): number {
  if (!value || value.trim().toLowerCase() === "auto") {
    const cpus = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
    return Math.max(1, cpus || 1);
  }
  return Math.max(1, parseInt(value, 10) || 1);
}

/** "HH:MM" in UTC, or null for "off" or anything unreadable */
function utcTime(value: string | undefined, fallback: string): { hour: number; minute: number } | null {
  const raw = (value ?? fallback).trim().toLowerCase();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

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
  // Who can open /admin (fair-play review, funnel, seasons): Supabase user
  // ids and/or account emails, comma-separated
  admin: {
    userIds: csv(process.env.ADMIN_USER_IDS),
    emails: csv(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  },

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
    // "auto" (default) follows the server's CPU count: 1 on a 1-vCPU droplet,
    // 4 once it is resized to 4, with nothing to change.
    maxParallelRuns: parallelRuns(process.env.JUDGE0_MAX_PARALLEL_RUNS),
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

  // Ghost duels: race a recording of a real player's ranked win (unrated)
  ghost: {
    enabled: process.env.GHOST_ENABLED !== "false",
  },

  // The daily ranked hour: everyone is pointed at the same hour so queues
  // fill. RANKED_HOUR_UTC=off turns it off.
  rankedHour: {
    start: utcTime(process.env.RANKED_HOUR_UTC, "15:00"),
    minutes: Math.min(240, Math.max(15, parseInt(process.env.RANKED_HOUR_MINUTES || "60", 10) || 60)),
  },

  // "Someone is waiting" alerts: browser push (VAPID keys, see
  // deploy/README.md) and a Discord channel webhook. Each is off until set.
  notify: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || "",
    vapidSubject: process.env.VAPID_SUBJECT || `mailto:${process.env.ACME_EMAIL || "admin@deadlock.sbs"}`,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
    // Role to ping, e.g. a "ranked ping" role players opt into
    discordRoleId: process.env.DISCORD_ROLE_ID || "",
    // Alone in the queue this long before anyone is told
    queueAlertDelayMs: parseInt(process.env.QUEUE_ALERT_DELAY_MS || "20000", 10),
    // At most one alert this often, and per subscriber at most this often
    queueAlertCooldownMs: parseInt(process.env.QUEUE_ALERT_COOLDOWN_MS || "600000", 10),
    subscriberCooldownMs: parseInt(process.env.QUEUE_ALERT_SUBSCRIBER_COOLDOWN_MS || "3600000", 10),
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
    submissions: (matchId: string) => `submissions:${matchId}`, // each player's last submission, for comparing after
    timeline: (matchId: string) => `timeline:${matchId}`, // when each submission landed, for ghost recordings
    once: (name: string) => `once:${name}`, // one-time jobs (daily ranked hour alert)
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
