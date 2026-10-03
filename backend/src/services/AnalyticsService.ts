import { db, isMissingSchema } from "./db";
import type { MatchState } from "../types";

/**
 * First-party product analytics: invite link -> sign-up -> first match ->
 * second match (funnel_report in migration 013). No third parties, no IP
 * addresses. Browsers send a random id they keep themselves (anon_id) so a
 * visit before sign-up can be tied to the account it became.
 *
 * Events are buffered and written in small batches; analytics never slows a
 * request or a match down, and losing a batch only costs numbers.
 */

/** What browsers may send. Anything else is dropped. */
export const CLIENT_EVENTS = new Set([
  "landing_view",
  "invite_view", // props.code
  "signup_view",
  "signup_submit",
  "signup_confirm_sent",
  "identify", // links anon_id to the signed-in user
  "room_created",
  "invite_copied",
  "queue_join", // props.mode
  "leaderboard_view",
  "result_view",
  "result_shared",
  "notify_on",
]);

/** Written by the server itself */
export type ServerEvent = "match_start" | "match_end";

export interface AnalyticsEvent {
  event: string;
  anon_id?: string | null;
  user_id?: string | null;
  props?: Record<string, unknown>;
  path?: string | null;
  at?: string;
}

const FLUSH_MS = 5000;
const MAX_BUFFER = 500;

export class AnalyticsService {
  private buffer: AnalyticsEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private disabled = false;

  track(event: AnalyticsEvent): void {
    if (this.disabled) return;
    if (this.buffer.length >= MAX_BUFFER) this.buffer.shift();
    this.buffer.push({ ...event, at: event.at ?? new Date().toISOString() });
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, FLUSH_MS);
      this.timer.unref?.();
    }
  }

  /** A match ended: one event per person in it (bots and ghosts are not people) */
  matchEnded(match: MatchState, winnerId: string | null): void {
    for (const player of [match.player1, match.player2]) {
      if (player.socketId === "bot" || player.socketId === "ghost") continue;
      this.track({
        event: "match_end",
        user_id: player.id,
        props: { mode: match.mode, result: winnerId === null ? "draw" : winnerId === player.id ? "won" : "lost" },
      });
    }
  }

  matchStarted(match: MatchState): void {
    for (const player of [match.player1, match.player2]) {
      if (player.socketId === "bot" || player.socketId === "ghost") continue;
      this.track({ event: "match_start", user_id: player.id, props: { mode: match.mode } });
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      await this.persist(batch);
    } catch (error: any) {
      if (isMissingSchema(error)) {
        // Migration 013 not applied: stop collecting until the next restart
        this.disabled = true;
        console.warn("ℹ️  analytics_events is missing (migration 013); analytics is off");
        return;
      }
      console.error(`⚠️ Lost ${batch.length} analytics events:`, error?.message ?? error);
    }
  }

  /** Kept small so tests can stand in for Supabase */
  async persist(rows: AnalyticsEvent[]): Promise<void> {
    const { error } = await db.from("analytics_events").insert(
      rows.map((r) => ({
        event: r.event,
        anon_id: r.anon_id ?? null,
        user_id: r.user_id ?? null,
        props: r.props ?? {},
        path: r.path ?? null,
        at: r.at,
      }))
    );
    if (error) throw error;
  }
}

/** Clean one event from a browser, or null to drop it */
export function cleanClientEvent(raw: unknown): { event: string; props: Record<string, unknown>; path: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { event?: unknown; props?: unknown; path?: unknown };
  if (typeof r.event !== "string" || !CLIENT_EVENTS.has(r.event)) return null;
  const props: Record<string, unknown> = {};
  if (r.props && typeof r.props === "object" && !Array.isArray(r.props)) {
    // Flat, short, scalar values only
    for (const [k, v] of Object.entries(r.props as Record<string, unknown>).slice(0, 10)) {
      if (k.length > 30) continue;
      if (typeof v === "string") props[k] = v.slice(0, 120);
      else if (typeof v === "number" && Number.isFinite(v)) props[k] = v;
      else if (typeof v === "boolean") props[k] = v;
    }
  }
  // The path without its query string, which can carry tokens
  const path = typeof r.path === "string" && r.path.startsWith("/") ? r.path.split(/[?#]/)[0].slice(0, 200) : null;
  return { event: r.event, props, path };
}

export const analyticsService = new AnalyticsService();
