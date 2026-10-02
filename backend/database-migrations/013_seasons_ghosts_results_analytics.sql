-- Migration: Leaderboard and seasons, ghost duels, share cards, fair-play
-- review, funnel analytics and notifications (013)
-- Date: 2026-10-02
--
-- Everything the game server needs for this release. The backend keeps
-- working before this runs (matches are still recorded and rated); the new
-- features answer "not available yet" until it has.
--
--   1. Match history rows carry the game server's match id (game_id), and
--      record_match_pair is callable by the backend only.
--   2. match_results: one row per decided ranked, friend or ghost match.
--      Share cards read it; voiding a rating change reverses it.
--   3. ghost_recordings: a ranked winner's solve (when each submission
--      landed, how many tests it passed, and the final code), raced later in
--      ghost duels. record_ghost_match writes the racer's history row.
--   4. Seasons: the leaderboard ranks the current season; start_new_season
--      saves the final standings and pulls every rating halfway back to 1000.
--   5. Fair-play review: a reviewer clears or confirms each flagged match;
--      void_match_rating undoes a match's rating change.
--   6. analytics_events + funnel_report: invite link -> sign-up -> first
--      match -> second match, first party, no IP addresses.
--   7. push_subscriptions: browsers that asked to hear when someone queues.
--
-- Clients get no direct access to any of it: the backend reads and writes
-- with the service role key and serves what players may see.
--
-- Supabase grants EXECUTE on new functions in public to anon and
-- authenticated by default, so every function below revokes those grants
-- explicitly. record_match_pair had only revoked PUBLIC, which left those
-- grants in place: anyone with the public anon key could record matches and
-- move ratings. Recreating it here closes that.
--
-- Safe to run more than once.

-- ============================================
-- 1. Match history linked to the live match
-- ============================================

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'ranked';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_matches_mode') THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT chk_matches_mode CHECK (mode IN ('ranked', 'ghost'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matches_player_problem ON public.matches (player_id, problem_id);

DROP FUNCTION IF EXISTS public.record_match_pair(
  uuid, uuid, text, integer, text, text, integer, integer, boolean, text, text, timestamptz
);

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
  p_completed_at timestamptz DEFAULT now(),
  p_game_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_id uuid;
BEGIN
  INSERT INTO public.game_sessions (id, problem_id_ref, duration_seconds, completed_at)
  VALUES (COALESCE(p_game_id, uuid_generate_v4()), p_problem_id_ref, p_duration_seconds, p_completed_at)
  RETURNING id INTO v_game_id;

  INSERT INTO public.matches (game_id, player_id, opponent_id, problem_id, problem_id_ref, problem_title, language, result, rating_change, duration_seconds, is_bot_match, bot_difficulty, bot_username, completed_at)
  VALUES
    (v_game_id, p_winner_id, p_loser_id, p_problem_id, p_problem_id_ref, p_problem_title, p_language, 'won', p_rating_change, p_duration_seconds, p_is_bot_match, p_bot_difficulty, p_bot_username, p_completed_at),
    (v_game_id, p_loser_id, p_winner_id, p_problem_id, p_problem_id_ref, p_problem_title, p_language, 'lost', -p_rating_change, p_duration_seconds, p_is_bot_match, p_bot_difficulty, p_bot_username, p_completed_at);
END;
$$;

