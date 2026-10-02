import { validate as isUuid } from "uuid";
import { db, isMissingSchema } from "./db";

/**
 * Decided ranked, friend and ghost matches, one row each (match_results,
 * migration 013). The share page at /r/<matchId> and its card image read
 * these; voiding a rating change reverses one.
 */

export interface MatchResultRow {
  match_id: string;
  mode: "ranked" | "friend" | "ghost";
  winner_id: string | null;
  loser_id: string | null;
  winner_name: string;
  loser_name: string;
  ghost_side: "winner" | "loser" | null;
  problem_id: string | null;
  problem_title: string | null;
  problem_rating: number | null;
  end_reason: string;
  duration_seconds: number;
  winner_rating_change: number | null;
  loser_rating_change: number | null;
  winner_rating: number | null;
  loser_rating: number | null;
  winner_score: number | null;
  loser_score: number | null;
  voided?: boolean;
  created_at?: string;
}

interface Side {
  name: string;
  rating: number | null;
  change: number | null;
  ghost: boolean;
}

/** What anyone with the link may see: names, problem, time, rating changes */
export interface PublicResult {
  id: string;
  mode: MatchResultRow["mode"];
  winner: Side;
  loser: Side;
  problem: { title: string | null; rating: number | null };
  endReason: string;
  durationSeconds: number;
  score: { winner: number; loser: number } | null;
  at: string;
  voided: boolean;
}

export function toPublic(row: MatchResultRow): PublicResult {
  return {
    id: row.match_id,
    mode: row.mode,
    winner: {
      name: row.winner_name,
      rating: row.voided ? null : row.winner_rating,
      change: row.voided ? null : row.winner_rating_change,
      ghost: row.ghost_side === "winner",
    },
    loser: {
      name: row.loser_name,
      rating: row.voided ? null : row.loser_rating,
      change: row.voided ? null : row.loser_rating_change,
      ghost: row.ghost_side === "loser",
    },
    problem: { title: row.problem_title, rating: row.problem_rating },
    endReason: row.end_reason,
    durationSeconds: row.duration_seconds,
    score: row.winner_score != null && row.loser_score != null ? { winner: row.winner_score, loser: row.loser_score } : null,
    at: row.created_at ?? new Date().toISOString(),
    voided: !!row.voided,
  };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const sideName = (side: Side) => (side.ghost ? `${side.name}'s ghost` : side.name);

/** "Ann beat Ben in 4:12", "Ann's ghost beat Ben", "Ann beat Ben (Ben forfeited)" */
export function resultHeadline(r: PublicResult): string {
  const base = `${sideName(r.winner)} beat ${sideName(r.loser)}`;
  if (r.endReason === "forfeit") return `${base} (${r.loser.name} forfeited)`;
  if (r.endReason === "disconnect") return `${base} (${r.loser.name} dropped out)`;
  return `${base} in ${formatClock(r.durationSeconds)}`;
}

export function resultDescription(r: PublicResult): string {
  const kind = r.mode === "friend" ? "A friend duel" : r.mode === "ghost" ? "A ghost duel" : "A ranked duel";
  const problem = r.problem.rating ? ` on a ${r.problem.rating}-rated problem` : "";
  const parts = [`${kind}${problem} on Deadlock.`];
  if (r.score) parts.push(`Room score ${r.score.winner}:${r.score.loser}.`);
  if (!r.winner.ghost && r.winner.change && r.winner.rating) {
    parts.push(`${r.winner.name} is now rated ${r.winner.rating} (+${r.winner.change}).`);
  }
  parts.push("Same problem, same clock. Think you're faster?");
  return parts.join(" ");
}

export class ResultsService {
  private cache = new Map<string, { row: MatchResultRow | null; at: number }>();
  private static readonly CACHE_MS = 60_000;
  private static readonly CACHE_MAX = 500;

  /** Save a result; true once it can be shared */
  async save(row: MatchResultRow): Promise<boolean> {
    try {
      await this.insert(row);
      this.cache.delete(row.match_id);
      return true;
    } catch (error: any) {
      if (!isMissingSchema(error)) console.error(`⚠️ Could not save the result of match ${row.match_id}:`, error?.message ?? error);
      return false;
    }
  }

  async get(matchId: string): Promise<MatchResultRow | null> {
    if (!isUuid(matchId)) return null;
    const hit = this.cache.get(matchId);
    if (hit && Date.now() - hit.at < ResultsService.CACHE_MS) return hit.row;
    const row = await this.fetch(matchId);
    if (this.cache.size >= ResultsService.CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(matchId, { row, at: Date.now() });
    return row;
  }

  /** Forget a cached result (after voiding it) */
  forget(matchId: string): void {
    this.cache.delete(matchId);
  }

  // ============================================
  // Storage (kept small so tests can stand in for Supabase)
  // ============================================

  async insert(row: MatchResultRow): Promise<void> {
    const { error } = await db.from("match_results").upsert(row, { onConflict: "match_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  async fetch(matchId: string): Promise<MatchResultRow | null> {
    const { data, error } = await db.from("match_results").select("*").eq("match_id", matchId).maybeSingle();
    if (error) {
      if (!isMissingSchema(error)) console.error("⚠️ Could not read a match result:", error.message);
      return null;
    }
    return (data as MatchResultRow | null) ?? null;
  }
}

export const resultsService = new ResultsService();
