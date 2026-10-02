import axios from "axios";
import webpush from "web-push";
import { config } from "../config";
import { db, isMissingSchema, NotAvailableError } from "./db";
import { redisService } from "./RedisService";
import { rankedHourWindow } from "./LobbyService";

/**
 * Bring players together: when someone has waited alone in ranked for a
 * little while, and when the daily ranked hour starts, tell the people who
 * asked to hear. Two channels, each off until configured:
 *
 *   Browser push   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (deploy/README.md)
 *   Discord        DISCORD_WEBHOOK_URL, optionally DISCORD_ROLE_ID to ping
 *
 * Alerts are throttled: one "someone is waiting" alert per cooldown at most,
 * and each subscriber hears at most once per subscriber cooldown. Players who
 * already have the app open are skipped; the lobby shows them the queue.
 */

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SubscriberRow {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
}

interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export function isPushSubscription(raw: unknown): raw is PushSubscriptionInput {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  return (
    typeof r.endpoint === "string" &&
    /^https:\/\//.test(r.endpoint) &&
    r.endpoint.length <= 1000 &&
    typeof r.keys?.p256dh === "string" &&
    r.keys.p256dh.length <= 200 &&
    typeof r.keys?.auth === "string" &&
    r.keys.auth.length <= 100
  );
}

export class NotifyService {
  private lastQueueAlertAt = 0;
  private waitTimers = new Map<string, NodeJS.Timeout>();
  private rankedHourTimer: NodeJS.Timeout | null = null;
  private pushReady: boolean;

  constructor(private isOnline: (userId: string) => boolean = () => false) {
    this.pushReady = !!(config.notify.vapidPublicKey && config.notify.vapidPrivateKey);
    if (this.pushReady) {
      try {
        webpush.setVapidDetails(config.notify.vapidSubject, config.notify.vapidPublicKey, config.notify.vapidPrivateKey);
      } catch (error: any) {
        console.error("⚠️ VAPID keys are not usable; browser alerts are off:", error.message);
        this.pushReady = false;
      }
    }
  }

  /** The key browsers subscribe with, or null when push is off */
  publicKey(): string | null {
    return this.pushReady ? config.notify.vapidPublicKey : null;
  }

  get discordReady(): boolean {
    return !!config.notify.discordWebhookUrl;
  }

  // ============================================
  // Triggers
  // ============================================

  /**
   * A player joined ranked and nobody else is there. If they are still alone
   * after a short wait, tell subscribers. stillAlone is checked then.
   */
  playerWaiting(player: { userId: string; username: string; elo: number }, stillAlone: () => boolean): void {
    if (!this.pushReady && !this.discordReady) return;
    if (this.waitTimers.has(player.userId)) return;
    const timer = setTimeout(() => {
      this.waitTimers.delete(player.userId);
      if (!stillAlone()) return;
      void this.queueAlert(player).catch((error) => console.error("⚠️ Queue alert failed:", error?.message ?? error));
    }, config.notify.queueAlertDelayMs);
    timer.unref?.();
    this.waitTimers.set(player.userId, timer);
  }

  /** The player left the queue or was matched */
  playerStoppedWaiting(userId: string): void {
    const timer = this.waitTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.waitTimers.delete(userId);
  }

  private async queueAlert(player: { userId: string; username: string; elo: number }): Promise<void> {
    const now = Date.now();
    if (now - this.lastQueueAlertAt < config.notify.queueAlertCooldownMs) return;
    this.lastQueueAlertAt = now;
    console.log(`📣 ${player.username} is waiting alone in ranked; alerting subscribers`);

    const url = `${config.siteOrigin}/matchmaking`;
    await Promise.all([
      this.pushToSubscribers(
        "queue",
        { title: "Someone is waiting in ranked", body: `${player.username} (${player.elo}) is looking for an opponent. Play now.`, url, tag: "queue" },
        player.userId
      ),
      this.discord(`**${player.username}** (${player.elo}) is waiting for a ranked opponent. ${url}`),
    ]);
  }

  /** Remind subscribers when each day's ranked hour starts (once a day, across restarts) */
  scheduleRankedHour(): void {
    if (this.rankedHourTimer) clearTimeout(this.rankedHourTimer);
    const window = rankedHourWindow();
    if (!window) return;
    const startsIn = window.live ? window.endsAt - Date.now() + 1000 : window.startsAt - Date.now();
    this.rankedHourTimer = setTimeout(async () => {
      try {
        if (!window.live) await this.rankedHourAlert(window.startsAt, window.endsAt);
      } catch (error: any) {
        console.error("⚠️ Ranked hour alert failed:", error?.message ?? error);
      }
      this.scheduleRankedHour();
    }, Math.max(1000, startsIn));
    this.rankedHourTimer.unref?.();
  }

