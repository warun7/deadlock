-- Migration: Ranked Mode + Premium Subscriptions
-- Date: 2026-02-07
-- Description: Adds ranked mode support with ELO persistence, rank tiers,
--              premium subscription tracking, and match type differentiation.

-- ============================================
-- 1. Add ranked/premium columns to profiles
-- ============================================

-- Persisted ELO rating (was calculated but never stored)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS current_rating INTEGER DEFAULT 1200;

-- Rank tier (derived from ELO, cached for quick lookups)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS rank_tier TEXT DEFAULT 'Silver';

-- Premium subscription status
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS premium_expires_at TIMESTAMP WITH TIME ZONE;

-- Stripe customer reference
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Ranked-specific stats
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS ranked_matches INTEGER DEFAULT 0;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS ranked_wins INTEGER DEFAULT 0;

COMMENT ON COLUMN public.profiles.current_rating IS 'ELO rating, updated after ranked matches. Default 1200.';
COMMENT ON COLUMN public.profiles.rank_tier IS 'Cached rank tier name derived from current_rating (Iron, Bronze, Silver, Gold, Platinum, Diamond, Master)';
COMMENT ON COLUMN public.profiles.is_premium IS 'Whether user has active premium subscription';
COMMENT ON COLUMN public.profiles.premium_expires_at IS 'When premium subscription expires';
COMMENT ON COLUMN public.profiles.stripe_customer_id IS 'Stripe customer ID for subscription management';
COMMENT ON COLUMN public.profiles.ranked_matches IS 'Total ranked matches played';
COMMENT ON COLUMN public.profiles.ranked_wins IS 'Total ranked matches won';

-- ============================================
-- 2. Add match_type to matches table
-- ============================================

ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS match_type TEXT DEFAULT 'unranked';

-- Add check constraint (safe with IF NOT EXISTS pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matches_match_type_check'
  ) THEN
    ALTER TABLE public.matches
    ADD CONSTRAINT matches_match_type_check
    CHECK (match_type IN ('ranked', 'unranked'));
  END IF;
END $$;

COMMENT ON COLUMN public.matches.match_type IS 'Whether this was a ranked or unranked match';

-- ============================================
-- 3. Create subscriptions table
-- ============================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add check constraint for status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check'
  ) THEN
    ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'canceled', 'past_due', 'incomplete', 'trialing'));
  END IF;
END $$;

COMMENT ON TABLE public.subscriptions IS 'Tracks Stripe subscription state for premium users';

-- ============================================
-- 4. Indexes for new columns
-- ============================================

