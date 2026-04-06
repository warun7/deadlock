-- Migration: Architectural Foundation & Security (006)
-- Date: 2026-04-06
-- Description: Introduces game_sessions, adds Elo rating, adds constraints, and patches IDOR vulnerabilities.

-- ============================================
-- 1. Create Game Sessions to normalize matches
-- ============================================
CREATE TABLE IF NOT EXISTS public.game_sessions (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  problem_id_ref integer REFERENCES public.problems(id),
  duration_seconds integer,
  completed_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- ============================================
-- 2. Link Matches and Analytics to Game Sessions
-- ============================================
ALTER TABLE public.matches 
  ADD COLUMN IF NOT EXISTS game_id uuid REFERENCES public.game_sessions(id) ON DELETE CASCADE;

-- TRUNCATE to safely add foreign keys to existing tables (approved by user)
TRUNCATE TABLE public.bot_analytics CASCADE;
TRUNCATE TABLE public.matches CASCADE;

-- Update bot_analytics to correctly reference the game session
ALTER TABLE public.bot_analytics
  DROP CONSTRAINT IF EXISTS bot_analytics_match_id_fkey;

ALTER TABLE public.bot_analytics
  ADD CONSTRAINT bot_analytics_match_id_fkey 
  FOREIGN KEY (match_id) REFERENCES public.game_sessions(id) ON DELETE CASCADE;

-- ============================================
-- 3. Database Constraints
-- ============================================
-- Add Check constraints for bot difficulty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bot_difficulty') THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT chk_bot_difficulty CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bot_analytics_difficulty') THEN
    ALTER TABLE public.bot_analytics
      ADD CONSTRAINT chk_bot_analytics_difficulty CHECK (bot_difficulty IN ('easy', 'medium', 'hard'));
  END IF;
END $$;

-- Enable indexing on user_achievements
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement_id 
  ON public.user_achievements(achievement_id);

-- Enforce problem_id reference on matches
-- Make sure the constraint exists without breaking
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matches_problem_id_ref_fkey') THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_problem_id_ref_fkey FOREIGN KEY (problem_id_ref) REFERENCES public.problems(id);
  END IF;
END $$;

-- ============================================
-- 4. Add 'rating' to Profiles
-- ============================================
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS rating integer DEFAULT 1000;

-- ============================================
-- 5. Secure match recording function
-- ============================================
-- We overwrite the function to include the game_session insertion
DROP FUNCTION IF EXISTS public.record_match_pair(uuid, uuid, text, text, text, integer, integer, timestamptz);

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
  -- Insert canonical game transaction
  INSERT INTO public.game_sessions (problem_id_ref, duration_seconds, completed_at)
  VALUES (p_problem_id_ref, p_duration_seconds, p_completed_at)
  RETURNING id INTO v_game_id;

  INSERT INTO public.matches (
    game_id,
    player_id,
    opponent_id,
    problem_id,
    problem_id_ref,
    problem_title,
    language,
    result,
    rating_change,
    duration_seconds,
    is_bot_match,
    bot_difficulty,
    bot_username,
    completed_at
  )
  VALUES
    (
      v_game_id,
      p_winner_id,
      p_loser_id,
      p_problem_id,
      p_problem_id_ref,
      p_problem_title,
      p_language,
      'won',
      p_rating_change,
      p_duration_seconds,
      p_is_bot_match,
      p_bot_difficulty,
      p_bot_username,
      p_completed_at
    ),
    (
      v_game_id,
      p_loser_id,
      p_winner_id,
      p_problem_id,
      p_problem_id_ref,
      p_problem_title,
      p_language,
      'lost',
      -p_rating_change,
      p_duration_seconds,
      p_is_bot_match,
      p_bot_difficulty,
      p_bot_username,
      p_completed_at
    );
END;
$$;

-- SECURE RPC: Only allow backend service role to insert match outcomes (Client cannot!)
REVOKE ALL ON FUNCTION public.record_match_pair(
  uuid, uuid, text, integer, text, text, integer, integer, boolean, text, text, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_match_pair(
  uuid, uuid, text, integer, text, text, integer, integer, boolean, text, text, timestamptz
) TO service_role;

-- ============================================
-- 6. Lock down Row Level Security (RLS)
-- ============================================

-- Drop insecure client insert policies
DROP POLICY IF EXISTS "Authenticated users can insert matches" ON matches;
DROP POLICY IF EXISTS "Users can insert their own achievements" ON user_achievements;

-- Fix Profile Update security
-- Force the policy to explicitly require WITH CHECK to match ID
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" 
  ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Completely revoke default UPDATE permissions from the client layer
REVOKE UPDATE ON profiles FROM authenticated;
-- Only grant explicit modification capabilities for cosmetic identity columns
GRANT UPDATE (username, avatar_url, updated_at) ON profiles TO authenticated;

-- Ensure service_role retains maximum power
GRANT ALL PRIVILEGES ON profiles TO service_role;

-- ============================================
-- 7. Fix Security Lints (RLS, Views, Privacy)
-- ============================================

-- Fix 1: Enable RLS on new tables
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_analytics ENABLE ROW LEVEL SECURITY;

-- game_sessions policy: users can only see sessions they participated in
CREATE POLICY "Users can view their own game sessions" 
  ON public.game_sessions FOR SELECT 
  USING (EXISTS (
    SELECT 1 FROM public.matches 
    WHERE matches.game_id = game_sessions.id AND (matches.player_id = auth.uid() OR matches.opponent_id = auth.uid())
  ));

-- bot_analytics policy: default deny (no policies). Only service_role can access.

-- Fix 2: Drop exposed email column from profiles
-- auth.users already stores the email securely, no need to duplicate it in the public profiles table.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS email;

-- Fix 3: Secure the explicit views
-- Using security_invoker = true ensures the view respects the caller's RLS policies
DROP VIEW IF EXISTS public.leaderboard;
CREATE VIEW public.leaderboard WITH (security_invoker = true) AS
SELECT username, global_rank, rating, win_rate, total_matches, matches_won, best_streak
FROM public.profiles WHERE total_matches >= 5 
ORDER BY rating DESC, win_rate DESC, total_matches DESC LIMIT 100;

DROP VIEW IF EXISTS public.human_matches;
CREATE VIEW public.human_matches WITH (security_invoker = true) AS
SELECT * FROM public.matches 
WHERE is_bot_match = false;

-- Fix 4: Set search_path for SECURITY DEFINER functions to prevent privilege-escalation/function hijacking
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

CREATE OR REPLACE FUNCTION public.get_human_only_stats(user_id uuid)
RETURNS TABLE (
  total_matches bigint,
  matches_won bigint,
  matches_lost bigint,
  win_rate numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::bigint as total_matches,
    COUNT(*) FILTER (WHERE result = 'won')::bigint as matches_won,
    COUNT(*) FILTER (WHERE result = 'lost')::bigint as matches_lost,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(*) FILTER (WHERE result = 'won')::numeric / COUNT(*)::numeric) * 100, 2)
      ELSE 0.00
    END as win_rate
  FROM public.matches
  WHERE player_id = user_id AND is_bot_match = false;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION public.update_problems_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
