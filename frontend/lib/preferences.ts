import { supabase } from "./supabase";

/**
 * The language a player codes in, remembered for every match. Kept in this
 * browser for an instant default, and in the account (Supabase user
 * metadata) so it follows the player to other devices.
 */

export const LANGUAGES = ["python", "javascript", "cpp"] as const;
export type PreferredLanguage = (typeof LANGUAGES)[number];

const KEY = "deadlock:language";

export const isLanguage = (value: unknown): value is PreferredLanguage =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

/** This browser's choice, then the account's, else null */
export function preferredLanguage(userMetadata?: Record<string, unknown> | null): PreferredLanguage | null {
  try {
    const local = localStorage.getItem(KEY);
    if (isLanguage(local)) return local;
  } catch {
    /* storage blocked */
  }
  const remote = userMetadata?.preferred_language;
  return isLanguage(remote) ? remote : null;
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** Remember a choice; the account copy is written a moment later, once */
export function rememberLanguage(lang: PreferredLanguage, userMetadata?: Record<string, unknown> | null) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage blocked: the account copy still works */
  }
  if (userMetadata?.preferred_language === lang) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    supabase.auth.updateUser({ data: { preferred_language: lang } }).catch(() => {
      /* offline or signed out: this browser still remembers */
    });
  }, 1500);
}
