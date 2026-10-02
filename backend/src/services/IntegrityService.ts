import { Server as SocketServer } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import { validate as isUuid } from "uuid";
import { redisService } from "./RedisService";
import { config } from "../config";
import {
  AuthenticatedSocket,
  ClientToServerEvents,
  FairPlayEvent,
  MatchState,
  ReportAck,
  ReportReason,
  ServerToClientEvents,
  SubmissionTelemetry,
} from "../types";

const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey
);

/**
 * When a match's signals become a flag. A flag is a reason to look, never a
 * verdict: nothing here changes a rating. Documented in migration 012.
 */
export const FLAG_RULES = {
  /** A blocked outside paste at least this long */
  pasteAttemptChars: 50,
  /** Away at least this long, and for at least this share of the match */
  awayMinMs: 60_000,
  awayMinShare: 0.25,
  /** Submitted characters that were never typed or pasted inside the editor */
  unexplainedChars: 150,
  /**
   * Typing rhythm: enough keystrokes to judge, then too even or too fast.
   * People typing code vary their gaps by half their average or more. Gaps
   * are measured inside the page, where rendering adds jitter, so a script
   * typing at a perfectly fixed delay still measures around 0.3. An average
   * under 60 ms sustained over 150 keystrokes is over 200 words a minute.
   */
  roboticMinIntervals: 150,
  roboticMaxCv: 0.35,
  roboticMaxMeanMs: 60,
  /** Solved this fast, a problem rated this far above the player */
  fastSolveMs: 5 * 60_000,
  fastSolveRatingGap: 300,
} as const;

/** Events a player can send in one match before the rest are ignored */
const MAX_EVENTS_PER_MATCH = 2000;

const FAIR_PLAY_KINDS = new Set(["away", "back", "paste_blocked", "drop_blocked", "bulk_blocked", "copy_blocked"]);
const REPORT_REASONS = new Set<ReportReason>(["outside_help", "other"]);

export type MatchEndReason = "solved" | "forfeit" | "disconnect" | "timeout" | "abandoned";

/** One player's signals for one match, as stored in match_integrity */
export interface IntegrityRow {
  match_id: string;
  player_id: string;
  opponent_id: string | null;
  mode: string;
  problem_id: string;
  problem_rating: number | null;
  player_rating: number | null;
  won: boolean | null;
  end_reason: MatchEndReason;
  duration_seconds: number;
  submissions: number;
  paste_blocked: number;
  paste_blocked_max_chars: number;
  drop_blocked: number;
  bulk_blocked: number;
  copy_blocked: number;
  away_count: number;
  away_seconds: number;
  typed_chars: number | null;
  pasted_chars: number | null;
  code_chars: number | null;
  unexplained_chars: number | null;
  keystroke_intervals: number | null;
  interval_mean_ms: number | null;
  interval_cv: number | null;
  flags: string[];
}

export function computeFlags(row: Omit<IntegrityRow, "flags">): string[] {
  const flags: string[] = [];
  const durationMs = row.duration_seconds * 1000;
  if (row.paste_blocked_max_chars >= FLAG_RULES.pasteAttemptChars) flags.push("paste_attempt");
  if (row.copy_blocked > 0) flags.push("copy_attempt");
  const awayMs = row.away_seconds * 1000;
  if (awayMs >= FLAG_RULES.awayMinMs && awayMs >= durationMs * FLAG_RULES.awayMinShare) flags.push("left_tab");
  if ((row.unexplained_chars ?? 0) >= FLAG_RULES.unexplainedChars) flags.push("code_not_typed");
  if (
    (row.keystroke_intervals ?? 0) >= FLAG_RULES.roboticMinIntervals &&
    ((row.interval_cv ?? 1) <= FLAG_RULES.roboticMaxCv || (row.interval_mean_ms ?? 1000) <= FLAG_RULES.roboticMaxMeanMs)
  ) {
    flags.push("robotic_typing");
  }
  if (
    row.won === true &&
    row.end_reason === "solved" &&
    durationMs < FLAG_RULES.fastSolveMs &&
    row.problem_rating != null &&
    row.player_rating != null &&
    row.problem_rating >= row.player_rating + FLAG_RULES.fastSolveRatingGap
  ) {
    flags.push("fast_solve");
  }
  return flags;
}

