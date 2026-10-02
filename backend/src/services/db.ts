import { createClient } from "@supabase/supabase-js";
import { config } from "../config";

/**
 * Supabase with the service role key, for the tables only the backend may
 * touch (migration 013). Players never get this key.
 */
export const db = createClient(config.supabase.url, config.supabase.serviceRoleKey || config.supabase.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * A table or function the database does not have: migration 013 has not run
 * yet. Callers answer "not available yet" instead of failing loudly.
 */
export function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" || // function not found
    error.code === "PGRST205" || // table not found
    error.code === "42P01" || // undefined table
    error.code === "42883" || // undefined function
    error.code === "42703" // undefined column
  );
}

/** Thrown by stores when the migration a feature needs has not been applied */
export class NotAvailableError extends Error {
  constructor(feature: string) {
    super(`${feature} is not available yet`);
    this.name = "NotAvailableError";
  }
}
