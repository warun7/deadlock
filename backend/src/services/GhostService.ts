import { Server as SocketServer } from "socket.io";
import { db, isMissingSchema, NotAvailableError } from "./db";
import type { TimelineEntry } from "../types";

/**
 * Ghost duels: race a recording of a real player's ranked win, at any hour.
 * A recording is when each of their submissions landed and how many tests
 * it passed (ghost_recordings, migration 013); the ghost replays those on the
 * same clock, and wins if its accepted submission lands first. Unrated, like
 * Practice: a recording is not an opponent, so no rating moves.
 */

export interface GhostRecording {
  id: string;
  match_id: string;
  player_id: string;
  username: string;
  player_rating: number;
  problem_id: string;
  problem_rating: number | null;
  language: string;
  language_id: number;
  solve_ms: number;
  timeline: TimelineEntry[];
  code: string;
}

/** A recording only stands if it ends in an accepted submission */
export function cleanTimeline(entries: TimelineEntry[]): TimelineEntry[] | null {
  const sorted = entries
    .filter((e) => Number.isFinite(e.t) && e.t >= 0 && Number.isFinite(e.passed) && Number.isFinite(e.total))
    .sort((a, b) => a.t - b.t);
  const solvedAt = sorted.findIndex((e) => e.status === "accepted");
  return solvedAt === -1 ? null : sorted.slice(0, solvedAt + 1);
}

export class GhostService {
  /** A recording for this player to race, or null when there is none */
  async pick(playerId: string, rating: number, excludeProblemIds: string[] = []): Promise<GhostRecording | null> {
    const { data, error } = await db.rpc("pick_ghost", {
      p_player_id: playerId,
      p_rating: rating,
      p_exclude_problems: excludeProblemIds,
    });
    if (error) {
      if (isMissingSchema(error)) throw new NotAvailableError("Ghost duels");
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row ? (row as GhostRecording) : null;
  }

  async saveRecording(row: Omit<GhostRecording, "id">): Promise<void> {
    const { error } = await db.from("ghost_recordings").upsert(row, { onConflict: "match_id,player_id", ignoreDuplicates: true });
    if (error && !isMissingSchema(error)) throw error;
  }
}

export const ghostService = new GhostService();

/**
 * Plays a recording back into a match room: "Running tests" a moment before
 * each submission lands, then its result. Calls onSolved when the accepted
 * one lands. Lives in memory, like the practice bot.
 */
export class GhostPlayer {
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;
  /** The last thing the ghost showed, replayed to a player who reloads */
  lastProgress: { status: string; testsProgress?: string } | null = null;

  constructor(
    private io: SocketServer,
    private matchId: string,
    readonly seatId: string,
    private timeline: TimelineEntry[],
    private onSolved: () => void
  ) {}

  /** Start the replay; elapsedMs is how far into the match it already is */
  start(elapsedMs = 0): void {
    for (const entry of this.timeline) {
      const testingAt = Math.max(0, entry.t - 1500 - elapsedMs);
      const landsAt = Math.max(0, entry.t - elapsedMs);
      this.later(testingAt, () => this.emit({ status: "Testing..." }));
      this.later(landsAt, () => {
        const testsProgress = `${entry.passed}/${entry.total}`;
        if (entry.status === "accepted") {
          this.emit({ status: "✅ Solved!", testsProgress });
          this.stop();
          this.onSolved();
        } else {
          this.emit({ status: "❌ Failed", testsProgress });
        }
      });
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(
      setTimeout(() => {
        if (!this.stopped) fn();
      }, ms)
    );
  }

  private emit(progress: { status: string; testsProgress?: string }): void {
    this.lastProgress = progress;
    this.io.to(this.matchId).emit("opponent_progress", { playerId: this.seatId, ...progress });
  }
}
