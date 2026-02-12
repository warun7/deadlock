import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config";

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey,
);

/**
 * StripeService - Handles all Stripe subscription operations
 *
 * Manages:
 * - Customer creation
 * - Checkout session creation
 * - Customer portal sessions
 * - Webhook event processing
 */
class StripeService {
  private stripe: Stripe | null = null;

  /**
   * Get the Stripe client (lazy initialization)
   * Throws if Stripe is not configured
   */
  private getStripe(): Stripe {
    if (!this.stripe) {
      if (!config.stripe.secretKey) {
        throw new Error(
          "Stripe is not configured. Set STRIPE_SECRET_KEY in your .env file."
        );
      }
      this.stripe = new Stripe(config.stripe.secretKey, {
        apiVersion: "2025-12-18",
      });
    }
    return this.stripe;
  }

  /**
   * Check if Stripe is configured
   */
  isConfigured(): boolean {
    return !!config.stripe.secretKey;
  }

  /**
   * Get or create a Stripe customer for a user
   */
  async getOrCreateCustomer(userId: string, email: string): Promise<string> {
    // Check if user already has a Stripe customer ID
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (profile?.stripe_customer_id) {
      return profile.stripe_customer_id;
    }

    // Create new Stripe customer
    const customer = await this.getStripe().customers.create({
      email,
      metadata: {
        supabase_user_id: userId,
      },
    });

    // Store customer ID in profile
    await supabase
      .from("profiles")
      .update({ stripe_customer_id: customer.id })
      .eq("id", userId);

    console.log(`💳 Created Stripe customer ${customer.id} for user ${userId}`);

    return customer.id;
  }

  /**
   * Create a Stripe Checkout session for subscription
   */
  async createCheckoutSession(
    customerId: string,
    userId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    const session = await this.getStripe().checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: config.stripe.priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: {
          supabase_user_id: userId,
        },
      },
      metadata: {
        supabase_user_id: userId,
      },
    });

    console.log(`🛒 Created checkout session ${session.id} for user ${userId}`);

    return session.url!;
  }

  /**
   * Create a Stripe Customer Portal session (manage subscription)
   */
  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<string> {
    const session = await this.getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return session.url;
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    console.log(`📨 Stripe webhook: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed":
        await this.handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case "customer.subscription.updated":
        await this.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "customer.subscription.deleted":
        await this.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "invoice.payment_failed":
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`   Unhandled event type: ${event.type}`);
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
  ): Stripe.Event {
    return this.getStripe().webhooks.constructEvent(
      payload,
      signature,
      config.stripe.webhookSecret,
    );
  }

  // ============================================
  // Webhook Event Handlers
  // ============================================

  private async handleCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const userId = session.metadata?.supabase_user_id;
    if (!userId) {
      console.error("❌ No user ID in checkout session metadata");
      return;
    }

    const subscriptionId = session.subscription as string;
    const customerId = session.customer as string;

    // Fetch the subscription details
    const subscription =
      await this.getStripe().subscriptions.retrieve(subscriptionId);

    // Create subscription record
    await supabase.from("subscriptions").upsert(
      {
        user_id: userId,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
        status: subscription.status,
        current_period_start: new Date(
          subscription.current_period_start * 1000,
        ).toISOString(),
        current_period_end: new Date(
          subscription.current_period_end * 1000,
        ).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
      },
      { onConflict: "stripe_subscription_id" },
    );

    // Activate premium on profile
    await supabase
      .from("profiles")
      .update({
        is_premium: true,
        premium_expires_at: new Date(
          subscription.current_period_end * 1000,
        ).toISOString(),
        stripe_customer_id: customerId,
      })
      .eq("id", userId);

    console.log(`✅ Premium activated for user ${userId}`);
  }

  private async handleSubscriptionUpdated(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const userId = subscription.metadata?.supabase_user_id;

    // Update subscription record
    await supabase
      .from("subscriptions")
      .update({
        status: subscription.status,
        current_period_start: new Date(
          subscription.current_period_start * 1000,
        ).toISOString(),
        current_period_end: new Date(
          subscription.current_period_end * 1000,
        ).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", subscription.id);

    // Update profile premium status
    const isActive =
      subscription.status === "active" || subscription.status === "trialing";

    if (userId) {
      await supabase
        .from("profiles")
        .update({
          is_premium: isActive,
          premium_expires_at: new Date(
            subscription.current_period_end * 1000,
          ).toISOString(),
        })
        .eq("id", userId);
    } else {
      // Fallback: find user by stripe customer ID
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_subscription_id", subscription.id)
        .single();

      if (sub) {
        await supabase
          .from("profiles")
          .update({
            is_premium: isActive,
            premium_expires_at: new Date(
              subscription.current_period_end * 1000,
            ).toISOString(),
          })
          .eq("id", sub.user_id);
      }
    }

    console.log(
      `📝 Subscription ${subscription.id} updated: ${subscription.status}`,
    );
  }

  private async handleSubscriptionDeleted(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    // Update subscription record
    await supabase
      .from("subscriptions")
      .update({
        status: "canceled",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", subscription.id);

    // Find user and deactivate premium
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", subscription.id)
      .single();

    if (sub) {
      await supabase
        .from("profiles")
        .update({
          is_premium: false,
        })
        .eq("id", sub.user_id);

      console.log(`❌ Premium deactivated for user ${sub.user_id}`);
    }
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = invoice.subscription as string;
    if (!subscriptionId) return;

    // Mark subscription as past_due
    await supabase
      .from("subscriptions")
      .update({
        status: "past_due",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", subscriptionId);

    console.log(`⚠️ Payment failed for subscription ${subscriptionId}`);
  }

  /**
   * Get subscription status for a user
   */
  async getSubscriptionStatus(userId: string): Promise<{
    isPremium: boolean;
    subscription: any | null;
  }> {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_premium, premium_expires_at")
      .eq("id", userId)
      .single();

    if (!profile) {
      return { isPremium: false, subscription: null };
    }

    // Check expiry
    let isPremium = profile.is_premium || false;
    if (isPremium && profile.premium_expires_at) {
      if (new Date(profile.premium_expires_at) < new Date()) {
        // Expired - deactivate
        await supabase
          .from("profiles")
          .update({ is_premium: false })
          .eq("id", userId);
        isPremium = false;
      }
    }

    // Get subscription details
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    return { isPremium, subscription };
  }
}

export const stripeService = new StripeService();
