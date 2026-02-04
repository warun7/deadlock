-- ==========================================
-- Migration: Add CASCADE DELETE for User Deletion
-- ==========================================
-- This allows users to be deleted from Supabase Auth without
-- violating foreign key constraints. When a user is deleted,
-- their matches and achievements are automatically deleted too.
-- ==========================================

-- Step 1: Drop existing foreign key constraints
ALTER TABLE matches 
  DROP CONSTRAINT IF EXISTS matches_player_id_fkey;

ALTER TABLE matches 
  DROP CONSTRAINT IF EXISTS matches_opponent_id_fkey;

ALTER TABLE user_achievements 
  DROP CONSTRAINT IF EXISTS user_achievements_user_id_fkey;

-- Step 2: Re-add foreign key constraints WITH CASCADE DELETE
ALTER TABLE matches 
  ADD CONSTRAINT matches_player_id_fkey 
  FOREIGN KEY (player_id) 
  REFERENCES profiles(id) 
  ON DELETE CASCADE;

ALTER TABLE matches 
  ADD CONSTRAINT matches_opponent_id_fkey 
  FOREIGN KEY (opponent_id) 
  REFERENCES profiles(id) 
  ON DELETE CASCADE;

ALTER TABLE user_achievements 
  ADD CONSTRAINT user_achievements_user_id_fkey 
  FOREIGN KEY (user_id) 
  REFERENCES profiles(id) 
  ON DELETE CASCADE;

-- Step 3: Add CASCADE DELETE for profiles -> auth.users
-- This ensures that when auth.users is deleted, profile is deleted too
ALTER TABLE profiles 
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE profiles 
  ADD CONSTRAINT profiles_id_fkey 
  FOREIGN KEY (id) 
  REFERENCES auth.users(id) 
  ON DELETE CASCADE;

-- ==========================================
-- VERIFICATION
-- ==========================================
-- You can verify the constraints with:
-- SELECT 
--   conname AS constraint_name,
--   conrelid::regclass AS table_name,
--   confrelid::regclass AS referenced_table,
--   confdeltype AS delete_action
-- FROM pg_constraint
-- WHERE confdeltype = 'c' -- 'c' means CASCADE
--   AND connamespace = 'public'::regnamespace;
-- ==========================================
-- DELETE ACTION CODES:
-- 'a' = NO ACTION
-- 'r' = RESTRICT  
-- 'c' = CASCADE (what we want!)
-- 'n' = SET NULL
-- 'd' = SET DEFAULT
-- ==========================================

-- DONE! Users can now be deleted from Supabase Dashboard without errors.


