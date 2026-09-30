-- Migration: Apply rating changes (011)
-- Date: 2026-09-30
--
-- record_match_pair already writes the Elo change on each player's history
-- row (+change for the winner, -change for the loser), but nothing ever moved
-- profiles.rating, so every player stayed at the default forever.
--
-- This trigger applies the change when the history row is written, inside the
-- same transaction, so a match is either recorded and rated or neither.
-- Bot matches are never rated (the backend writes rating_change = 0 for them,
-- and they are skipped here as well). Clients cannot write profiles.rating:
-- migration 006 limits client UPDATEs to username/avatar_url/updated_at.
--
-- Safe to run more than once.

UPDATE public.profiles SET rating = 1000 WHERE rating IS NULL;
ALTER TABLE public.profiles ALTER COLUMN rating SET DEFAULT 1000;
ALTER TABLE public.profiles ALTER COLUMN rating SET NOT NULL;

CREATE OR REPLACE FUNCTION public.apply_match_rating_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.is_bot_match, false) = false AND COALESCE(NEW.rating_change, 0) <> 0 THEN
    UPDATE public.profiles
       SET rating = GREATEST(0, rating + NEW.rating_change),
           updated_at = now()
     WHERE id = NEW.player_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_match_rating_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS apply_match_rating_change ON public.matches;
CREATE TRIGGER apply_match_rating_change
  AFTER INSERT ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_match_rating_change();
