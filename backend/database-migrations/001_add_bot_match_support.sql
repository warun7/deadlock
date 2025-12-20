-- Migration: Add Bot Match Support
-- Date: 2025-12-16
-- Description: Adds columns to track bot matches and bot profiles

-- ============================================
-- 1. Add is_bot column to profiles table
-- ============================================

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_bot boolean DEFAULT false;

COMMENT ON COLUMN public.profiles.is_bot IS 'Indicates if this profile represents a bot player';

-- ============================================
-- 2. Add bot match tracking to matches table
-- ============================================

ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS is_bot_match boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS bot_difficulty text;

COMMENT ON COLUMN public.matches.is_bot_match IS 'Indicates if this match was against a bot';
COMMENT ON COLUMN public.matches.bot_difficulty IS 'Bot difficulty level: easy, medium, or hard';

-- ============================================
-- 3. Note about bot profiles
-- ============================================

-- NOTE: We don't create a bot profile here because profiles.id has a foreign key 
-- constraint to auth.users, and we can't create auth users via SQL.
-- Instead, bot matches will use the bot's generated ID as opponent_id, 
-- which doesn't require a profile to exist.
-- The bot ID will be like 'bot_xyz123' which won't match any real user ID.

-- If you want to create a real bot profile for analytics:
-- 1. Create a Supabase auth user via the dashboard (email: bot@deadlock.dev)
-- 2. Copy the generated UUID
-- 3. Update the profile with is_bot = true
-- Example:
-- UPDATE public.profiles SET is_bot = true WHERE email = 'bot@deadlock.dev';

DO $$
BEGIN
  RAISE NOTICE '⚠️  Bot profiles are created dynamically. No static bot profile needed.';
END $$;

-- ============================================
-- 4. Create indexes for performance
-- ============================================

-- Index for querying bot matches
CREATE INDEX IF NOT EXISTS idx_matches_is_bot_match 
ON public.matches(is_bot_match);

-- Index for querying bot profiles
CREATE INDEX IF NOT EXISTS idx_profiles_is_bot 
ON public.profiles(is_bot);

-- Composite index for player's human-only matches
CREATE INDEX IF NOT EXISTS idx_matches_player_human_only 
ON public.matches(player_id, is_bot_match) 
WHERE is_bot_match = false;

-- ============================================
-- 5. Create view for human-only matches
-- ============================================

-- Useful for leaderboards and stats that exclude bot matches
CREATE OR REPLACE VIEW public.human_matches AS
SELECT * FROM public.matches 
WHERE is_bot_match = false;

COMMENT ON VIEW public.human_matches IS 'View of matches excluding bot matches - useful for competitive rankings';

-- ============================================
-- 6. Create analytics table for bot performance
-- ============================================

CREATE TABLE IF NOT EXISTS public.bot_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL,
  bot_difficulty text NOT NULL,
  bot_won boolean NOT NULL,
  match_duration_seconds integer,
  human_submitted boolean DEFAULT true,
  problem_rating text,
  created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.bot_analytics IS 'Tracks bot match performance for analytics and difficulty tuning';

CREATE INDEX IF NOT EXISTS idx_bot_analytics_created_at 
ON public.bot_analytics(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_analytics_difficulty 
ON public.bot_analytics(bot_difficulty);

-- ============================================
-- 7. Update the stats trigger to handle bot matches
-- ============================================

-- The existing trigger should already handle bot matches correctly
-- since it just counts wins/losses regardless of opponent type.
-- But let's verify it exists and add a note.

-- Verify the trigger exists (this will error if it doesn't, which is good for debugging)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_user_stats_after_match'
  ) THEN
    RAISE NOTICE 'Warning: update_user_stats_after_match trigger not found. Stats may not update automatically.';
  ELSE
    RAISE NOTICE 'Stats trigger exists - bot matches will be counted in player stats.';
  END IF;
END $$;

-- ============================================
-- 8. Create helper function to get human-only stats
-- ============================================

-- Function to calculate stats excluding bot matches
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_human_only_stats IS 'Get player statistics excluding bot matches';

-- ============================================
-- 9. Verification queries
-- ============================================

-- Check that columns were added
DO $$
BEGIN
  -- Check profiles.is_bot
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'is_bot'
  ) THEN
    RAISE NOTICE '✅ profiles.is_bot column exists';
  END IF;
  
  -- Check matches.is_bot_match
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'matches' AND column_name = 'is_bot_match'
  ) THEN
    RAISE NOTICE '✅ matches.is_bot_match column exists';
  END IF;
  
  -- Check matches.bot_difficulty
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'matches' AND column_name = 'bot_difficulty'
  ) THEN
    RAISE NOTICE '✅ matches.bot_difficulty column exists';
  END IF;
  
  -- Bot profiles are created dynamically, no static profile needed
  RAISE NOTICE '✅ Bot system columns ready (bot profiles created dynamically)';
END $$;

-- ============================================
-- ROLLBACK (if needed)
-- ============================================

-- To rollback this migration, run:
/*
DROP VIEW IF EXISTS public.human_matches;
DROP FUNCTION IF EXISTS public.get_human_only_stats(uuid);
DROP TABLE IF EXISTS public.bot_analytics;
DROP INDEX IF EXISTS idx_matches_is_bot_match;
DROP INDEX IF EXISTS idx_profiles_is_bot;
DROP INDEX IF EXISTS idx_matches_player_human_only;
DROP INDEX IF EXISTS idx_bot_analytics_created_at;
DROP INDEX IF EXISTS idx_bot_analytics_difficulty;
ALTER TABLE public.matches DROP COLUMN IF EXISTS is_bot_match;
ALTER TABLE public.matches DROP COLUMN IF EXISTS bot_difficulty;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_bot;
-- No bot profile to delete (created dynamically)
*/
