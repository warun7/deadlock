import { apiGet, apiPost } from "./http";
import { track } from "./analytics";

/**
 * Browser alerts: a push when someone is waiting in ranked, and when the daily
 * ranked hour starts. The server sends them (NotifyService); this asks the
 * browser for permission and registers the subscription.
 */

export interface AlertsConfig {
  pushPublicKey: string | null;
  discord: boolean;
}

export type AlertsState = "unsupported" | "unavailable" | "blocked" | "off" | "on";

let configPromise: Promise<AlertsConfig> | null = null;

export function alertsConfig(): Promise<AlertsConfig> {
  configPromise ??= apiGet<AlertsConfig>("/notifications/config", false).catch(() => {
    configPromise = null;
    return { pushPublicKey: null, discord: false };
  });
  return configPromise;
}

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** Where this browser stands right now */
export async function alertsState(): Promise<AlertsState> {
  if (!pushSupported()) return "unsupported";
  const config = await alertsConfig();
  if (!config.pushPublicKey) return "unavailable";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Ask for permission, subscribe, and tell the server. Resolves to the new state. */
export async function enableAlerts(): Promise<AlertsState> {
  const config = await alertsConfig();
  if (!pushSupported() || !config.pushPublicKey) return "unavailable";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.pushPublicKey) }));
  await apiPost("/notifications/subscribe", { subscription: sub.toJSON(), queueAlerts: true, rankedHour: true });
  track("notify_on");
  return "on";
}

export async function disableAlerts(): Promise<AlertsState> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await apiPost("/notifications/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  return "off";
}
