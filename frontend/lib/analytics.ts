import { supabase } from "./supabase";
import { SOCKET_URL } from "./socket";

/**
 * First-party funnel analytics (backend/src/services/AnalyticsService.ts):
 * invite link -> sign-up -> first match -> second match. A random id kept in
 * this browser ties visits before sign-up to the account they became. No
 * third parties, nothing about what you type.
 *
 * Events are batched and sent every few seconds, and when the page hides.
 */

export type ClientEvent =
  | "landing_view"
  | "invite_view"
  | "signup_view"
  | "signup_submit"
  | "signup_confirm_sent"
  | "identify"
  | "room_created"
  | "invite_copied"
  | "queue_join"
  | "leaderboard_view"
  | "result_view"
  | "result_shared"
  | "notify_on";

const ANON_KEY = "deadlock:anon-id";
const IDENTIFIED_KEY = "deadlock:identified";
const FLUSH_MS = 4000;

let queue: { event: ClientEvent; props?: Record<string, string | number | boolean>; path: string }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function anonId(): string {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return "anon_unavailable";
  }
}

export function track(event: ClientEvent, props?: Record<string, string | number | boolean>) {
  queue.push({ event, props, path: window.location.pathname });
  if (queue.length >= 20) {
    void flush();
    return;
  }
  if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
}

/** Once per account in this browser: link the anonymous id to the account */
export function identify(userId: string) {
  try {
    if (localStorage.getItem(IDENTIFIED_KEY) === userId) return;
    localStorage.setItem(IDENTIFIED_KEY, userId);
  } catch {
    /* storage blocked: identify every visit, which is harmless */
  }
  track("identify");
}

async function flush(useBeacon = false) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const events = queue.splice(0, 20);
  const body = JSON.stringify({ anonId: anonId(), events });
  try {
    // identify needs the account; everything else is fine without it
    const needsAuth = events.some((e) => e.event === "identify");
    if (useBeacon && !needsAuth && navigator.sendBeacon) {
      navigator.sendBeacon(`${SOCKET_URL}/events`, new Blob([body], { type: "text/plain" }));
    } else {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (needsAuth) {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
      }
      await fetch(`${SOCKET_URL}/events`, { method: "POST", headers, body, keepalive: true });
    }
  } catch {
    /* analytics never gets in the way */
  }
  if (queue.length) void flush(useBeacon);
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
}
