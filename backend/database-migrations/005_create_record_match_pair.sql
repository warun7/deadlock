-- Migration: Create transactional match-pair recording function
-- Date: 2026-04-04
-- Description: Inserts both player-perspective match rows in one transaction

CREATE OR REPLACE FUNCTION public.record_match_pair(
  p_winner_id uuid,
  p_loser_id uuid,
  p_problem_id text,
  p_problem_title text,
  p_language text,
  p_duration_seconds integer,
  p_rating_change integer,
  p_completed_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.matches (
    player_id,
    opponent_id,
    problem_id,
    problem_title,
    language,
    result,
    rating_change,
    duration_seconds,
    completed_at
  )
  VALUES
    (
      p_winner_id,
      p_loser_id,
      p_problem_id,
      p_problem_title,
      p_language,
      'won',
      p_rating_change,
      p_duration_seconds,
      p_completed_at
    ),
    (
      p_loser_id,
      p_winner_id,
      p_problem_id,
      p_problem_title,
      p_language,
      'lost',
      -p_rating_change,
      p_duration_seconds,
      p_completed_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_match_pair(
  uuid,
  uuid,
  text,
  text,
  text,
  integer,
  integer,
  timestamptz
) TO authenticated, service_role;
