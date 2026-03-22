-- =============================================================================
-- Optional second step: problems.difficulty text → integer
-- =============================================================================
-- Run in Supabase SQL Editor AFTER 002_supabase_security_and_problem_rating.sql
-- and only if every non-null difficulty is numeric (your export was 800–3500).
--
-- Verify first:
--   SELECT difficulty, count(*) FROM public.problems
--   WHERE difficulty !~ '^\s*[0-9]+\s*$' OR difficulty IS NULL
--   GROUP BY 1;
-- (Should return 0 rows before you run this.)
-- =============================================================================

ALTER TABLE public.problems
  ALTER COLUMN difficulty TYPE integer
  USING (trim(difficulty)::integer);

ALTER TABLE public.problems
  ALTER COLUMN difficulty SET NOT NULL;

ALTER TABLE public.problems
  ADD CONSTRAINT problems_difficulty_rating_range
  CHECK (difficulty >= 0 AND difficulty <= 5000);

CREATE INDEX IF NOT EXISTS idx_problems_difficulty
  ON public.problems (difficulty);

COMMENT ON COLUMN public.problems.difficulty IS
  'Codeforces-style problem rating (integer).';
