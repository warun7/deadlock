import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config";

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey,
);

type RazorpaySubscriptionEntity = {
  id: string;
  entity?: string;
  plan_id?: string;
  customer_id?: string;
  status: string;
  current_start?: number;
  current_end?: number;
  charge_at?: number;
  end_at?: number;
  notes?: Record<string, string>;
};

function toIso(ts?: number): string | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  return new Date(ts * 1000).toISOString();
}

function mapRazorpayStatus(
  status: string,
):
  | "active"
  | "canceled"
  | "past_due"
  | "incomplete"
  | "trialing"
  | "halted"
  | "paused"
  | "completed"
  | "pending"
  | "authenticated"
  | "created"
  | "expired" {
  const s = (status || "").toLowerCase();
  switch (s) {
    case "active":
      return "active";
    case "cancelled":
    case "canceled":
      return "canceled";
    case "halted":
      return "halted";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "pending":
      return "pending";
    case "authenticated":
      return "authenticated";
    case "created":
      return "created";
    case "expired":
      return "expired";
    default:
      return "incomplete";
  }
}

function extractSubscriptionEntity(payload: Record<string, unknown>): RazorpaySubscriptionEntity | null {
  const subWrap = payload?.payload as Record<string, unknown> | undefined;
  if (!subWrap?.subscription) return null;
  const inner = subWrap.subscription as Record<string, unknown>;
  const entity = (inner.entity || inner) as RazorpaySubscriptionEntity;
  if (entity?.id && entity?.status) return entity;
  return null;
}

function userIdFromSubscription(sub: RazorpaySubscriptionEntity): string | null {
  const notes = sub.notes || {};
  const id = notes.supabase_user_id || notes.supabaseUserId;
  return id && typeof id === "string" ? id : null;
}

/**
 * Razorpay subscriptions + webhooks → profiles.is_premium / premium_expires_at
 */
class RazorpayService {
  private client: Razorpay | null = null;