CREATE INDEX IF NOT EXISTS idx_profiles_current_rating ON public.profiles(current_rating DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_rank_tier ON public.profiles(rank_tier);
CREATE INDEX IF NOT EXISTS idx_profiles_is_premium ON public.profiles(is_premium);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id ON public.profiles(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_matches_match_type ON public.matches(match_type);
CREATE INDEX IF NOT EXISTS idx_matches_player_match_type ON public.matches(player_id, match_type);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id ON public.subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_cust_id ON public.subscriptions(stripe_customer_id);

-- ============================================
-- 5. RLS for subscriptions table
-- ============================================

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can view their own subscriptions
CREATE POLICY "Users can view their own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can insert/update (via Stripe webhook handler)
-- No INSERT/UPDATE policy for regular users - backend uses service_role key

-- ============================================
-- 6. Function to compute rank tier from ELO
-- ============================================

CREATE OR REPLACE FUNCTION public.compute_rank_tier(rating INTEGER)
RETURNS TEXT AS $$
BEGIN
  IF rating >= 1800 THEN RETURN 'Master';
  ELSIF rating >= 1600 THEN RETURN 'Diamond';
  ELSIF rating >= 1400 THEN RETURN 'Platinum';
  ELSIF rating >= 1200 THEN RETURN 'Gold';
  ELSIF rating >= 1000 THEN RETURN 'Silver';
  ELSIF rating >= 800 THEN RETURN 'Bronze';
  ELSE RETURN 'Iron';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION public.compute_rank_tier IS 'Compute rank tier name from ELO rating: Iron(<800), Bronze(800-999), Silver(1000-1199), Gold(1200-1399), Platinum(1400-1599), Diamond(1600-1799), Master(1800+)';

-- ============================================
-- 7. Update the stats trigger to handle ranked mode + ELO
-- ============================================

CREATE OR REPLACE FUNCTION public.update_user_stats_after_match()
RETURNS TRIGGER AS $$
BEGIN
  -- Update general stats (same as before)
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
    -- Ranked-specific updates
    ranked_matches = CASE
      WHEN NEW.match_type = 'ranked' THEN ranked_matches + 1
      ELSE ranked_matches
    END,
    ranked_wins = CASE
      WHEN NEW.match_type = 'ranked' AND NEW.result = 'won' THEN ranked_wins + 1
      ELSE ranked_wins
    END,
    -- ELO update: only for ranked matches
    current_rating = CASE
      WHEN NEW.match_type = 'ranked' THEN GREATEST(0, current_rating + NEW.rating_change)
      ELSE current_rating
    END,
    -- Recompute rank tier after ELO change
    rank_tier = CASE
      WHEN NEW.match_type = 'ranked' THEN public.compute_rank_tier(GREATEST(0, current_rating + NEW.rating_change))
      ELSE rank_tier
    END,
    updated_at = NOW()
  WHERE id = NEW.player_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger already exists (on_match_created), replacing the function is enough.
-- The trigger will now use the updated function automatically.

-- ============================================
-- 8. Update leaderboard view for ranked mode
-- ============================================

-- Ranked leaderboard (by ELO rating)
CREATE OR REPLACE VIEW public.ranked_leaderboard AS
SELECT
  id,
  username,
  avatar_url,
  current_rating,
  rank_tier,
  ranked_matches,
  ranked_wins,
  is_premium,
  CASE
    WHEN ranked_matches > 0
      THEN ROUND((ranked_wins::decimal / ranked_matches::decimal) * 100, 2)
    ELSE 0.00
  END as ranked_win_rate
FROM profiles
WHERE ranked_matches >= 3
ORDER BY current_rating DESC
LIMIT 100;

GRANT SELECT ON public.ranked_leaderboard TO authenticated;

-- Drop and recreate original leaderboard (column set changed - can't use CREATE OR REPLACE)
DROP VIEW IF EXISTS public.leaderboard;
CREATE VIEW public.leaderboard AS
SELECT
  id,
  username,
  avatar_url,
  global_rank,
  win_rate,
  total_matches,
  matches_won,
  best_streak,
  current_rating,
  rank_tier,
  is_premium
FROM profiles
WHERE total_matches >= 5
ORDER BY win_rate DESC, total_matches DESC
LIMIT 100;

GRANT SELECT ON public.leaderboard TO authenticated;

-- ============================================
-- 9. Update recent_matches_detailed view
-- ============================================

-- Drop and recreate (adding match_type column changes the view shape)
DROP VIEW IF EXISTS public.recent_matches_detailed;
CREATE VIEW public.recent_matches_detailed AS
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
  m.match_type,
  m.duration_seconds,
  m.completed_at
FROM matches m
JOIN profiles p1 ON m.player_id = p1.id
JOIN profiles p2 ON m.opponent_id = p2.id
ORDER BY m.completed_at DESC;

GRANT SELECT ON public.recent_matches_detailed TO authenticated;

-- ============================================
-- 10. Set initial rank_tier for existing users
-- ============================================

UPDATE public.profiles
SET rank_tier = public.compute_rank_tier(COALESCE(current_rating, 1200))
WHERE rank_tier IS NULL OR rank_tier = 'Silver';

-- ============================================
-- 11. Verification
-- ============================================

DO $$
BEGIN
  -- Check new profile columns
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'current_rating'
  ) THEN
    RAISE NOTICE '✅ profiles.current_rating column exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_premium'
  ) THEN
    RAISE NOTICE '✅ profiles.is_premium column exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'stripe_customer_id'
  ) THEN
    RAISE NOTICE '✅ profiles.stripe_customer_id column exists';
  END IF;

  -- Check match_type column
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matches' AND column_name = 'match_type'
  ) THEN
    RAISE NOTICE '✅ matches.match_type column exists';
  END IF;

  -- Check subscriptions table
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'subscriptions'
  ) THEN
    RAISE NOTICE '✅ subscriptions table exists';
  END IF;

  -- Check compute_rank_tier function
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'compute_rank_tier'
  ) THEN
    RAISE NOTICE '✅ compute_rank_tier function exists';
  END IF;

  RAISE NOTICE '✅ Migration 005 complete - Ranked mode and subscriptions ready';
END $$;

-- ============================================
-- ROLLBACK (if needed)
-- ============================================

/*
DROP VIEW IF EXISTS public.ranked_leaderboard;
DROP FUNCTION IF EXISTS public.compute_rank_tier(INTEGER);
DROP TABLE IF EXISTS public.subscriptions;
ALTER TABLE public.matches DROP COLUMN IF EXISTS match_type;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS current_rating;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS rank_tier;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_premium;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS premium_expires_at;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS ranked_matches;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS ranked_wins;
-- Then re-run the original update_user_stats_after_match function from supabase-schema.sql
*/
