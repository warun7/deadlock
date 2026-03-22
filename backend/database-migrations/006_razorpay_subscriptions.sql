-- Migration: Razorpay subscriptions (alongside optional legacy Stripe rows)
-- Run in Supabase SQL Editor after 005_ranked_mode_and_subscriptions.sql

-- Allow Razorpay-only rows without Stripe IDs
ALTER TABLE public.subscriptions
  ALTER COLUMN stripe_subscription_id DROP NOT NULL;

ALTER TABLE public.subscriptions
  ALTER COLUMN stripe_customer_id DROP NOT NULL;

-- Replace single UNIQUE on stripe_subscription_id with partial unique (multiple NULLs OK)
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_stripe_subscription_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_unique
  ON public.subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_razorpay_subscription_id_unique
  ON public.subscriptions (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';

UPDATE public.subscriptions
SET provider = 'stripe'
WHERE provider IS NULL OR provider = '';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT;

COMMENT ON COLUMN public.profiles.razorpay_customer_id IS 'Razorpay customer id for subscription billing';

COMMENT ON COLUMN public.subscriptions.razorpay_subscription_id IS 'Razorpay subscription id';
COMMENT ON COLUMN public.subscriptions.razorpay_customer_id IS 'Razorpay customer id';
COMMENT ON COLUMN public.subscriptions.provider IS 'Billing provider: stripe | razorpay';

-- Widen status values for Razorpay lifecycle
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;

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
      'pending'
    )
  );

CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay_sub_id
  ON public.subscriptions (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider
  ON public.subscriptions (provider);
