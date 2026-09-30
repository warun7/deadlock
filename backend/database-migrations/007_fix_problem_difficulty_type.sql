-- ============================================
-- Migration 007: fix problems.difficulty type
-- ============================================
-- PROBLEM
--   `problems.difficulty` was TEXT, but ProblemService filters it numerically:
--
--     .lte('difficulty', options?.maxRating || 1200)
--     .gte('difficulty', options.minRating)
--
--   On a TEXT column PostgREST compares LEXICOGRAPHICALLY. So "900" > "1200"
--   and "800" > "1200", because '9' and '8' both sort after '1'. The result:
--
--     eligible before: 287 of 1608  (only difficulty 1000 / 1100 / 1200)
--     eligible after:  589 of 1608  (800 … 1200)
--
--   In other words every genuinely EASY problem was unreachable, which is the
--   worst possible failure for onboarding: a brand-new player could only ever
--   be given problems rated 1000-1200.
--
-- VERIFIED BEFORE WRITING
--   All 1608 rows hold numeric strings (0 nulls, 0 non-numeric). The cast is
--   therefore lossless. The regexp+NULLIF form is used anyway so this migration
--   cannot fail on unexpected data — a non-numeric value becomes NULL (and is
--   simply excluded from numeric filters) rather than aborting the migration.
--
-- SAFETY
--   Every consumer treats difficulty as either a filter or a display value:
--     - PostgREST filters  -> now correct numeric comparison
--     - parseInt(difficulty) -> unchanged behaviour
--     - rendered in JSX    -> a number renders identically to its string form
-- ============================================

ALTER TABLE public.problems
  ALTER COLUMN difficulty TYPE integer
  USING NULLIF(regexp_replace(difficulty, '[^0-9]', '', 'g'), '')::integer;

-- The difficulty range is the hot filter for matchmaking problem selection.
CREATE INDEX IF NOT EXISTS idx_problems_difficulty
  ON public.problems (difficulty);

COMMENT ON COLUMN public.problems.difficulty IS
  'Codeforces problem rating as an integer (800-3500). Was TEXT, which made range filters compare lexicographically and hid every problem rated below 1000.';

-- Verification: report the eligible pool for the default matchmaking cap.
DO $$
DECLARE
  total integer;
  eligible integer;
BEGIN
  SELECT count(*) INTO total FROM public.problems;
  SELECT count(*) INTO eligible FROM public.problems WHERE difficulty <= 1200;
  RAISE NOTICE 'problems total: %, eligible at <=1200: %', total, eligible;

  IF eligible < 400 THEN
    RAISE WARNING 'eligible pool looks too small — check that the column is integer, not text';
  END IF;
END $$;
