import dotenv from "dotenv";
import path from "path";

// Load environment variables (.env.local takes priority over .env)
// dotenv won't overwrite existing values, so load .env.local first
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return value === "true";
}

function parseTrustProxy(
  value: string | undefined,
): boolean | number | string {
  if (!value || value === "false") return false;
  if (value === "true") return true;

  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && asNumber >= 0) {
    return asNumber;
  }

  return value;
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // Frontend
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",

  // Operational settings
  operational: {
    enableDebugRoutes: parseBooleanEnv("ENABLE_DEBUG_ROUTES", false),
    debugApiSecret: process.env.DEBUG_API_SECRET || "",
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  },

  // Redis
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    jwtSecret: process.env.SUPABASE_JWT_SECRET || "",
  },

  // Judge0
  judge0: {
    url: process.env.JUDGE0_URL || "https://judge.deadlock.sbs",
    apiKey: process.env.JUDGE0_API_KEY || "",
  },

  // Match settings
  match: {
    timeoutMs: parseInt(process.env.MATCH_TIMEOUT_MS || "1800000", 10), // 30 minutes default
    matchmakingIntervalMs: parseInt(
      process.env.MATCHMAKING_INTERVAL_MS || "1000",
      10,
    ),
  },

  // Bot configuration
  bot: {
    enabled: process.env.BOT_ENABLED !== "false", // Enabled by default
    // After human pairing runs first; default > unranked FIFO fallback (90s) so bots do not beat it for solo waiters.
    triggerDelay: parseInt(process.env.BOT_TRIGGER_DELAY || "95000", 10),
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

    /** ELO upper bounds for easy / medium bot (hard is above mediumMax). */
    eloThresholds: {
      easyMax: parseInt(process.env.BOT_ELO_EASY_MAX || "1100", 10),
      mediumMax: parseInt(process.env.BOT_ELO_MEDIUM_MAX || "1500", 10),
    },

    /** Synthetic bot ELO shown in match + used for ranked K math. */
    syntheticElo: {
      anchorMin: parseInt(process.env.BOT_SYNTHETIC_ELO_MIN || "800", 10),
      anchorMax: parseInt(process.env.BOT_SYNTHETIC_ELO_MAX || "2400", 10),
      /** 0 = bot ELO = human; 1 = bot ELO pinned toward 1200 */
      pullStrength: parseFloat(process.env.BOT_SYNTHETIC_ELO_PULL || "0.35"),
    },
  },

  // Razorpay (subscriptions — create Plan in Dashboard, set RAZORPAY_PLAN_ID)
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
    planId: process.env.RAZORPAY_PLAN_ID || "",
  },

  // Ranked matchmaking (human vs human ELO window)
  ranked: {
    initialEloRange: parseInt(process.env.RANKED_ELO_INITIAL_RANGE || "200", 10),
    expandIntervalMs: parseInt(
      process.env.RANKED_ELO_EXPAND_INTERVAL_MS || "30000",
      10,
    ),
    expandAmount: parseInt(process.env.RANKED_ELO_EXPAND_AMOUNT || "100", 10),
    maxEloRange: parseInt(process.env.RANKED_ELO_MAX_RANGE || "500", 10),
  },

  // Unranked: still prefer similar ELO, but wider search than ranked
  unranked: {
    initialEloRange: parseInt(
      process.env.UNRANKED_ELO_INITIAL_RANGE || "400",
      10,
    ),
    expandIntervalMs: parseInt(
      process.env.UNRANKED_ELO_EXPAND_INTERVAL_MS || "25000",
      10,
    ),
    expandAmount: parseInt(process.env.UNRANKED_ELO_EXPAND_AMOUNT || "100", 10),
    maxEloRange: parseInt(process.env.UNRANKED_ELO_MAX_RANGE || "1000", 10),
  },

  // Problem pool vs player skill (Codeforces-style problem ratings)
  problems: {
    rankedHalfBand: parseInt(process.env.PROBLEM_RANKED_HALF_BAND || "150", 10),
    unrankedHalfBand: parseInt(
      process.env.PROBLEM_UNRANKED_HALF_BAND || "280",
      10,
    ),
    globalMin: parseInt(process.env.PROBLEM_RATING_MIN || "800", 10),
    globalMax: parseInt(process.env.PROBLEM_RATING_MAX || "3500", 10),
    bandWidenStep: parseInt(process.env.PROBLEM_BAND_WIDEN_STEP || "100", 10),
    bandMaxExtra: parseInt(process.env.PROBLEM_BAND_MAX_EXTRA || "500", 10),
  },

  // Redis keys
  redisKeys: {
    queue: "queue:global", // Legacy - used for unranked
    queueUnranked: "queue:unranked",
    queueRanked: "queue:ranked",
    match: (matchId: string) => `match:${matchId}`,
    userMatch: (userId: string) => `user:${userId}:match`,
    userSocket: (userId: string) => `user:${userId}:socket`,
    botMatchLock: (userId: string) => `lock:bot_match:${userId}`,
  },
} as const;

// Validate required config
export function validateConfig(): void {
  const required = ["SUPABASE_URL"];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missing.join(", ")}`);
    console.warn("   Some features may not work correctly.");
  }
}
