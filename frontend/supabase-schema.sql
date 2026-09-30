-- ==========================================
-- DEADLOCK DATABASE SCHEMA (PRODUCTION-READY)
-- ==========================================
-- This file contains the complete database schema for the Deadlock app.
-- Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ==========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- PROFILES TABLE
-- ==========================================
-- Stores user profile data and stats
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  
  -- Stats
  rating INTEGER DEFAULT 1000,
  global_rank INTEGER DEFAULT NULL,
  win_rate DECIMAL(5,2) DEFAULT 0.00,
  current_streak INTEGER DEFAULT 0,
  best_streak INTEGER DEFAULT 0,
  total_matches INTEGER DEFAULT 0,
  matches_won INTEGER DEFAULT 0,
  matches_lost INTEGER DEFAULT 0,
  
  -- Metadata
  is_bot BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- PROBLEMS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS problems (
  id SERIAL PRIMARY KEY,
  problem_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  difficulty TEXT,
  url TEXT,
  checker_type TEXT DEFAULT 'exact' CHECK (checker_type IN ('exact', 'special_chars', 'any_order', 'yes_no', 'float_tolerance', 'multiline_any', 'custom')),
  checker_code TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- PROBLEM TEST CASES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS problem_test_cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  input TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- GAME SESSIONS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS game_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  problem_id_ref INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  duration_seconds INTEGER,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- MATCHES TABLE
-- ==========================================
-- Stores individual player perspectives of a game session
CREATE TABLE IF NOT EXISTS matches (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  game_id UUID REFERENCES game_sessions(id) ON DELETE CASCADE,
  
  -- Player info
  player_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  opponent_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  
  -- Legacy denormalized problem strings
  problem_id TEXT NOT NULL,
  problem_title TEXT NOT NULL,
  problem_id_ref INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  
  language TEXT NOT NULL,
  
  -- Result
  result TEXT CHECK (result IN ('won', 'lost', 'draw')) NOT NULL,
  rating_change INTEGER DEFAULT 0,
  duration_seconds INTEGER,
  
  -- Bot Handling
  is_bot_match BOOLEAN DEFAULT false,
  bot_difficulty TEXT CHECK (bot_difficulty IN ('easy', 'medium', 'hard')),
  bot_username TEXT,

  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- BOT ANALYTICS
-- ==========================================
CREATE TABLE IF NOT EXISTS bot_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  bot_difficulty TEXT NOT NULL CHECK (bot_difficulty IN ('easy', 'medium', 'hard')),
  bot_won BOOLEAN NOT NULL,
  match_duration_seconds INTEGER,
  human_submitted BOOLEAN DEFAULT true,
  problem_rating TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- ACHIEVEMENTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS achievements (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT,
  is_coming_soon BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- USER_ACHIEVEMENTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS user_achievements (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  achievement_id UUID REFERENCES achievements(id) ON DELETE CASCADE NOT NULL,
  earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_global_rank ON profiles(global_rank);
CREATE INDEX IF NOT EXISTS idx_profiles_is_bot ON profiles(is_bot);

CREATE INDEX IF NOT EXISTS idx_matches_player_id ON matches(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_opponent_id ON matches(opponent_id);
CREATE INDEX IF NOT EXISTS idx_matches_game_id ON matches(game_id);
CREATE INDEX IF NOT EXISTS idx_matches_is_bot_match ON matches(is_bot_match);
CREATE INDEX IF NOT EXISTS idx_matches_completed_at ON matches(completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement_id ON user_achievements(achievement_id);

CREATE INDEX IF NOT EXISTS idx_bot_analytics_difficulty ON bot_analytics(bot_difficulty);

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE problem_test_cases ENABLE ROW LEVEL SECURITY;

-- VIEWS / PUBLIC TABLES
CREATE POLICY "Profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Achievements are viewable by everyone" ON achievements FOR SELECT USING (true);
CREATE POLICY "Problems are viewable by everyone" ON problems FOR SELECT USING (true);

-- TEST CASES: backend only (service_role bypasses RLS). No client policy, so
-- hidden expected outputs can't be read with the anon key.
REVOKE ALL ON problem_test_cases FROM PUBLIC, anon, authenticated;

-- USER AUTHENTICATED READS
CREATE POLICY "Users can view their own game sessions" ON game_sessions FOR SELECT USING (EXISTS (SELECT 1 FROM matches WHERE matches.game_id = game_sessions.id AND (matches.player_id = auth.uid() OR matches.opponent_id = auth.uid())));
CREATE POLICY "Users can view their own matches" ON matches FOR SELECT USING (auth.uid() = player_id OR auth.uid() = opponent_id);
CREATE POLICY "Users can view their own achievements" ON user_achievements FOR SELECT USING (auth.uid() = user_id);

-- USER ALLOWED INSERTS
CREATE POLICY "Users can insert their own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- PROFILE UPDATE SECURITY
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (username, avatar_url, updated_at) ON profiles TO authenticated;
GRANT ALL PRIVILEGES ON profiles TO service_role;

-- NOTE: Matches and User Achievements INSERTs are restricted to service_role to prevent manipulation.

-- ==========================================
-- FUNCTIONS & TRIGGERS
-- ==========================================
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'profile_image'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update stats after match trigger
CREATE OR REPLACE FUNCTION public.update_user_stats_after_match()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles
  SET 
    total_matches = total_matches + 1,
    matches_won = CASE WHEN NEW.result = 'won' THEN matches_won + 1 ELSE matches_won END,
    matches_lost = CASE WHEN NEW.result = 'lost' THEN matches_lost + 1 ELSE matches_lost END,
    current_streak = CASE WHEN NEW.result = 'won' THEN current_streak + 1 ELSE 0 END,
    best_streak = CASE WHEN NEW.result = 'won' AND (current_streak + 1) > best_streak THEN current_streak + 1 ELSE best_streak END,
    win_rate = CASE WHEN total_matches + 1 > 0 THEN ROUND(((matches_won::decimal + CASE WHEN NEW.result = 'won' THEN 1 ELSE 0 END) / (total_matches + 1)::decimal) * 100, 2) ELSE 0.00 END,
    updated_at = NOW()
  WHERE id = NEW.player_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_match_created ON matches;
CREATE TRIGGER on_match_created
  AFTER INSERT ON matches
  FOR EACH ROW EXECUTE FUNCTION public.update_user_stats_after_match();

-- SECURE MATCH RECORDER RPC
CREATE OR REPLACE FUNCTION public.record_match_pair(
  p_winner_id uuid,
  p_loser_id uuid,
  p_problem_id text,
  p_problem_id_ref integer,
  p_problem_title text,
  p_language text,
  p_duration_seconds integer,
  p_rating_change integer,
  p_is_bot_match boolean DEFAULT false,
  p_bot_difficulty text DEFAULT NULL,
  p_bot_username text DEFAULT NULL,
  p_completed_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id uuid;
BEGIN
  INSERT INTO public.game_sessions (problem_id_ref, duration_seconds, completed_at)
  VALUES (p_problem_id_ref, p_duration_seconds, p_completed_at)
  RETURNING id INTO v_game_id;

  INSERT INTO public.matches (game_id, player_id, opponent_id, problem_id, problem_id_ref, problem_title, language, result, rating_change, duration_seconds, is_bot_match, bot_difficulty, bot_username, completed_at)
  VALUES
    (v_game_id, p_winner_id, p_loser_id, p_problem_id, p_problem_id_ref, p_problem_title, p_language, 'won', p_rating_change, p_duration_seconds, p_is_bot_match, p_bot_difficulty, p_bot_username, p_completed_at),
    (v_game_id, p_loser_id, p_winner_id, p_problem_id, p_problem_id_ref, p_problem_title, p_language, 'lost', -p_rating_change, p_duration_seconds, p_is_bot_match, p_bot_difficulty, p_bot_username, p_completed_at);
END;
$$;

REVOKE ALL ON FUNCTION public.record_match_pair(uuid, uuid, text, integer, text, text, integer, integer, boolean, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_match_pair(uuid, uuid, text, integer, text, text, integer, integer, boolean, text, text, timestamptz) TO service_role;

-- ==========================================
-- VIEWS
-- ==========================================
CREATE OR REPLACE VIEW leaderboard WITH (security_invoker = true) AS
SELECT username, global_rank, rating, win_rate, total_matches, matches_won, best_streak
FROM profiles WHERE total_matches >= 5 
ORDER BY rating DESC, win_rate DESC, total_matches DESC LIMIT 100;

GRANT SELECT ON leaderboard TO authenticated;
