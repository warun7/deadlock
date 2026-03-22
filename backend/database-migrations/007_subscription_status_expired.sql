-- Add Razorpay `expired` subscription status (see subscription lifecycle docs)

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
      'pending',
      'expired'
    )
  );
