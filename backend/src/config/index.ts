import dotenv from "dotenv";
import path from "path";

// Load environment variables (.env.local takes priority over .env)
// dotenv won't overwrite existing values, so load .env.local first
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // Frontend
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",

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
    triggerDelay: parseInt(process.env.BOT_TRIGGER_DELAY || "60000", 10), // 60 seconds
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

  // Stripe
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
    priceId: process.env.STRIPE_PRICE_ID || "",
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
  },

  // Ranked matchmaking
  ranked: {
    initialEloRange: 200, // +/- 200 ELO to start
    expandIntervalMs: 30000, // Widen range every 30 seconds
    expandAmount: 100, // Widen by 100 each interval
    maxEloRange: 500, // Max +/- 500 ELO
  },

  // Redis keys
  redisKeys: {
    queue: "queue:global", // Legacy - used for unranked
    queueUnranked: "queue:unranked",
    queueRanked: "queue:ranked",
    match: (matchId: string) => `match:${matchId}`,
    userMatch: (userId: string) => `user:${userId}:match`,
    userSocket: (userId: string) => `user:${userId}:socket`,
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
