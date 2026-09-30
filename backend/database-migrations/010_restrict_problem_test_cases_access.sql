-- Migration: Restrict Test Case Access (010)
-- Date: 2026-09-30
-- Description: Removes public read access to problem_test_cases so hidden
-- expected outputs cannot be fetched with the anon key shipped in the frontend.
--
-- The backend reads test cases with the service role key, which bypasses RLS,
-- so gameplay does not need a client policy. The table has no is_hidden column
-- (visibility is decided in ProblemService), so there is no subset of rows that
-- is safe to expose: clients get no access at all. Visible sample tests still
-- reach players through the match_found socket payload.

ALTER TABLE public.problem_test_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Test cases are viewable by everyone" ON public.problem_test_cases;

-- Default deny: no policies for anon/authenticated. Revoke the table grants as
-- well so the data stays private even if RLS is ever disabled on this table.
REVOKE ALL ON public.problem_test_cases FROM PUBLIC, anon, authenticated;
