// Database types for Deadlock

export interface Profile {
  id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  global_rank: number | null;
  win_rate: number;
  current_streak: number;
  best_streak: number;
  total_matches: number;
  matches_won: number;
  matches_lost: number;
  // Ranked / Premium fields
  current_rating: number;
  rank_tier: string;
  is_premium: boolean;
  premium_expires_at: string | null;
  stripe_customer_id: string | null;
  ranked_matches: number;
  ranked_wins: number;
  created_at: string;
  updated_at: string;
}

// Rank tier thresholds (must match backend + DB function)
export const RANK_TIERS = {
  Iron: { min: 0, max: 799, color: "#6b7280" },
  Bronze: { min: 800, max: 999, color: "#cd7f32" },
  Silver: { min: 1000, max: 1199, color: "#c0c0c0" },
  Gold: { min: 1200, max: 1399, color: "#ffd700" },
  Platinum: { min: 1400, max: 1599, color: "#00d4ff" },
  Diamond: { min: 1600, max: 1799, color: "#b9f2ff" },
  Master: { min: 1800, max: 9999, color: "#ff4444" },
} as const;

export type RankTierName = keyof typeof RANK_TIERS;

export interface Match {
  id: string;
  player_id: string;
  opponent_id: string;
  problem_id: string;
  problem_title: string;
  language: string;
  result: "won" | "lost" | "draw";
  rating_change: number;
  match_type: "ranked" | "unranked";
  duration_seconds: number | null;
  completed_at: string;
  created_at: string;
}

export interface MatchDetailed extends Match {
  player_username: string;
  opponent_username: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  is_coming_soon: boolean;
  created_at: string;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  earned_at: string;
  achievement?: Achievement; // Joined data
}
