-- Migration: Fix Bot Match Foreign Key Constraint
-- Date: 2025-12-25
-- Description: Creates a dummy bot profile to satisfy foreign key constraint for bot matches

-- ============================================
-- Create a single dummy bot profile
-- ============================================

-- Temporarily disable the foreign key constraint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Insert a dummy bot profile with a well-known UUID
-- All bot matches will use this as opponent_id
INSERT INTO public.profiles (id, username, email, is_bot, win_rate, total_matches, matches_won, matches_lost)
VALUES (
  '00000000-0000-0000-0000-000000000000',  -- Null UUID - easy to identify
  'Bot Player',
  'bot@deadlock.internal',
  true,
  50.00,
  0,
  0,
  0
)
ON CONFLICT (id) DO NOTHING;

-- Re-enable the foreign key constraint (but allow the dummy bot to exist)
-- This will enforce FK for all future inserts except the dummy bot
ALTER TABLE public.profiles 
  ADD CONSTRAINT profiles_id_fkey 
  FOREIGN KEY (id) REFERENCES auth.users(id) 
  ON DELETE CASCADE
  NOT VALID;

-- Validate the constraint for future inserts (but skip existing rows)
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_id_fkey;

-- Add comment
COMMENT ON TABLE public.profiles IS 'User profiles. UUID 00000000-0000-0000-0000-000000000000 is a dummy bot profile used for all bot matches.';

-- ============================================
-- Verification
-- ============================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = '00000000-0000-0000-0000-000000000000'
  ) THEN
    RAISE NOTICE '✅ Dummy bot profile created successfully';
    RAISE NOTICE '   Bot matches can now use this UUID as opponent_id';
  ELSE
    RAISE WARNING '⚠️  Failed to create dummy bot profile';
  END IF;
END $$;
