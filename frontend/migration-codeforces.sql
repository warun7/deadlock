-- ==========================================
-- MIGRATION: Add CodeForces Support
-- ==========================================
-- This migration adds support for importing CodeForces problems
-- with their rich metadata and test cases
-- ==========================================

-- Add metadata column to problems table (stores JSON with CF data)
ALTER TABLE problems ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add time and memory limits (important for code execution)
ALTER TABLE problems ADD COLUMN IF NOT EXISTS time_limit_seconds DECIMAL(5,2) DEFAULT 2.0;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS memory_limit_mb INTEGER DEFAULT 256;

-- Add contest information
ALTER TABLE problems ADD COLUMN IF NOT EXISTS contest_id TEXT;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS contest_name TEXT;

-- Add rating (difficulty score)
ALTER TABLE problems ADD COLUMN IF NOT EXISTS rating INTEGER; -- 800-3500 for CF

-- Add tags for better filtering
ALTER TABLE problems ADD COLUMN IF NOT EXISTS tags TEXT[]; -- Array of tags

-- Add editorial support
ALTER TABLE problems ADD COLUMN IF NOT EXISTS editorial TEXT;

-- Update problem_id to handle CodeForces IDs
ALTER TABLE problems ALTER COLUMN problem_id TYPE TEXT;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_problems_metadata ON problems USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_problems_rating ON problems(rating);
CREATE INDEX IF NOT EXISTS idx_problems_tags ON problems USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_problems_contest_id ON problems(contest_id);

-- Add is_visible flag (to hide problems during testing/import)
ALTER TABLE problems ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true;

-- Update test cases table to support hidden tests
ALTER TABLE problem_test_cases ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;
ALTER TABLE problem_test_cases ADD COLUMN IF NOT EXISTS test_type TEXT DEFAULT 'official'; -- 'official' or 'generated'

-- Add checker support for problems with multiple correct answers
ALTER TABLE problems ADD COLUMN IF NOT EXISTS has_custom_checker BOOLEAN DEFAULT false;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS checker_code TEXT; -- Python checker code

-- Create index on problem_test_cases for faster lookups
CREATE INDEX IF NOT EXISTS idx_test_cases_problem_id_type ON problem_test_cases(problem_id, test_type);

-- ==========================================
-- HELPER FUNCTIONS
-- ==========================================

-- Function to get random problem by difficulty
CREATE OR REPLACE FUNCTION get_random_problem_by_difficulty(
    target_difficulty TEXT DEFAULT NULL,
    min_rating INTEGER DEFAULT NULL,
    max_rating INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER,
    problem_id TEXT,
    title TEXT,
    description TEXT,
    difficulty TEXT,
    rating INTEGER,
    time_limit_seconds DECIMAL,
    memory_limit_mb INTEGER,
    tags TEXT[],
    has_custom_checker BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.problem_id,
        p.title,
        p.description,
        p.difficulty,
        p.rating,
        p.time_limit_seconds,
        p.memory_limit_mb,
        p.tags,
        p.has_custom_checker
    FROM problems p
    WHERE 
        p.is_visible = true
        AND (target_difficulty IS NULL OR p.difficulty = target_difficulty)
        AND (min_rating IS NULL OR p.rating >= min_rating)
        AND (max_rating IS NULL OR p.rating <= max_rating)
    ORDER BY RANDOM()
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- VIEWS
-- ==========================================

-- View for problems with test case counts
CREATE OR REPLACE VIEW problems_with_stats AS
SELECT 
    p.*,
    COUNT(tc.id) as total_test_cases,
    COUNT(CASE WHEN tc.is_hidden = false THEN 1 END) as visible_test_cases,
    COUNT(CASE WHEN tc.is_hidden = true THEN 1 END) as hidden_test_cases
FROM problems p
LEFT JOIN problem_test_cases tc ON p.id = tc.problem_id
GROUP BY p.id;

-- Grant access to authenticated users
GRANT SELECT ON problems_with_stats TO authenticated;
GRANT EXECUTE ON FUNCTION get_random_problem_by_difficulty TO authenticated;

-- ==========================================
-- DATA MIGRATION
-- ==========================================

-- Update existing problems to have default metadata
UPDATE problems 
SET 
    metadata = jsonb_build_object(
        'source', 'manual',
        'imported_at', NOW()
    )
WHERE metadata IS NULL;

-- ==========================================
-- DONE!
-- ==========================================
-- Next steps:
-- 1. Run this migration in Supabase SQL Editor
-- 2. Run the import_codeforces.py script
-- 3. Verify problems are imported correctly
-- ==========================================

