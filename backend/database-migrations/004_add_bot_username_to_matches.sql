-- Migration: Add bot_username column to matches table
-- Date: 2025-02-04
-- Description: Store the actual bot username (like "LoopLegend_44") instead of just "Bot Player"

-- Add bot_username column to matches table
ALTER TABLE public.matches 
  ADD COLUMN IF NOT EXISTS bot_username TEXT;

-- Add comment
COMMENT ON COLUMN public.matches.bot_username IS 'The display name of the bot opponent (e.g. LoopLegend_44) for bot matches';

-- Verification
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'matches' AND column_name = 'bot_username'
  ) THEN
    RAISE NOTICE '✅ bot_username column added to matches table';
  ELSE
    RAISE WARNING '⚠️  Failed to add bot_username column';
  END IF;
END $$;
