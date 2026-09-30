import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

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

  // Admin / debug
  adminSecret: process.env.ADMIN_SECRET || "",

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
  },

  // Match settings
  match: {
    timeoutMs: parseInt(process.env.MATCH_TIMEOUT_MS || "1800000", 10), // 30 minutes default
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

  // Redis keys
  redisKeys: {
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
