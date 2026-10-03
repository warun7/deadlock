import express, { type Express, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { validate as isUuid } from "uuid";
import { isAdmin, optionalUser, requireAdmin, requireUser } from "./auth";
import { NotAvailableError } from "../services/db";
import { analyticsService, cleanClientEvent } from "../services/AnalyticsService";
import { adminService, type ReviewStatus } from "../services/AdminService";
import { leaderboardService } from "../services/LeaderboardService";
import { resultsService } from "../services/ResultsService";
import { isPushSubscription, type NotifyService } from "../services/NotifyService";
import type { LobbyService } from "../services/LobbyService";
import { registerResultRoutes, resultCardHandler } from "./resultPages";

/**
 * REST endpoints for the lobby, leaderboard, shared results, alerts,
 * analytics and the admin review page. Socket.IO carries everything in a
 * match; these are the pages around it.
 */

/** A store's migration has not run: say so plainly instead of a 500 */
function sendFailure(res: Response, error: unknown, what: string): void {
  if (error instanceof NotAvailableError) {
    res.status(503).json({ error: `${what} is not available yet.`, code: "NOT_AVAILABLE" });
    return;
  }
  console.error(`❌ ${what} failed:`, error);
  res.status(500).json({ error: `Could not load ${what.toLowerCase()}. Try again.` });
}

// Analytics: browsers batch their events, so this stays well under it
export const eventsLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });

/** Registered before the general API limiter */
export function registerEventRoutes(app: Express): void {
  // Pages being closed send with sendBeacon, as text/plain (a JSON content
  // type there needs a preflight a closing page never gets to make)
  app.post("/events", eventsLimiter, express.text({ type: "text/plain", limit: "16kb" }), optionalUser, (req: Request, res: Response) => {
    let raw: unknown = req.body;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    const body = (raw && typeof raw === "object" ? raw : {}) as { anonId?: unknown; events?: unknown };
    const anonId = typeof body.anonId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.anonId) ? body.anonId : null;
    const events = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
    let kept = 0;
    for (const raw of events) {
      const event = cleanClientEvent(raw);
      if (!event) continue;
      // identify ties this browser to the account; it needs the account
      if (event.event === "identify" && !req.user) continue;
      analyticsService.track({ ...event, anon_id: anonId, user_id: req.user?.id ?? null });
      kept++;
    }
    res.status(202).json({ ok: true, kept });
  });
}

