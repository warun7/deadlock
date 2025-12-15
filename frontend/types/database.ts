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
  created_at: string;
  updated_at: string;
}

export interface Match {
  id: string;
  player_id: string;
  opponent_id: string;
  problem_id: string;
  problem_title: string;
  language: string;
  result: 'won' | 'lost' | 'draw';
  rating_change: number;
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


