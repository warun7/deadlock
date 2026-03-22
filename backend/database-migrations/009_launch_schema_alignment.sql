-- Launch alignment: enforce the DB contract expected by the app before production launch.
-- Safe to re-run; most statements are idempotent or guarded.

-- =============================================================================
-- 1) problems.difficulty must be an integer rating
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.problems
    WHERE difficulty IS NULL
       OR trim(difficulty::text) !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION
      'public.problems.difficulty contains NULL or non-numeric values; fix data before running 009_launch_schema_alignment.sql';
  END IF;
END $$;

ALTER TABLE public.problems
  ALTER COLUMN difficulty TYPE integer
  USING trim(difficulty::text)::integer;

ALTER TABLE public.problems
  ALTER COLUMN difficulty SET NOT NULL;

ALTER TABLE public.problems
  DROP CONSTRAINT IF EXISTS problems_difficulty_rating_range;

ALTER TABLE public.problems
  ADD CONSTRAINT problems_difficulty_rating_range
  CHECK (difficulty >= 0 AND difficulty <= 5000);

CREATE INDEX IF NOT EXISTS idx_problems_difficulty
  ON public.problems (difficulty);

COMMENT ON COLUMN public.problems.difficulty IS
  'Codeforces-style problem rating (integer).';

-- =============================================================================
-- 2) subscriptions / profiles must support Razorpay alongside legacy Stripe data
-- =============================================================================

ALTER TABLE public.subscriptions
  ALTER COLUMN stripe_subscription_id DROP NOT NULL;

ALTER TABLE public.subscriptions
  ALTER COLUMN stripe_customer_id DROP NOT NULL;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';

UPDATE public.subscriptions
SET provider = 'stripe'
WHERE provider IS NULL OR provider = '';

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_stripe_subscription_id_key;

DROP INDEX IF EXISTS public.subscriptions_stripe_subscription_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_unique
  ON public.subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_razorpay_subscription_id_unique
  ON public.subscriptions (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay_sub_id
  ON public.subscriptions (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider
  ON public.subscriptions (provider);

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check CHECK (
    status IN (
      'active',
      'canceled',
      'past_due',
      'incomplete',
      'trialing',
      'created',
      'authenticated',
      'halted',
      'paused',
      'completed',
      'pending',
      'expired'
    )
  );

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT;

COMMENT ON COLUMN public.profiles.razorpay_customer_id IS
  'Razorpay customer id for subscription billing';
COMMENT ON COLUMN public.subscriptions.razorpay_subscription_id IS
  'Razorpay subscription id';
COMMENT ON COLUMN public.subscriptions.razorpay_customer_id IS
  'Razorpay customer id';
COMMENT ON COLUMN public.subscriptions.provider IS
  'Billing provider: stripe | razorpay';

-- =============================================================================
-- 3) Security: clients must not be able to forge matches or query hidden tests
-- =============================================================================

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problem_test_cases ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'matches'
      AND cmd = 'INSERT'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.matches',
      policy_record.policyname
    );
  END LOOP;

  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'problem_test_cases'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.problem_test_cases',
      policy_record.policyname
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.problem_test_cases IS
  'Problem test cases including hidden judge data. Client roles should not have SELECT access.';

-- =============================================================================
-- 4) Views used by the frontend should query with security_invoker
-- =============================================================================

DO $$
DECLARE
  view_name text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY[
    'human_matches',
    'leaderboard',
    'ranked_leaderboard',
    'recent_matches_detailed'
  ]::text[]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_views
      WHERE schemaname = 'public'
        AND viewname = view_name
    ) THEN
      EXECUTE format(
        'ALTER VIEW public.%I SET (security_invoker = true)',
        view_name
      );
    END IF;
  END LOOP;
END $$;