REVOKE ALL ON FUNCTION public.record_match_pair(
  uuid, uuid, text, integer, text, text, integer, integer, boolean, text, text, timestamptz, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_match_pair(
  uuid, uuid, text, integer, text, text, integer, integer, boolean, text, text, timestamptz, uuid
) TO service_role;

-- A ghost duel: one history row, the racer's. The ghost's real player is the
-- opponent but gets no row, so their rating and record never move. The
-- database triggers rate the racer as for any match.
CREATE OR REPLACE FUNCTION public.record_ghost_match(
  p_game_id uuid,
  p_player_id uuid,
  p_ghost_player_id uuid,
  p_ghost_name text,
  p_won boolean,
  p_problem_id text,
  p_problem_id_ref integer,
  p_problem_title text,
  p_language text,
  p_duration_seconds integer,
  p_rating_change integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.game_sessions (id, problem_id_ref, duration_seconds, completed_at)
  VALUES (p_game_id, p_problem_id_ref, p_duration_seconds, now());

  INSERT INTO public.matches (game_id, player_id, opponent_id, problem_id, problem_id_ref, problem_title, language, result, rating_change, duration_seconds, is_bot_match, bot_username, mode, completed_at)
  VALUES (p_game_id, p_player_id, p_ghost_player_id, p_problem_id, p_problem_id_ref, p_problem_title, p_language,
          CASE WHEN p_won THEN 'won' ELSE 'lost' END, p_rating_change, p_duration_seconds, false, p_ghost_name, 'ghost', now());
END;
$$;

REVOKE ALL ON FUNCTION public.record_ghost_match(
  uuid, uuid, uuid, text, boolean, text, integer, text, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ghost_match(
  uuid, uuid, uuid, text, boolean, text, integer, text, text, integer, integer
) TO service_role;

-- ============================================
-- 2. Results (share cards, voiding)
-- ============================================

CREATE TABLE IF NOT EXISTS public.match_results (
  match_id             uuid        PRIMARY KEY,
  mode                 text        NOT NULL CHECK (mode IN ('ranked', 'friend', 'ghost')),
  winner_id            uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  loser_id             uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  winner_name          text        NOT NULL,
  loser_name           text        NOT NULL,
  -- Ghost duels: which side was the recording
  ghost_side           text        CHECK (ghost_side IN ('winner', 'loser')),
  problem_id           text,
  problem_title        text,
  problem_rating       integer,
  end_reason           text        NOT NULL,
  duration_seconds     integer     NOT NULL,
  -- Signed rating changes the database applied (null: unrated or not recorded)
  winner_rating_change integer,
  loser_rating_change  integer,
  winner_rating        integer,
  loser_rating         integer,
  -- Friend duels: rounds won in the room, this one included
  winner_score         integer,
  loser_score          integer,
  voided               boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_results_winner ON public.match_results (winner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_results_loser ON public.match_results (loser_id, created_at DESC);

-- ============================================
-- 3. Ghost recordings
-- ============================================

CREATE TABLE IF NOT EXISTS public.ghost_recordings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid        NOT NULL,
  player_id      uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  username       text        NOT NULL,
  player_rating  integer     NOT NULL,
  problem_id     text        NOT NULL,
  problem_rating integer,
  language       text        NOT NULL,
  language_id    integer     NOT NULL,
  solve_ms       integer     NOT NULL CHECK (solve_ms > 0),
  -- [{ "t": ms after the start, "passed": n, "total": n, "status": "wrong_answer" }, ...]
  timeline       jsonb       NOT NULL,
  code           text        NOT NULL CHECK (char_length(code) <= 100000),
  races          integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_ghost_recordings_rating ON public.ghost_recordings (player_rating);

-- ============================================
-- 4. Fair-play review
-- ============================================

ALTER TABLE public.match_integrity
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS reviewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by   uuid,
  ADD COLUMN IF NOT EXISTS review_note   text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_match_integrity_review_status') THEN
    ALTER TABLE public.match_integrity
      ADD CONSTRAINT chk_match_integrity_review_status CHECK (review_status IN ('open', 'cleared', 'confirmed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_match_integrity_review_note') THEN
    ALTER TABLE public.match_integrity
      ADD CONSTRAINT chk_match_integrity_review_note CHECK (char_length(review_note) <= 500);
  END IF;
END $$;

-- Integrity review now names the review and the match's rating change
CREATE OR REPLACE VIEW public.integrity_review
WITH (security_invoker = on) AS
SELECT
  mi.created_at,
  p.username  AS player,
  o.username  AS opponent,
  mi.flags,
  (SELECT count(*) FROM public.player_reports r
    WHERE r.match_id = mi.match_id AND r.reported_id = mi.player_id) AS reports,
  mi.won,
  mi.end_reason,
  mi.duration_seconds,
  mi.problem_rating,
  mi.player_rating,
  mi.paste_blocked,
  mi.paste_blocked_max_chars,
  mi.copy_blocked,
  mi.away_count,
  mi.away_seconds,
  mi.unexplained_chars,
  mi.keystroke_intervals,
  mi.interval_mean_ms,
  mi.interval_cv,
  mi.match_id,
  mi.player_id,
  mi.review_status,
  mi.reviewed_at,
  mi.review_note,
  mi.mode,
  mi.opponent_id,
  mi.typed_chars,
  mi.pasted_chars,
  mi.code_chars,
  mi.submissions,
  (SELECT CASE WHEN mr.winner_id = mi.player_id THEN mr.winner_rating_change ELSE mr.loser_rating_change END
     FROM public.match_results mr WHERE mr.match_id = mi.match_id) AS rating_change,
  (SELECT mr.voided FROM public.match_results mr WHERE mr.match_id = mi.match_id) AS rating_voided
FROM public.match_integrity mi
LEFT JOIN public.profiles p ON p.id = mi.player_id
LEFT JOIN public.profiles o ON o.id = mi.opponent_id
ORDER BY mi.created_at DESC;

REVOKE ALL ON public.integrity_review FROM PUBLIC, anon, authenticated;

-- Players under review: a confirmed match, or an open one with the two
-- strongest signals. Left out of the leaderboard and of ghost duels until a
-- person has looked.
CREATE OR REPLACE FUNCTION public.players_under_review()
RETURNS TABLE (player_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT mi.player_id
  FROM public.match_integrity mi
  WHERE mi.review_status = 'confirmed'
     OR (mi.review_status = 'open' AND mi.flags && ARRAY['code_not_typed', 'robotic_typing']::text[]);
$$;

REVOKE ALL ON FUNCTION public.players_under_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.players_under_review() TO service_role;

-- Undo a match's rating change: the reverse of what was applied, for every
-- player who moved. History rows stay (marked 0) so the record still shows
-- the game. Returns ok, not_found, already_voided or unrated.
CREATE OR REPLACE FUNCTION public.void_match_rating(p_match_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.match_results;
BEGIN
  SELECT * INTO r FROM public.match_results WHERE match_id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF r.voided THEN
    RETURN 'already_voided';
  END IF;
  IF COALESCE(r.winner_rating_change, 0) = 0 AND COALESCE(r.loser_rating_change, 0) = 0 THEN
    RETURN 'unrated';
  END IF;

  IF COALESCE(r.winner_rating_change, 0) <> 0 AND r.winner_id IS NOT NULL THEN
    UPDATE public.profiles SET rating = GREATEST(0, rating - r.winner_rating_change), updated_at = now()
     WHERE id = r.winner_id;
  END IF;
  IF COALESCE(r.loser_rating_change, 0) <> 0 AND r.loser_id IS NOT NULL THEN
    UPDATE public.profiles SET rating = GREATEST(0, rating - r.loser_rating_change), updated_at = now()
     WHERE id = r.loser_id;
  END IF;

  UPDATE public.matches SET rating_change = 0 WHERE game_id = p_match_id;
  UPDATE public.match_results SET voided = true WHERE match_id = p_match_id;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.void_match_rating(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_match_rating(uuid) TO service_role;

-- ============================================
-- 5. Ghost duel pick
-- ============================================

-- A recording to race: someone else's solve, of a problem this player has
-- never had in a rated match, from a player not under review, as close to
-- their rating as there is. Counts the race.
CREATE OR REPLACE FUNCTION public.pick_ghost(p_player_id uuid, p_rating integer, p_exclude_problems text[] DEFAULT '{}')
RETURNS SETOF public.ghost_recordings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT g.id INTO v_id
  FROM public.ghost_recordings g
  WHERE g.player_id <> p_player_id
    AND NOT (g.problem_id = ANY (COALESCE(p_exclude_problems, '{}')))
    AND NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.player_id = p_player_id AND m.problem_id = g.problem_id)
    AND g.player_id NOT IN (SELECT u.player_id FROM public.players_under_review() u)
    AND NOT EXISTS (
      SELECT 1 FROM public.match_integrity mi
      WHERE mi.match_id = g.match_id AND mi.player_id = g.player_id
        AND mi.review_status <> 'cleared'
        AND mi.flags && ARRAY['code_not_typed', 'robotic_typing', 'paste_attempt']::text[]
    )
  ORDER BY abs(g.player_rating - p_rating) / 100, random()
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.ghost_recordings SET races = races + 1 WHERE id = v_id RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.pick_ghost(uuid, integer, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_ghost(uuid, integer, text[]) TO service_role;

-- ============================================
-- 6. Seasons and the leaderboard
-- ============================================

CREATE TABLE IF NOT EXISTS public.seasons (
  id        serial      PRIMARY KEY,
  name      text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at   timestamptz
);

-- One season open at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_one_open ON public.seasons ((true)) WHERE ends_at IS NULL;

-- Season 1 covers every rated match so far
INSERT INTO public.seasons (name, starts_at)
SELECT 'Season 1',
       COALESCE((SELECT min(completed_at) FROM public.matches WHERE COALESCE(is_bot_match, false) = false), now())
WHERE NOT EXISTS (SELECT 1 FROM public.seasons);

CREATE TABLE IF NOT EXISTS public.season_standings (
  season_id integer NOT NULL REFERENCES public.seasons (id) ON DELETE CASCADE,
  player_id uuid    NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  rank      integer NOT NULL,
  username  text    NOT NULL,
  rating    integer NOT NULL,
  matches   integer NOT NULL,
  wins      integer NOT NULL,
  PRIMARY KEY (season_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_season_standings_rank ON public.season_standings (season_id, rank);

-- The open season's standings: everyone with a rated match in it, by
-- rating, players under review left out.
CREATE OR REPLACE FUNCTION public.season_leaderboard(p_limit integer DEFAULT 100)
RETURNS TABLE (
  rank bigint,
  player_id uuid,
  username text,
  avatar_url text,
  rating integer,
  season_matches bigint,
  season_wins bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT starts_at FROM public.seasons WHERE ends_at IS NULL ORDER BY starts_at DESC LIMIT 1
  ),
  played AS (
    SELECT m.player_id, count(*) AS n, count(*) FILTER (WHERE m.result = 'won') AS w
    FROM public.matches m, s
    WHERE m.completed_at >= s.starts_at AND COALESCE(m.is_bot_match, false) = false
    GROUP BY m.player_id
  )
  SELECT rank() OVER (ORDER BY p.rating DESC, played.w DESC, p.username),
         p.id, p.username, p.avatar_url, p.rating, played.n, played.w
  FROM played
  JOIN public.profiles p ON p.id = played.player_id
  WHERE COALESCE(p.is_bot, false) = false
    AND p.id NOT IN (SELECT u.player_id FROM public.players_under_review() u)
  ORDER BY p.rating DESC, played.w DESC, p.username
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.season_leaderboard(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.season_leaderboard(integer) TO service_role;

-- Close the open season and start the next. The final standings are saved,
-- then every rating moves halfway back to 1000 (p_reset 0.5): a 1600 starts
-- the new season at 1300, an 800 at 900. Returns the new season's id.
CREATE OR REPLACE FUNCTION public.start_new_season(p_name text, p_reset numeric DEFAULT 0.5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current integer;
  v_new integer;
BEGIN
  IF p_reset < 0 OR p_reset > 1 THEN
    RAISE EXCEPTION 'p_reset must be between 0 and 1';
  END IF;

  SELECT id INTO v_current FROM public.seasons WHERE ends_at IS NULL FOR UPDATE;
  IF v_current IS NOT NULL THEN
    INSERT INTO public.season_standings (season_id, player_id, rank, username, rating, matches, wins)
    SELECT v_current, l.player_id, l.rank, l.username, l.rating, l.season_matches, l.season_wins
    FROM public.season_leaderboard(1000000) l
    ON CONFLICT DO NOTHING;
    UPDATE public.seasons SET ends_at = now() WHERE id = v_current;
  END IF;

  UPDATE public.profiles
     SET rating = round(1000 + (rating - 1000) * p_reset)::integer, updated_at = now()
   WHERE COALESCE(is_bot, false) = false;

  INSERT INTO public.seasons (name, starts_at) VALUES (p_name, now()) RETURNING id INTO v_new;
  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.start_new_season(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_new_season(text, numeric) TO service_role;

-- ============================================
-- 7. Funnel analytics
-- ============================================

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id      bigserial   PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  event   text        NOT NULL CHECK (char_length(event) <= 40),
  -- Random id kept in the visitor's browser; links visits before sign-up to the account
  anon_id text        CHECK (char_length(anon_id) <= 64),
  user_id uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  props   jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(props) <= 2048),
  path    text        CHECK (char_length(path) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON public.analytics_events (event, at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_anon ON public.analytics_events (anon_id) WHERE anon_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON public.analytics_events (user_id, event) WHERE user_id IS NOT NULL;

-- Weekly cohorts by sign-up week: how many signed up (and how many of those
-- came from an invite link), and how many went on to finish one and two
-- matches of any kind. Invite visitors are counted in the week of their first
-- visit.
CREATE OR REPLACE FUNCTION public.funnel_report(p_weeks integer DEFAULT 8)
RETURNS TABLE (
  week date,
  invite_visitors bigint,
  signups bigint,
  signups_from_invites bigint,
  played_one bigint,
  played_two bigint,
  invite_played_one bigint,
  invite_played_two bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH weeks AS (
    SELECT generate_series(
      date_trunc('week', now()) - make_interval(weeks => GREATEST(1, LEAST(p_weeks, 52)) - 1),
      date_trunc('week', now()),
      interval '1 week'
    ) AS w
  ),
  invite_visits AS (
    SELECT anon_id, min(at) AS first_at
    FROM public.analytics_events
    WHERE event = 'invite_view' AND anon_id IS NOT NULL
    GROUP BY anon_id
  ),
  links AS (
    SELECT DISTINCT anon_id, user_id
    FROM public.analytics_events
    WHERE event = 'identify' AND anon_id IS NOT NULL AND user_id IS NOT NULL
  ),
  cohort AS (
    SELECT
      u.id,
      u.created_at,
      (
        (u.raw_user_meta_data ->> 'signup_source') = 'invite'
        OR EXISTS (
          SELECT 1 FROM links l JOIN invite_visits v ON v.anon_id = l.anon_id
          WHERE l.user_id = u.id AND v.first_at <= u.created_at + interval '1 hour'
        )
      ) AS from_invite,
      GREATEST(
        (SELECT count(*) FROM public.analytics_events e WHERE e.user_id = u.id AND e.event = 'match_end'),
        (SELECT count(*) FROM public.matches m WHERE m.player_id = u.id)
      ) AS finished
    FROM auth.users u
    WHERE u.created_at >= (SELECT min(w) FROM weeks)
  )
  SELECT
    weeks.w::date,
    (SELECT count(*) FROM invite_visits v WHERE v.first_at >= weeks.w AND v.first_at < weeks.w + interval '1 week'),
    count(c.id),
    count(c.id) FILTER (WHERE c.from_invite),
    count(c.id) FILTER (WHERE c.finished >= 1),
    count(c.id) FILTER (WHERE c.finished >= 2),
    count(c.id) FILTER (WHERE c.from_invite AND c.finished >= 1),
    count(c.id) FILTER (WHERE c.from_invite AND c.finished >= 2)
  FROM weeks
  LEFT JOIN cohort c ON c.created_at >= weeks.w AND c.created_at < weeks.w + interval '1 week'
  GROUP BY weeks.w
  ORDER BY weeks.w DESC;
$$;

REVOKE ALL ON FUNCTION public.funnel_report(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.funnel_report(integer) TO service_role;

-- ============================================
-- 8. Notifications
-- ============================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  endpoint     text        PRIMARY KEY CHECK (char_length(endpoint) <= 1000),
  user_id      uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  p256dh       text        NOT NULL CHECK (char_length(p256dh) <= 200),
  auth         text        NOT NULL CHECK (char_length(auth) <= 100),
  -- Someone is waiting in ranked
  queue_alerts boolean     NOT NULL DEFAULT true,
  -- The daily ranked hour is starting
  ranked_hour  boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions (user_id);

-- ============================================
-- Service role only
-- ============================================

ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghost_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.match_results FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ghost_recordings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seasons FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.season_standings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.analytics_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.seasons_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.analytics_events_id_seq FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.match_results, public.ghost_recordings, public.seasons, public.season_standings,
  public.analytics_events, public.push_subscriptions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.seasons_id_seq, public.analytics_events_id_seq TO service_role;
