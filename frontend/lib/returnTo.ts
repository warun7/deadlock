/*
  Where to go after signing in. Kept in localStorage, not the URL, so it
  survives the Google OAuth round trip and an email confirmation opened in a
  new tab. Used by invite links: open a duel room signed out, sign up, land
  back in the room.
*/

const KEY = "deadlock:return-to";
const MAX_AGE_MS = 60 * 60 * 1000;

export function rememberReturnTo(path: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    /* storage blocked: sign-in falls back to the lobby */
  }
}

/** The remembered in-app path, or null if there is none, it is stale, or it is not local */
export function returnToPath(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return null;
    if (typeof at !== "number" || Date.now() - at > MAX_AGE_MS) return null;
    return path;
  } catch {
    return null;
  }
}

/** Forget it once the visitor has arrived */
export function clearReturnTo() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