  private getClient(): Razorpay {
    if (!this.client) {
      if (!config.razorpay.keyId || !config.razorpay.keySecret) {
        throw new Error(
          "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
        );
      }
      this.client = new Razorpay({
        key_id: config.razorpay.keyId,
        key_secret: config.razorpay.keySecret,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return !!(config.razorpay.keyId && config.razorpay.keySecret);
  }

  /**
   * Create subscription using only documented Create Subscription fields
   * (plan_id, total_count, quantity, customer_notify, notes). Customer id is
   * synced from webhook/API responses, not sent here.
   */
  async createPremiumSubscription(userId: string): Promise<{
    shortUrl: string;
    subscriptionId: string;
  }> {
    if (!config.razorpay.planId) {
      throw new Error("RAZORPAY_PLAN_ID is not set (create a Plan in Razorpay Dashboard).");
    }

    const subscription = (await this.getClient().subscriptions.create({
      plan_id: config.razorpay.planId,
      customer_notify: 1,
      quantity: 1,
      // Razorpay caps total_count based on plan interval; 1200 covers 100 years for monthly plans.
      total_count: 1200,
      notes: {
        supabase_user_id: userId,
      },
    })) as {
      id: string;
      short_url?: string | null;
    };

    const shortUrl = subscription.short_url;
    if (!shortUrl) {
      throw new Error("Razorpay did not return short_url — check plan & account activation.");
    }

    return { shortUrl, subscriptionId: subscription.id };
  }

  /**
   * Mandatory post-authorization check: HMAC(razorpay_payment_id + "|" + razorpay_subscription_id).
   * Uses API key secret (same as Razorpay Node `validatePaymentVerification`).
   */
  async verifySubscriptionPayment(
    userId: string,
    paymentId: string,
    subscriptionId: string,
    signature: string,
  ): Promise<{ subscriptionStatus: string; premiumActivated: boolean }> {
    const payload = `${paymentId}|${subscriptionId}`;
    const valid = Razorpay.validateWebhookSignature(
      payload,
      signature,
      config.razorpay.keySecret,
    );
    if (!valid) {
      throw new Error("Invalid subscription payment signature");
    }

    const fetched = (await this.getClient().subscriptions.fetch(
      subscriptionId,
    )) as unknown as RazorpaySubscriptionEntity;

    const owner = userIdFromSubscription(fetched);
    if (!owner || owner !== userId) {
      throw new Error("Subscription does not belong to this user");
    }

    await this.upsertSubscriptionRow(userId, fetched, mapRazorpayStatus(fetched.status));

    const premiumActivated = await this.setPremiumFromSubscription(userId, fetched);

    return {
      subscriptionStatus: fetched.status,
      premiumActivated,
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
    const secret = config.razorpay.webhookSecret;
    if (!secret || !signature) return false;
    try {
      return Razorpay.validateWebhookSignature(rawBody, signature, secret);
    } catch {
      return false;
    }
  }

  async handleWebhookEvent(rawBody: string, parsed: Record<string, unknown>): Promise<void> {
    const eventName = parsed.event as string;
    console.log(`📨 Razorpay webhook: ${eventName}`);

    const sub = extractSubscriptionEntity(parsed);
    if (!sub) {
      console.log("   (no subscription entity in payload, skipping)");
      return;
    }

    const userId = userIdFromSubscription(sub);
    if (!userId) {
      console.error("❌ Razorpay webhook: missing notes.supabase_user_id on subscription", sub.id);
      return;
    }

    switch (eventName) {
      case "subscription.pending":
        await this.upsertSubscriptionRow(userId, sub, mapRazorpayStatus(sub.status));
        break;
      case "subscription.authenticated":
        await this.upsertSubscriptionRow(userId, sub, mapRazorpayStatus(sub.status));
        break;
      case "subscription.activated":
      case "subscription.charged":
      case "subscription.resumed":
        await this.upsertSubscriptionRow(userId, sub, mapRazorpayStatus(sub.status));
        await this.setPremiumFromSubscription(userId, sub);
        break;
      case "subscription.updated":
        await this.upsertSubscriptionRow(userId, sub, mapRazorpayStatus(sub.status));
        if (sub.status === "active") {
          await this.setPremiumFromSubscription(userId, sub);
        }
        break;
      case "subscription.halted":
      case "subscription.cancelled":
      case "subscription.completed":
      case "subscription.expired":
        await this.handlePremiumEnded(userId, sub, eventName);
        break;
      case "subscription.paused":
        await this.upsertSubscriptionRow(userId, sub, "paused");
        await supabase
          .from("profiles")
          .update({ is_premium: false })
          .eq("id", userId);
        break;
      default:
        console.log(`   Unhandled event: ${eventName}`);
    }
  }

  private async upsertSubscriptionRow(
    userId: string,
    sub: RazorpaySubscriptionEntity,
    status: ReturnType<typeof mapRazorpayStatus>,
  ): Promise<void> {
    const row = {
      user_id: userId,
      razorpay_subscription_id: sub.id,
      razorpay_customer_id: sub.customer_id || null,
      provider: "razorpay",
      status,
      current_period_start: toIso(sub.current_start),
      current_period_end: toIso(sub.current_end ?? sub.charge_at),
      cancel_at_period_end: false,
      stripe_subscription_id: null,
      stripe_customer_id: null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("subscriptions").upsert(row, {
      onConflict: "razorpay_subscription_id",
    });

    if (error) {
      console.error("❌ subscriptions upsert error:", error);
    }
  }

  /**
   * Grant premium only in paid `active` state (not `authenticated` / `created`).
   * Returns whether premium was applied.
   */
  private async setPremiumFromSubscription(
    userId: string,
    sub: RazorpaySubscriptionEntity,
  ): Promise<boolean> {
    if (sub.status !== "active") {
      console.log(`ℹ️ Skipping premium grant (subscription status=${sub.status})`);
      return false;
    }

    const endTs = sub.current_end ?? sub.charge_at;
    const premiumExpiresAt =
      toIso(endTs) || new Date(Date.now() + 35 * 24 * 3600 * 1000).toISOString();

    await supabase
      .from("profiles")
      .update({
        is_premium: true,
        premium_expires_at: premiumExpiresAt,
      })
      .eq("id", userId);

    console.log(`✅ Premium active for ${userId} until ${premiumExpiresAt}`);
    return true;
  }

  private async handlePremiumEnded(
    userId: string,
    sub: RazorpaySubscriptionEntity,
    eventName: string,
  ): Promise<void> {
    await this.upsertSubscriptionRow(userId, sub, mapRazorpayStatus(sub.status));

    await supabase
      .from("profiles")
      .update({
        is_premium: false,
        premium_expires_at: new Date().toISOString(),
      })
      .eq("id", userId);

    console.log(`❌ Premium ended for ${userId} (${eventName})`);
  }

  /**
   * Cancel at end of current billing cycle (Razorpay native behavior).
   */
  async cancelSubscriptionAtPeriodEnd(userId: string): Promise<void> {
    const { data: row, error } = await supabase
      .from("subscriptions")
      .select("razorpay_subscription_id")
      .eq("user_id", userId)
      .eq("provider", "razorpay")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !row?.razorpay_subscription_id) {
      throw new Error("No Razorpay subscription found for this user.");
    }

    await this.getClient().subscriptions.cancel(
      row.razorpay_subscription_id,
      true,
    );

    await supabase
      .from("subscriptions")
      .update({
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      })
      .eq("razorpay_subscription_id", row.razorpay_subscription_id);
  }

  async getSubscriptionStatus(userId: string): Promise<{
    isPremium: boolean;
    subscription: Record<string, unknown> | null;
  }> {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_premium, premium_expires_at")
      .eq("id", userId)
      .single();

    if (!profile) {
      return { isPremium: false, subscription: null };
    }

    let isPremium = profile.is_premium || false;
    if (isPremium && profile.premium_expires_at) {
      if (new Date(profile.premium_expires_at) < new Date()) {
        await supabase.from("profiles").update({ is_premium: false }).eq("id", userId);
        isPremium = false;
      }
    }

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "razorpay")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return { isPremium, subscription: subscription as Record<string, unknown> | null };
  }
}

export const razorpayService = new RazorpayService();