export function registerRoutes(app: Express, deps: { lobby: LobbyService; notify: NotifyService }): void {
  // ---------- Lobby ----------
  app.get("/lobby", (_req, res) => {
    res.set("Cache-Control", "no-store").json(deps.lobby.stats());
  });

  // ---------- Leaderboard ----------
  app.get("/leaderboard", optionalUser, async (req, res) => {
    const raw = typeof req.query.season === "string" ? req.query.season : "";
    const seasonId = raw && raw !== "current" ? Number.parseInt(raw, 10) : null;
    if (seasonId !== null && !Number.isFinite(seasonId)) {
      res.status(400).json({ error: "Unknown season" });
      return;
    }
    try {
      const board = await leaderboardService.board(seasonId, req.user?.id ?? null);
      if (!board) {
        res.status(404).json({ error: "Unknown season" });
        return;
      }
      res.set("Cache-Control", "no-store").json(board);
    } catch (error) {
      sendFailure(res, error, "The leaderboard");
    }
  });

  // ---------- Shared results ----------
  registerResultRoutes(app, resultsService);
  app.get("/results/:id/card.png", resultCardHandler(resultsService));

  // ---------- Alerts ----------
  app.get("/notifications/config", (_req, res) => {
    res.json({ pushPublicKey: deps.notify.publicKey(), discord: deps.notify.discordReady });
  });

  app.post("/notifications/subscribe", requireUser, async (req, res) => {
    const body = (req.body ?? {}) as { subscription?: unknown; queueAlerts?: unknown; rankedHour?: unknown };
    if (!deps.notify.publicKey()) {
      res.status(503).json({ error: "Alerts are not set up on this server.", code: "NOT_AVAILABLE" });
      return;
    }
    if (!isPushSubscription(body.subscription)) {
      res.status(400).json({ error: "That browser subscription is not usable." });
      return;
    }
    try {
      await deps.notify.subscribe(req.user!.id, body.subscription, {
        queueAlerts: body.queueAlerts !== false,
        rankedHour: body.rankedHour !== false,
      });
      analyticsService.track({ event: "notify_on", user_id: req.user!.id });
      res.json({ ok: true });
    } catch (error) {
      sendFailure(res, error, "Alerts");
    }
  });

  app.post("/notifications/unsubscribe", requireUser, async (req, res) => {
    const endpoint = (req.body ?? {}).endpoint;
    if (typeof endpoint !== "string" || endpoint.length > 1000) {
      res.status(400).json({ error: "Missing endpoint" });
      return;
    }
    try {
      await deps.notify.unsubscribe(req.user!.id, endpoint);
      res.json({ ok: true });
    } catch (error) {
      sendFailure(res, error, "Alerts");
    }
  });

  // ---------- Admin ----------
  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get("/me", (req, res) => {
    res.json({ ok: true, admin: isAdmin(req.user), username: req.user!.username });
  });

  admin.get("/integrity", async (req, res) => {
    const status = String(req.query.status ?? "open");
    const statuses = ["open", "cleared", "confirmed", "all"];
    try {
      const rows = await adminService.integrity({
        status: (statuses.includes(status) ? status : "open") as ReviewStatus | "all",
        flaggedOnly: req.query.flagged !== "0",
        limit: Math.min(200, Math.max(1, Number(req.query.limit) || 100)),
      });
      res.json({ rows });
    } catch (error) {
      sendFailure(res, error, "Fair-play review");
    }
  });

  admin.get("/players", async (_req, res) => {
    try {
      res.json({ rows: await adminService.players(100) });
    } catch (error) {
      sendFailure(res, error, "Fair-play review");
    }
  });

  admin.get("/reports", async (_req, res) => {
    try {
      res.json({ rows: await adminService.reports(100) });
    } catch (error) {
      sendFailure(res, error, "Reports");
    }
  });

  admin.post("/review", async (req, res) => {
    const { matchId, playerId, status, note } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof matchId !== "string" || !isUuid(matchId) || typeof playerId !== "string" || !isUuid(playerId)) {
      res.status(400).json({ error: "Pick a match and a player." });
      return;
    }
    if (status !== "open" && status !== "cleared" && status !== "confirmed") {
      res.status(400).json({ error: "Status must be open, cleared or confirmed." });
      return;
    }
    try {
      const found = await adminService.review(
        matchId,
        playerId,
        status,
        req.user!.id,
        typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null
      );
      if (!found) {
        res.status(404).json({ error: "That match has no fair-play row for this player." });
        return;
      }
      // Who is under review decides who the leaderboard shows
      leaderboardService.invalidate();
      console.log(`🧑‍⚖️ ${req.user!.username} marked ${playerId} in ${matchId} as ${status}`);
      res.json({ ok: true });
    } catch (error) {
      sendFailure(res, error, "Fair-play review");
    }
  });

  admin.post("/void", async (req, res) => {
    const matchId = (req.body ?? {}).matchId;
    if (typeof matchId !== "string" || !isUuid(matchId)) {
      res.status(400).json({ error: "Pick a match." });
      return;
    }
    try {
      const outcome = await adminService.voidRating(matchId);
      resultsService.forget(matchId);
      leaderboardService.invalidate();
      console.log(`🧑‍⚖️ ${req.user!.username} voided the rating change of ${matchId}: ${outcome}`);
      const messages: Record<string, string> = {
        ok: "Rating change undone for both players.",
        not_found: "No saved result for that match, so there is nothing to undo.",
        already_voided: "That rating change was already undone.",
        unrated: "That match did not change anyone's rating.",
      };
      res.status(outcome === "ok" ? 200 : 409).json({ ok: outcome === "ok", outcome, message: messages[outcome] ?? outcome });
    } catch (error) {
      sendFailure(res, error, "Voiding ratings");
    }
  });

  admin.get("/funnel", async (req, res) => {
    try {
      res.json({ rows: await adminService.funnel(Math.min(26, Math.max(1, Number(req.query.weeks) || 8))) });
    } catch (error) {
      sendFailure(res, error, "The funnel report");
    }
  });

  admin.get("/seasons", async (_req, res) => {
    try {
      res.json({ seasons: await leaderboardService.fetchSeasons() });
    } catch (error) {
      sendFailure(res, error, "Seasons");
    }
  });

  admin.post("/seasons", async (req, res) => {
    const name = typeof (req.body ?? {}).name === "string" ? req.body.name.trim().slice(0, 60) : "";
    if (!name) {
      res.status(400).json({ error: "Name the new season." });
      return;
    }
    try {
      const id = await leaderboardService.startSeason(name);
      console.log(`🏁 ${req.user!.username} started season ${id} (${name})`);
      res.json({ ok: true, id });
    } catch (error) {
      sendFailure(res, error, "Seasons");
    }
  });

  app.use("/admin", admin);
}
