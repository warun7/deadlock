import { supabase } from "./supabase";
import { SOCKET_URL } from "./socket";

/**
 * The game server's REST endpoints (leaderboard, results, alerts, admin).
 * Signed-in calls send the Supabase access token, the same one the socket uses.
 */

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, signedIn = true): Promise<T> {
  const headers: Record<string, string> = signedIn ? await authHeader() : {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${SOCKET_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection.", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError((data && (data.error || data.message)) || `Request failed (${res.status})`, res.status, data?.code);
  }
  return data as T;
}

export const apiGet = <T>(path: string, signedIn = true) => request<T>("GET", path, undefined, signedIn);
export const apiPost = <T>(path: string, body: unknown) => request<T>("POST", path, body);