/** Whole, non-negative, bounded numbers only; anything else means no telemetry */
export function parseTelemetry(raw: unknown): SubmissionTelemetry | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const keys: (keyof SubmissionTelemetry)[] = [
    "typedChars",
    "pastedChars",
    "baseChars",
    "keystrokeIntervals",
    "intervalMeanMs",
    "intervalStdMs",
  ];
  const out = {} as SubmissionTelemetry;
  for (const k of keys) {
    const v = t[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 10_000_000) return null;
    out[k] = v;
  }
  return out;
}

/**
 * IntegrityService - fair play signals for matches between people.
 *
 * The arena blocks copying and outside pastes and reports what it blocked,
 * when the player leaves the tab, and with each submission how the code was
 * entered. Counters live in Redis during the match. When a ranked match ends,
 * each player's counters become one match_integrity row with flags; players
 * can report an opponent afterwards. Friend duels get the same live
 * behaviour (the opponent sees "Left the tab") but nothing is stored, and
 * Practice against the bot is left alone.
 */
export class IntegrityService {
  private io: SocketServer<ClientToServerEvents, ServerToClientEvents>;

  constructor(io: SocketServer<ClientToServerEvents, ServerToClientEvents>) {
    this.io = io;
  }

  /** A fair play event from the arena */
  async handleEvent(socket: AuthenticatedSocket, raw: unknown): Promise<void> {
    if (!raw || typeof raw !== "object") return;
    const kind = (raw as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !FAIR_PLAY_KINDS.has(kind)) return;
    let event: FairPlayEvent;
    if (kind === "away" || kind === "back" || kind === "copy_blocked") {
      event = { kind };
    } else {
      // Blocked inserts carry their size; without a usable one the event is malformed
      const chars = (raw as { chars?: unknown }).chars;
      if (typeof chars !== "number" || !Number.isFinite(chars)) return;
      event = { kind, chars: Math.min(Math.max(0, chars), 1_000_000) } as FairPlayEvent;
    }

    const match = await this.liveMatchFor(socket);
    if (!match) return;
    const userId = socket.user.id;

    const changed = await redisService.recordFairPlayEvent(match.id, userId, event, MAX_EVENTS_PER_MATCH);
    if (changed && (event.kind === "away" || event.kind === "back")) {
      const opponentId = match.player1.id === userId ? match.player2.id : match.player1.id;
      this.emitToUser(opponentId, "opponent_focus", { playerId: userId, away: event.kind === "away" });
    }
  }

