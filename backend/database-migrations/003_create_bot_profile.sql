-- Create a bot profile for bot matches
-- This allows bot matches to be saved without foreign key constraint errors

-- Insert bot user with fixed UUID
INSERT INTO profiles (id, username, elo, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'BOT_PLAYER',
  1000,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Note: This is a placeholder profile for all bot matches
-- The actual bot names (like "LoopLegend_44") are stored in match records
