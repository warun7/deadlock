import { db, isMissingSchema, NotAvailableError } from "./db";

/**
 * The review page's data (admins only, see src/http/adminRoutes.ts): fair-play
 * flags and reports, the decisions on them, the sign-up funnel. Reads the
 * service-role-only views and functions from migrations 012 and 013.
 */

export type ReviewStatus = "open" | "cleared" | "confirmed";

export interface ReviewFilter {
  status: ReviewStatus | "all";
  /** Only matches with a flag or a report */
  flaggedOnly: boolean;
  limit: number;
}

function fail(error: { code?: string; message?: string }, feature: string): never {
  if (isMissingSchema(error)) throw new NotAvailableError(feature);
  throw new Error(error.message ?? String(error));
}

export class AdminService {
  async integrity(filter: ReviewFilter): Promise<unknown[]> {
    let query = db.from("integrity_review").select("*").order("created_at", { ascending: false }).limit(filter.limit);
    if (filter.status !== "all") query = query.eq("review_status", filter.status);
    if (filter.flaggedOnly) query = query.or("flags.neq.{},reports.gt.0");
    const { data, error } = await query;
    if (error) fail(error, "Fair-play review");
    return data ?? [];
  }

  async players(limit: number): Promise<unknown[]> {
    const { data, error } = await db
      .from("integrity_players")
      .select("*")
      .order("flagged_matches", { ascending: false })
      .order("reports", { ascending: false })
      .limit(limit);
    if (error) fail(error, "Fair-play review");
    return data ?? [];
  }

  async reports(limit: number): Promise<unknown[]> {
    const { data, error } = await db
      .from("player_reports")
      .select("id, match_id, reporter_id, reported_id, reason, note, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail(error, "Reports");
    const rows = data ?? [];
    // Names for both sides in one more query
    const ids = [...new Set(rows.flatMap((r: any) => [r.reporter_id, r.reported_id]))];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await db.from("profiles").select("id, username").in("id", ids);
      for (const p of profiles ?? []) names.set((p as any).id, (p as any).username);
    }
    return rows.map((r: any) => ({ ...r, reporter: names.get(r.reporter_id) ?? null, reported: names.get(r.reported_id) ?? null }));
  }

  /** Clear (false alarm) or confirm (cheated) one player's match; true if it existed */
  async review(matchId: string, playerId: string, status: ReviewStatus, reviewerId: string, note: string | null): Promise<boolean> {
    const { data, error } = await db
      .from("match_integrity")
      .update({ review_status: status, reviewed_at: new Date().toISOString(), reviewed_by: reviewerId, review_note: note })
      .eq("match_id", matchId)
      .eq("player_id", playerId)
      .select("match_id");
    if (error) fail(error, "Fair-play review");
    return (data ?? []).length > 0;
  }

  /** Undo a match's rating change: ok, not_found, already_voided or unrated */
  async voidRating(matchId: string): Promise<string> {
    const { data, error } = await db.rpc("void_match_rating", { p_match_id: matchId });
    if (error) fail(error, "Voiding ratings");
    return String(data);
  }

  async funnel(weeks: number): Promise<unknown[]> {
    const { data, error } = await db.rpc("funnel_report", { p_weeks: weeks });
    if (error) fail(error, "The funnel report");
    return data ?? [];
  }
}

export const adminService = new AdminService();
