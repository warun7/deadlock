-- =============================================================================
-- Deadlock — Supabase hardening + problem rating column (paste in SQL Editor)
-- =============================================================================
-- Prerequisites: PostgreSQL 15+ (Supabase default). Run as postgres / dashboard.
--
-- What this does:
--   1) Sets security_invoker on public views (fixes "Security Definer View" lint)
--   2) Recreates recent_matches_detailed with LEFT JOIN so bot opponents work
--   3) Enables RLS on bot_analytics (backend-only via service role)
--   4) Converts problems.difficulty from text → integer + index (optional section)
--
-- After running:
--   - Test leaderboard + recent matches in the app as a logged-in user.
--   - If leaderboard is empty, check RLS on profiles (need SELECT for public read).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Security invoker on existing views (keeps definitions; fixes linter)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['human_matches', 'leaderboard', 'ranked_leaderboard']::text[]
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_views
      WHERE schemaname = 'public' AND viewname = v
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
      RAISE NOTICE 'Set security_invoker on view public.%', v;
    ELSE
      RAISE NOTICE 'Skip missing view public.%', v;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2) recent_matches_detailed — recreate with security_invoker + bot-safe join
-- -----------------------------------------------------------------------------
-- INNER JOIN on opponent profile drops rows when opponent_id has no profiles row
-- (common for bot matches). Use LEFT JOIN + COALESCE.

DROP VIEW IF EXISTS public.recent_matches_detailed;

CREATE VIEW public.recent_matches_detailed
WITH (security_invoker = true) AS
SELECT
  m.id,
  m.player_id,
  p1.username AS player_username,
  m.opponent_id,
  COALESCE(p2.username, m.bot_username, 'Bot') AS opponent_username,
  m.problem_id,
  m.problem_title,
  m.language,
  m.result,
  m.rating_change,
  m.duration_seconds,
  m.completed_at,
  m.is_bot_match,
  m.bot_difficulty,
  m.match_type
FROM public.matches m
JOIN public.profiles p1 ON m.player_id = p1.id
LEFT JOIN public.profiles p2 ON m.opponent_id = p2.id
ORDER BY m.completed_at DESC;

COMMENT ON VIEW public.recent_matches_detailed IS
  'Match history with usernames; security_invoker so RLS applies to querying user; LEFT JOIN keeps bot rows.';

GRANT SELECT ON public.recent_matches_detailed TO authenticated;

-- Re-grant leaderboard views (unchanged definitions; only if you rely on anon)
GRANT SELECT ON public.leaderboard TO authenticated;
-- Uncomment if your landing page loads leaderboard without login:
-- GRANT SELECT ON public.leaderboard TO anon;

-- ranked_leaderboard: grant if the view exists (created in Supabase outside old repo SQL)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'ranked_leaderboard'
  ) THEN
    GRANT SELECT ON public.ranked_leaderboard TO authenticated;
    -- GRANT SELECT ON public.ranked_leaderboard TO anon;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) bot_analytics — RLS on; no policies for anon/authenticated = deny by default
-- -----------------------------------------------------------------------------
-- Service role (backend) bypasses RLS and can still INSERT/SELECT.

ALTER TABLE public.bot_analytics ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.bot_analytics IS
  'Bot match analytics; RLS enabled — client roles have no policies; use service role from backend.';

-- -----------------------------------------------------------------------------
-- 4) problems.difficulty → integer
-- -----------------------------------------------------------------------------
-- Use the separate migration: 003_problems_difficulty_integer.sql (after verifying
-- all difficulty values are numeric — see the header in that file).

-- =============================================================================
-- Optional: ranked_leaderboard definition (only if the view does NOT exist yet)
-- =============================================================================
/*
CREATE OR REPLACE VIEW public.ranked_leaderboard
WITH (security_invoker = true) AS
SELECT
  username,
  current_rating,
  ranked_wins,
  ranked_matches,
  rank_tier,
  global_rank
FROM public.profiles
WHERE COALESCE(is_bot, false) = false
  AND ranked_matches >= 1
ORDER BY current_rating DESC NULLS LAST, ranked_wins DESC NULLS LAST
LIMIT 500;

GRANT SELECT ON public.ranked_leaderboard TO authenticated;
*/
