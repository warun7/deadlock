-- Migration: Fair play signals (012)
-- Date: 2026-10-01
--
-- Nothing can prove code came from an AI, so the game collects signals and
-- leaves the judgement to a person. For every ranked match the backend writes
-- one match_integrity row per player (see backend/src/services/IntegrityService.ts):
--
--   paste_blocked / drop_blocked  outside text the editor refused (it only
--                                 pastes from its own clipboard in matches)
--   bulk_blocked                  large inserts that were not typing
--   copy_blocked                  attempts to copy the problem or the page
--   away_count / away_seconds     time with the match tab hidden or unfocused
--   unexplained_chars             submitted code that was never typed or
--                                 pasted from inside the editor
--   keystroke_* / interval_cv     typing rhythm; scripts type evenly
--   flags                         which of the rules below fired
--
-- Flags (thresholds live in IntegrityService.FLAG_RULES):
--   paste_attempt   a blocked outside paste of 50+ characters
--   copy_attempt    tried to copy the problem
--   left_tab        away 60 s or more and at least a quarter of the match
--   code_not_typed  150+ submitted characters that were never typed
--   robotic_typing  150+ keystrokes with near-constant or inhumanly fast rhythm
--   fast_solve      solved in under 5 minutes, problem rated 300+ above the player
--
-- Players can also report an opponent after a ranked match (player_reports).
-- Nothing here changes ratings automatically.
--
-- Both tables are written by the backend with the service role key. Clients
-- get no access at all: these rows describe other players.
--
-- Review:
--   select * from integrity_review where array_length(flags, 1) > 0 or reports > 0;
--   select * from integrity_players order by flagged_matches desc, reports desc;
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.match_integrity (
  match_id               uuid        NOT NULL,
  player_id              uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  opponent_id            uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  mode                   text        NOT NULL,
  problem_id             text,
  problem_rating         integer,
  player_rating          integer,
  won                    boolean,                 -- null for a draw
  end_reason             text        NOT NULL,
  duration_seconds       integer     NOT NULL,
  submissions            integer     NOT NULL DEFAULT 0,
  paste_blocked          integer     NOT NULL DEFAULT 0,
  paste_blocked_max_chars integer    NOT NULL DEFAULT 0,
  drop_blocked           integer     NOT NULL DEFAULT 0,
  bulk_blocked           integer     NOT NULL DEFAULT 0,
  copy_blocked           integer     NOT NULL DEFAULT 0,
  away_count             integer     NOT NULL DEFAULT 0,
  away_seconds           integer     NOT NULL DEFAULT 0,
  typed_chars            integer,
  pasted_chars           integer,
  code_chars             integer,
  unexplained_chars      integer,
  keystroke_intervals    integer,
  interval_mean_ms       real,
  interval_cv            real,
  flags                  text[]      NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_integrity_player ON public.match_integrity (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_integrity_flagged ON public.match_integrity (created_at DESC)
  WHERE array_length(flags, 1) > 0;

CREATE TABLE IF NOT EXISTS public.player_reports (
  id          bigserial   PRIMARY KEY,
  match_id    uuid        NOT NULL,
  reporter_id uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reported_id uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reason      text        NOT NULL CHECK (reason IN ('outside_help', 'other')),
  note        text        CHECK (char_length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_player_reports_reported ON public.player_reports (reported_id, created_at DESC);

-- Service role only
ALTER TABLE public.match_integrity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_integrity FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.player_reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.player_reports_id_seq FROM PUBLIC, anon, authenticated;

-- One row per player per ranked match, newest first, with names and reports.
-- security_invoker: the view checks the caller's rights, so it cannot be used
-- to read the tables above through the public API.
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
  mi.player_id
FROM public.match_integrity mi
LEFT JOIN public.profiles p ON p.id = mi.player_id
LEFT JOIN public.profiles o ON o.id = mi.opponent_id
ORDER BY mi.created_at DESC;

-- Per player: how often their ranked matches raise flags, and reports against them
CREATE OR REPLACE VIEW public.integrity_players
WITH (security_invoker = on) AS
SELECT
  p.username AS player,
  mi.player_id,
  count(*) AS ranked_matches,
  count(*) FILTER (WHERE array_length(mi.flags, 1) > 0) AS flagged_matches,
  count(*) FILTER (WHERE 'paste_attempt'  = ANY (mi.flags)) AS paste_attempt,
  count(*) FILTER (WHERE 'copy_attempt'   = ANY (mi.flags)) AS copy_attempt,
  count(*) FILTER (WHERE 'left_tab'       = ANY (mi.flags)) AS left_tab,
  count(*) FILTER (WHERE 'code_not_typed' = ANY (mi.flags)) AS code_not_typed,
  count(*) FILTER (WHERE 'robotic_typing' = ANY (mi.flags)) AS robotic_typing,
  count(*) FILTER (WHERE 'fast_solve'     = ANY (mi.flags)) AS fast_solve,
  (SELECT count(*) FROM public.player_reports r WHERE r.reported_id = mi.player_id) AS reports,
  max(mi.created_at) AS last_match_at
FROM public.match_integrity mi
LEFT JOIN public.profiles p ON p.id = mi.player_id
GROUP BY p.username, mi.player_id;

REVOKE ALL ON public.integrity_review FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integrity_players FROM PUBLIC, anon, authenticated;
