-- 008: mark which problems plain string comparison can actually judge.
--
-- WHY
-- ---
-- Every row in `problems` carries checker_type = 'exact', meaning the judge
-- compares the player's output against one stored expected string. That is only
-- valid for problems with exactly ONE correct output.
--
-- A large minority of Codeforces problems accept several correct answers
-- ("print any such string", "output the points in any order", probability
-- answers accepted within 1e-9). For those, a completely correct solution is
-- marked WRONG ANSWER. In a 1v1 battle that is the most trust-destroying bug
-- the product can have: the player is told they are wrong when they are right,
-- and they have no way to tell the difference from a real mistake.
--
-- Writing ~200 bespoke checkers is out of scope, so instead we mark those
-- problems and keep them out of matchmaking. `scripts/classify_problems.py`
-- decides the flag by running the accepted solutions that ship with the
-- CodeContests dataset against the imported test cases:
--
--   a known-accepted solution passes every test  -> exact match is sound
--   every known-accepted solution disagrees      -> multiple valid answers
--
-- Only the first group is served to players.

-- DEFAULT false is deliberate: it is the conservative direction. Problems that
-- have no imported test cases at all are never classified by the sweep, and a
-- "safe" default would leave them in the matchmaking pool where the judge used
-- to fall back to a single blank input/blank output pair -- which every
-- submission passes. Opting in is the only way a problem reaches players.
ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS judge_safe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.problems.judge_safe IS
  'True only when exact-match judging was verified sound for this problem '
  '(a known-accepted solution passes every imported test case). Problems with '
  'multiple valid answers are false and excluded from matchmaking.';

-- Matchmaking filters on this, so it needs an index. Partial, because the
-- pool we query is the true rows and they are the minority of the table
-- only if most problems are unsafe -- cheap either way.
CREATE INDEX IF NOT EXISTS idx_problems_judge_safe
  ON public.problems (judge_safe)
  WHERE judge_safe = true;

-- Verification: fail loudly rather than silently shipping a column that
-- defaults every problem to "safe" (which would defeat the whole point).
DO $$
DECLARE
  total integer;
  safe  integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE judge_safe) INTO total, safe
  FROM public.problems;

  RAISE NOTICE 'problems: % total, % judge_safe, % excluded',
    total, safe, total - safe;

  IF total > 0 AND safe = 0 THEN
    RAISE WARNING
      'no problem is judge_safe yet: run scripts/classify_problems.py --apply';
  END IF;
END $$;
