-- ==========================================
-- DEADLOCK DATABASE SCHEMA
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
  email TEXT NOT NULL,
  avatar_url TEXT,
  
  -- Stats
  global_rank INTEGER DEFAULT NULL, -- NULL = coming soon
  win_rate DECIMAL(5,2) DEFAULT 0.00, -- Percentage (0.00 to 100.00)
  current_streak INTEGER DEFAULT 0,
  best_streak INTEGER DEFAULT 0,
  total_matches INTEGER DEFAULT 0,
  matches_won INTEGER DEFAULT 0,
  matches_lost INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- MATCHES TABLE
-- ==========================================
-- Stores match history for all users
CREATE TABLE IF NOT EXISTS matches (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  
  -- Player info
  player_id UUID REFERENCES profiles(id) NOT NULL,
  opponent_id UUID REFERENCES profiles(id) NOT NULL,
  
  -- Match details
  problem_id TEXT NOT NULL, -- Problem identifier (e.g., "two-sum", "reverse-linked-list")
  problem_title TEXT NOT NULL,
  language TEXT NOT NULL, -- Programming language used (e.g., "javascript", "python")
  
  -- Result
  result TEXT CHECK (result IN ('won', 'lost', 'draw')) NOT NULL,
  rating_change INTEGER DEFAULT 0, -- Can be positive or negative
  
  -- Timing
  duration_seconds INTEGER, -- How long the match lasted
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- ACHIEVEMENTS TABLE
-- ==========================================
-- Stores available achievements
CREATE TABLE IF NOT EXISTS achievements (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT, -- Icon name or URL
  is_coming_soon BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- USER_ACHIEVEMENTS TABLE
-- ==========================================
-- Tracks which achievements users have earned
CREATE TABLE IF NOT EXISTS user_achievements (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  achievement_id UUID REFERENCES achievements(id) NOT NULL,
  earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

-- ==========================================
-- INDEXES
-- ==========================================
-- Improve query performance

-- Profile lookups
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_global_rank ON profiles(global_rank);

-- Match queries
CREATE INDEX IF NOT EXISTS idx_matches_player_id ON matches(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_opponent_id ON matches(opponent_id);
CREATE INDEX IF NOT EXISTS idx_matches_completed_at ON matches(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_player_completed ON matches(player_id, completed_at DESC);

-- Achievement queries
CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id);

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================
-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- RLS POLICIES: PROFILES
-- ==========================================

-- Users can view all profiles (for leaderboards, opponent info, etc.)
CREATE POLICY "Profiles are viewable by everyone" 
  ON profiles FOR SELECT 
  USING (true);

-- Users can only insert their own profile
CREATE POLICY "Users can insert their own profile" 
  ON profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

-- Users can only update their own profile
CREATE POLICY "Users can update own profile" 
  ON profiles FOR UPDATE 
  USING (auth.uid() = id);

-- ==========================================
-- RLS POLICIES: MATCHES
-- ==========================================

-- Users can view matches they participated in
CREATE POLICY "Users can view their own matches" 
  ON matches FOR SELECT 
  USING (auth.uid() = player_id OR auth.uid() = opponent_id);

-- Only authenticated users can insert matches (game server will do this)
CREATE POLICY "Authenticated users can insert matches" 
  ON matches FOR INSERT 
  WITH CHECK (auth.uid() = player_id);

-- ==========================================
-- RLS POLICIES: ACHIEVEMENTS
-- ==========================================

-- Everyone can view achievements
CREATE POLICY "Achievements are viewable by everyone" 
  ON achievements FOR SELECT 
  USING (true);

-- ==========================================
-- RLS POLICIES: USER_ACHIEVEMENTS
-- ==========================================

-- Users can view their own achievements
CREATE POLICY "Users can view their own achievements" 
  ON user_achievements FOR SELECT 
  USING (auth.uid() = user_id);

-- Authenticated users can earn achievements
CREATE POLICY "Users can insert their own achievements" 
  ON user_achievements FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- ==========================================
-- FUNCTIONS
-- ==========================================

-- Function to automatically create a profile when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    NEW.email,
    NEW.raw_user_meta_data->>'profile_image'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- Function to update user stats after a match
CREATE OR REPLACE FUNCTION public.update_user_stats_after_match()
RETURNS TRIGGER AS $$
BEGIN
  -- Update player stats
  UPDATE profiles
  SET 
    total_matches = total_matches + 1,
    matches_won = CASE WHEN NEW.result = 'won' THEN matches_won + 1 ELSE matches_won END,
    matches_lost = CASE WHEN NEW.result = 'lost' THEN matches_lost + 1 ELSE matches_lost END,
    current_streak = CASE 
      WHEN NEW.result = 'won' THEN current_streak + 1
      ELSE 0
    END,
    best_streak = CASE 
      WHEN NEW.result = 'won' AND (current_streak + 1) > best_streak 
        THEN current_streak + 1
      ELSE best_streak
    END,
    win_rate = CASE 
      WHEN total_matches + 1 > 0 
        THEN ROUND(((matches_won::decimal + CASE WHEN NEW.result = 'won' THEN 1 ELSE 0 END) / (total_matches + 1)::decimal) * 100, 2)
      ELSE 0.00
    END,
    updated_at = NOW()
  WHERE id = NEW.player_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update stats after match insert
DROP TRIGGER IF EXISTS on_match_created ON matches;
CREATE TRIGGER on_match_created
  AFTER INSERT ON matches
  FOR EACH ROW EXECUTE FUNCTION public.update_user_stats_after_match();

-- ==========================================
-- SEED DATA: Sample Achievements
-- ==========================================
INSERT INTO achievements (name, description, icon, is_coming_soon) VALUES
  ('First Victory', 'Win your first match', 'trophy', false),
  ('Winning Streak', 'Win 5 matches in a row', 'zap', false),
  ('Speed Demon', 'Complete a match in under 5 minutes', 'clock', false),
  ('Polyglot', 'Win matches in 3 different languages', 'code', false),
  ('Coming Soon 1', 'This achievement is under development', 'award', true),
  ('Coming Soon 2', 'This achievement is under development', 'award', true),
  ('Coming Soon 3', 'This achievement is under development', 'award', true),
  ('Coming Soon 4', 'This achievement is under development', 'award', true)
ON CONFLICT DO NOTHING;

-- ==========================================
-- HELPER VIEWS
-- ==========================================

-- View for leaderboard (top players by win rate)
CREATE OR REPLACE VIEW leaderboard AS
SELECT 
  username,
  global_rank,
  win_rate,
  total_matches,
  matches_won,
  best_streak
FROM profiles
WHERE total_matches >= 5 -- Only show users with at least 5 matches
ORDER BY win_rate DESC, total_matches DESC
LIMIT 100;

-- View for recent matches with opponent details
CREATE OR REPLACE VIEW recent_matches_detailed AS
SELECT 
  m.id,
  m.player_id,
  p1.username as player_username,
  m.opponent_id,
  p2.username as opponent_username,
  m.problem_id,
  m.problem_title,
  m.language,
  m.result,
  m.rating_change,
  m.duration_seconds,
  m.completed_at
FROM matches m
JOIN profiles p1 ON m.player_id = p1.id
JOIN profiles p2 ON m.opponent_id = p2.id
ORDER BY m.completed_at DESC;

-- ==========================================
-- GRANT PERMISSIONS
-- ==========================================
-- Allow authenticated users to access views
GRANT SELECT ON leaderboard TO authenticated;
GRANT SELECT ON recent_matches_detailed TO authenticated;

-- ==========================================
-- DONE!
-- ==========================================
-- Your database schema is now set up!
-- Next steps:
-- 1. Run this SQL in Supabase Dashboard > SQL Editor
-- 2. Verify tables are created in Table Editor
-- 3. Test RLS policies
-- ==========================================

