-- =============================================================================
-- Random problem by numeric rating band (server-side ORDER BY random LIMIT 1)
-- =============================================================================
-- Apply after problems.difficulty is numeric (see 003_problems_difficulty_integer.sql).
-- Backend calls this via Supabase RPC; if missing, ProblemService falls back to a
-- client-side numeric filter (still correct when difficulty is text like '1200').
-- =============================================================================

CREATE OR REPLACE FUNCTION public.random_problem_id_in_rating_band(
  p_min integer,
  p_max integer
)
RETURNS bigint
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.problems p
  WHERE (
    CASE
      WHEN pg_typeof(p.difficulty) = 'integer'::regtype THEN p.difficulty::integer
      WHEN trim(p.difficulty::text) ~ '^[0-9]+$' THEN trim(p.difficulty::text)::integer
      ELSE NULL
    END
  ) BETWEEN p_min AND p_max
  ORDER BY random()
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.random_problem_id_in_rating_band(integer, integer) IS
  'Pick one random problem id whose difficulty parses as an integer in [p_min, p_max].';

GRANT EXECUTE ON FUNCTION public.random_problem_id_in_rating_band(integer, integer) TO service_role;
