import { db, isMissingSchema, NotAvailableError } from "./db";

/**
 * The leaderboard: the open season ranked by rating (season_leaderboard in
 * migration 013, which leaves out players under fair-play review), and the
 * final standings of past seasons.
 */

export interface Season {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string | null;
}

export interface BoardRow {
  rank: number;
  playerId: string;
  username: string;
  avatarUrl: string | null;
  rating: number;
  matches: number;
  wins: number;
}

export interface Board {
  season: Season & { current: boolean };
  seasons: Season[];
  players: Omit<BoardRow, "playerId">[];
  total: number;
  you: Omit<BoardRow, "playerId" | "avatarUrl"> | null;
}

const TOP = 100;
const CACHE_MS = 30_000;

export class LeaderboardService {
  private cache = new Map<string, { at: number; seasons: Season[]; rows: BoardRow[] }>();

  async board(seasonId: number | null, viewerId: string | null): Promise<Board | null> {
    const key = seasonId === null ? "current" : String(seasonId);
    let entry = this.cache.get(key);
    if (!entry || Date.now() - entry.at > CACHE_MS) {
      const seasons = await this.fetchSeasons();
      const current = seasons.find((s) => s.endsAt === null) ?? null;
      const target = seasonId === null ? current : seasons.find((s) => s.id === seasonId) ?? null;
      if (!target) return null;
      const rows = target.endsAt === null ? await this.fetchBoard(1000) : await this.fetchStandings(target.id);
      entry = { at: Date.now(), seasons, rows };
      this.cache.set(key, entry);
      if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!);
    }
    const seasons = entry.seasons;
    const target = seasonId === null ? seasons.find((s) => s.endsAt === null)! : seasons.find((s) => s.id === seasonId)!;
    const mine = viewerId ? entry.rows.find((r) => r.playerId === viewerId) : undefined;
    return {
      season: { ...target, current: target.endsAt === null },
      seasons,
      players: entry.rows.slice(0, TOP).map(({ playerId: _id, ...rest }) => rest),
      total: entry.rows.length,
      you: mine ? { rank: mine.rank, username: mine.username, rating: mine.rating, matches: mine.matches, wins: mine.wins } : null,
    };
  }

  /** Drop cached boards (a season started, a review changed who is shown) */
  invalidate(): void {
    this.cache.clear();
  }

  // ============================================
  // Storage (kept small so tests can stand in for Supabase)
  // ============================================

  async fetchSeasons(): Promise<Season[]> {
    const { data, error } = await db.from("seasons").select("id, name, starts_at, ends_at").order("id", { ascending: false });
    if (error) {
      if (isMissingSchema(error)) throw new NotAvailableError("The leaderboard");
      throw error;
    }
    return (data ?? []).map((s: any) => ({ id: s.id, name: s.name, startsAt: s.starts_at, endsAt: s.ends_at }));
  }

  async fetchBoard(limit: number): Promise<BoardRow[]> {
    const { data, error } = await db.rpc("season_leaderboard", { p_limit: limit });
    if (error) {
      if (isMissingSchema(error)) throw new NotAvailableError("The leaderboard");
      throw error;
    }
    return (data ?? []).map((r: any) => ({
      rank: Number(r.rank),
      playerId: r.player_id,
      username: r.username,
      avatarUrl: r.avatar_url ?? null,
      rating: r.rating,
      matches: Number(r.season_matches),
      wins: Number(r.season_wins),
    }));
  }

  async fetchStandings(seasonId: number): Promise<BoardRow[]> {
    const { data, error } = await db
      .from("season_standings")
      .select("rank, player_id, username, rating, matches, wins")
      .eq("season_id", seasonId)
      .order("rank", { ascending: true })
      .limit(1000);
    if (error) {
      if (isMissingSchema(error)) throw new NotAvailableError("The leaderboard");
      throw error;
    }
    return (data ?? []).map((r: any) => ({
      rank: r.rank,
      playerId: r.player_id,
      username: r.username,
      avatarUrl: null,
      rating: r.rating,
      matches: r.matches,
      wins: r.wins,
    }));
  }

  /** Close the open season and start the next (admin) */
  async startSeason(name: string): Promise<number> {
    const { data, error } = await db.rpc("start_new_season", { p_name: name });
    if (error) {
      if (isMissingSchema(error)) throw new NotAvailableError("Seasons");
      throw error;
    }
    this.invalidate();
    return Number(data);
  }
}

export const leaderboardService = new LeaderboardService();