  /**
   * A dropped connection is not time spent in another tab: close any open
   * away period (the opponent sees "Disconnected" instead). The arena says
   * again if it is still away once it reconnects.
   */
  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    const matchId = socket.data.currentMatchId;
    if (!matchId) return;
    const match = await redisService.getMatch(matchId, "fair_play_disconnect_read");
    if (!match || match.status !== "active" || match.mode === "practice") return;
    const userId = socket.user.id;
    const changed = await redisService.recordFairPlayEvent(
      matchId,
      userId,
      { kind: "back" },
      MAX_EVENTS_PER_MATCH,
      "fair_play_disconnect"
    );
    if (changed) {
      const opponentId = match.player1.id === userId ? match.player2.id : match.player1.id;
      this.emitToUser(opponentId, "opponent_focus", { playerId: userId, away: false });
    }
  }

  /** Keep the editor's counts from a rated submission (ranked, or a ghost duel) */
  async recordSubmission(match: MatchState, userId: string, code: string, telemetry: unknown): Promise<void> {
    if (match.mode !== "ranked" && match.mode !== "ghost") return;
    const t = parseTelemetry(telemetry);
    await redisService.recordFairPlaySubmission(match.id, userId, {
      code_chars: code.length,
      ...(t
        ? {
            typed: t.typedChars,
            pasted: t.pastedChars,
            base: t.baseChars,
            iv_n: t.keystrokeIntervals,
            iv_mean: t.intervalMeanMs,
            iv_std: t.intervalStdMs,
          }
        : { no_telemetry: 1 }),
    });
  }

  /**
   * A rated match ended: write one row per player (a ghost duel has one, the
   * racer's, against the ghost's real player). Runs once per match, and
   * never throws; a failure costs the signals, not the match.
   */
  async finalize(match: MatchState, winnerId: string | null, endReason: MatchEndReason): Promise<void> {
    if (match.mode !== "ranked" && match.mode !== "ghost") return;
    try {
      if (!(await redisService.claimFairPlayFinalize(match.id))) return;
      const counters = await redisService.getFairPlayCounters(match.id);
      const endedAt = match.finishedAt ?? Date.now();
      const durationMs = Math.max(0, endedAt - match.startedAt);
      const rows =
        match.mode === "ghost"
          ? match.ghost
            ? [
                this.buildRow(match, match.player1.id, match.ghost.playerId, match.player1.elo, winnerId, endReason, durationMs, endedAt, counters),
              ]
            : []
          : [match.player1, match.player2].map((player) => {
              const opponent = player.id === match.player1.id ? match.player2 : match.player1;
              return this.buildRow(match, player.id, opponent.id, player.elo, winnerId, endReason, durationMs, endedAt, counters);
            });
      if (rows.length === 0) return;
      await this.persist(rows);
      const flagged = rows.filter((r) => r.flags.length > 0);
      if (flagged.length > 0) {
        console.log(`🚩 Fair play flags in match ${match.id}: ${flagged.map((r) => `${r.player_id}=${r.flags.join(",")}`).join(" ")}`);
      }
    } catch (error) {
      console.error(`⚠️ Could not record fair play signals for match ${match.id}:`, error);
    }
  }

  /** Report the opponent of a ranked match you played */
  async report(socket: AuthenticatedSocket, raw: unknown): Promise<ReportAck> {
    const payload = (raw && typeof raw === "object" ? raw : {}) as { matchId?: unknown; reason?: unknown; note?: unknown };
    if (typeof payload.matchId !== "string" || !isUuid(payload.matchId)) {
      return { ok: false, message: "That match could not be found." };
    }
    if (typeof payload.reason !== "string" || !REPORT_REASONS.has(payload.reason as ReportReason)) {
      return { ok: false, message: "Pick a reason for the report." };
    }
    const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 500) : "";

    const played = await this.findPlayerRow(payload.matchId, socket.user.id);
    if (!played?.opponent_id) {
      return { ok: false, message: "You can report players from your finished ranked matches." };
    }
    const result = await this.insertReport({
      match_id: payload.matchId,
      reporter_id: socket.user.id,
      reported_id: played.opponent_id,
      reason: payload.reason as ReportReason,
      note: note || null,
    });
    if (result === "duplicate") return { ok: false, message: "You already reported this match." };
    if (result === "error") return { ok: false, message: "Could not send the report. Try again." };
    console.log(`🚩 ${socket.user.username} reported ${played.opponent_id} in match ${payload.matchId} (${payload.reason})`);
    return { ok: true };
  }

  // ============================================
  // Storage (kept small so tests can stand in for Supabase)
  // ============================================

  async persist(rows: IntegrityRow[]): Promise<void> {
    const { error } = await supabase.from("match_integrity").upsert(rows, { onConflict: "match_id,player_id" });
    if (error) throw new Error(`match_integrity insert failed: ${error.message}`);
  }

  async findPlayerRow(matchId: string, playerId: string): Promise<{ opponent_id: string | null } | null> {
    const { data, error } = await supabase
      .from("match_integrity")
      .select("opponent_id")
      .eq("match_id", matchId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (error) {
      console.error("⚠️ Could not look up the reported match:", error.message);
      return null;
    }
    return data;
  }

  async insertReport(row: {
    match_id: string;
    reporter_id: string;
    reported_id: string;
    reason: ReportReason;
    note: string | null;
  }): Promise<"ok" | "duplicate" | "error"> {
    const { error } = await supabase.from("player_reports").insert(row);
    if (!error) return "ok";
    if (error.code === "23505") return "duplicate";
    console.error("⚠️ Could not save a player report:", error.message);
    return "error";
  }

  // ============================================
  // Internals
  // ============================================

  private buildRow(
    match: MatchState,
    playerId: string,
    opponentId: string,
    playerRating: number,
    winnerId: string | null,
    endReason: MatchEndReason,
    durationMs: number,
    endedAt: number,
    counters: Record<string, string>
  ): IntegrityRow {
    const num = (field: string) => {
      const v = Number(counters[`${playerId}:${field}`]);
      return Number.isFinite(v) ? v : 0;
    };
    const has = (field: string) => counters[`${playerId}:${field}`] !== undefined;

    // Still away when the match ended: count up to the end
    let awayMs = num("away_ms");
    if (has("away_since")) awayMs += Math.max(0, endedAt - num("away_since"));

    const submitted = has("code_chars");
    const telemetry = submitted && has("typed");
    const unexplained = telemetry
      ? Math.max(0, num("code_chars") - num("base") - num("typed") - num("pasted"))
      : null;
    const ivMean = telemetry ? num("iv_mean") : null;
    const ivCv = telemetry && num("iv_mean") > 0 ? num("iv_std") / num("iv_mean") : null;

    const row: Omit<IntegrityRow, "flags"> = {
      match_id: match.id,
      player_id: playerId,
      opponent_id: opponentId,
      mode: match.mode,
      problem_id: match.problemId,
      problem_rating: match.problemRating ?? null,
      player_rating: Number.isFinite(playerRating) ? playerRating : null,
      won: winnerId === null ? null : winnerId === playerId,
      end_reason: endReason,
      duration_seconds: Math.round(durationMs / 1000),
      submissions: num("submissions"),
      paste_blocked: num("paste_blocked"),
      paste_blocked_max_chars: num("paste_max"),
      drop_blocked: num("drop_blocked"),
      bulk_blocked: num("bulk_blocked"),
      copy_blocked: num("copy_blocked"),
      away_count: num("away_count"),
      away_seconds: Math.round(awayMs / 1000),
      typed_chars: telemetry ? num("typed") : null,
      pasted_chars: telemetry ? num("pasted") : null,
      code_chars: submitted ? num("code_chars") : null,
      unexplained_chars: unexplained,
      keystroke_intervals: telemetry ? num("iv_n") : null,
      interval_mean_ms: ivMean,
      interval_cv: ivCv === null ? null : Math.round(ivCv * 1000) / 1000,
    };
    return { ...row, flags: computeFlags(row) };
  }

  /** The live match against a person that this socket is playing, if any */
  private async liveMatchFor(socket: AuthenticatedSocket): Promise<MatchState | null> {
    const matchId = socket.data.currentMatchId;
    if (!matchId) return null;
    const match = await redisService.getMatch(matchId, "fair_play_read_match");
    if (!match || match.status !== "active" || match.mode === "practice") return null;
    if (match.player1.id !== socket.user.id && match.player2.id !== socket.user.id) return null;
    return match;
  }

  private emitToUser<E extends keyof ServerToClientEvents>(
    userId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    for (const s of this.io.sockets.sockets.values()) {
      if ((s as AuthenticatedSocket).user?.id === userId) s.emit(event, ...args);
    }
  }
}