  private async rankedHourAlert(startsAt: number, endsAt: number): Promise<void> {
    if (!this.pushReady && !this.discordReady) return;
    if (!(await redisService.claimOnce(`ranked-hour:${startsAt}`, 12 * 3600))) return;
    const minutes = Math.round((endsAt - startsAt) / 60_000);
    const url = `${config.siteOrigin}/matchmaking`;
    console.log("📣 Ranked hour is starting; alerting subscribers");
    await Promise.all([
      this.pushToSubscribers("ranked_hour", { title: "Ranked hour is on", body: `Everyone queues for the next ${minutes} minutes. Find a match.`, url, tag: "ranked-hour" }),
      this.discord(`Ranked hour starts now and runs for ${minutes} minutes. ${url}`),
    ]);
  }

  stop(): void {
    for (const t of this.waitTimers.values()) clearTimeout(t);
    this.waitTimers.clear();
    if (this.rankedHourTimer) clearTimeout(this.rankedHourTimer);
  }

  // ============================================
  // Channels
  // ============================================

  private async pushToSubscribers(kind: "queue" | "ranked_hour", message: PushMessage, exceptUserId?: string): Promise<number> {
    if (!this.pushReady) return 0;
    const since = new Date(Date.now() - config.notify.subscriberCooldownMs).toISOString();
    let subscribers: SubscriberRow[];
    try {
      subscribers = await this.listSubscribers(kind, kind === "queue" ? since : null);
    } catch (error: any) {
      if (!(error instanceof NotAvailableError)) console.error("⚠️ Could not list push subscribers:", error?.message ?? error);
      return 0;
    }
    const targets = subscribers.filter((s) => s.user_id !== exceptUserId && !this.isOnline(s.user_id));
    if (targets.length === 0) return 0;

    const sent: string[] = [];
    const gone: string[] = [];
    await Promise.all(
      targets.map(async (s) => {
        try {
          await this.sendPush(s, message);
          sent.push(s.endpoint);
        } catch (error: any) {
          // The browser unsubscribed or the subscription expired
          if (error?.statusCode === 404 || error?.statusCode === 410) gone.push(s.endpoint);
          else console.error("⚠️ Push failed:", error?.statusCode ?? "", error?.body ?? error?.message ?? error);
        }
      })
    );
    await this.markSent(sent).catch(() => {});
    if (gone.length) await this.forgetEndpoints(gone).catch(() => {});
    console.log(`📣 Push "${message.tag}": ${sent.length} sent, ${gone.length} expired`);
    return sent.length;
  }

  private async discord(text: string): Promise<void> {
    if (!this.discordReady) return;
    const role = config.notify.discordRoleId;
    try {
      await this.postDiscord({
        content: role ? `<@&${role}> ${text}` : text,
        allowed_mentions: role ? { roles: [role] } : { parse: [] },
      });
    } catch (error: any) {
      console.error("⚠️ Discord alert failed:", error?.response?.status ?? error?.message ?? error);
    }
  }

  // ============================================
  // Subscriptions
  // ============================================

  async subscribe(userId: string, sub: PushSubscriptionInput, prefs: { queueAlerts: boolean; rankedHour: boolean }): Promise<void> {
    const { error } = await db.from("push_subscriptions").upsert(
      {
        endpoint: sub.endpoint,
        user_id: userId,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        queue_alerts: prefs.queueAlerts,
        ranked_hour: prefs.rankedHour,
      },
      { onConflict: "endpoint" }
    );
    if (error) {
      if (isMissingSchema(error)) throw new NotAvailableError("Alerts");
      throw error;
    }
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", userId);
    if (error && !isMissingSchema(error)) throw error;
  }

  // ============================================
  // Storage and delivery (kept small so tests can stand in)
  // ============================================

  async listSubscribers(kind: "queue" | "ranked_hour", notSentSince: string | null): Promise<SubscriberRow[]> {
    let query = db
      .from("push_subscriptions")
      .select("endpoint, user_id, p256dh, auth")
      .eq(kind === "queue" ? "queue_alerts" : "ranked_hour", true)
      .limit(500);
    if (notSentSince) query = query.or(`last_sent_at.is.null,last_sent_at.lt.${notSentSince}`);
    const { data, error } = await query;
    if (error) {
      if (isMissingSchema(error)) throw new NotAvailableError("Alerts");
      throw error;
    }
    return (data ?? []) as SubscriberRow[];
  }

  async markSent(endpoints: string[]): Promise<void> {
    if (endpoints.length === 0) return;
    await db.from("push_subscriptions").update({ last_sent_at: new Date().toISOString() }).in("endpoint", endpoints);
  }

  async forgetEndpoints(endpoints: string[]): Promise<void> {
    await db.from("push_subscriptions").delete().in("endpoint", endpoints);
  }

  async sendPush(s: SubscriberRow, message: PushMessage): Promise<void> {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(message), {
      TTL: 15 * 60,
      urgency: "high",
      topic: message.tag,
    });
  }

  async postDiscord(body: Record<string, unknown>): Promise<void> {
    await axios.post(config.notify.discordWebhookUrl, body, { timeout: 5000 });
  }
}
