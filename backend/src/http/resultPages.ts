import type { Express, Request, Response } from "express";
import { validate as isUuid } from "uuid";
import { config } from "../config";
import { resultDescription, resultHeadline, toPublic, type ResultsService } from "../services/ResultsService";
import { injectPreview, loadAppShell } from "./invitePage";
import { renderResultCard } from "./resultCard";

/**
 * Shared results. /r/<matchId> on the site's domain is routed here by the
 * edge (deploy/Caddyfile), like invite links: the app's own page with the
 * result's link preview, so Discord and X show the card. The app's /r/:id
 * page reads /results/<matchId>.
 */

const cards = new Map<string, Buffer>();
const CARDS_MAX = 100;

async function cardFor(results: ResultsService, matchId: string): Promise<Buffer | null> {
  const row = await results.get(matchId);
  if (!row) return null;
  const key = `${matchId}:${row.voided ? 1 : 0}`;
  const hit = cards.get(key);
  if (hit) return hit;
  const png = renderResultCard(toPublic(row));
  if (cards.size >= CARDS_MAX) {
    const oldest = cards.keys().next().value;
    if (oldest) cards.delete(oldest);
  }
  cards.set(key, png);
  return png;
}

/** The HTML page; registered ahead of the API's security headers, whose CSP would block the app */
export function resultPageHandler(results: ResultsService) {
  return async (req: Request, res: Response): Promise<void> => {
    const shell = await loadAppShell();
    if (!shell) {
      res.status(502).type("text/plain").send("The app is not reachable right now.");
      return;
    }
    const id = req.params.id;
    let row = null;
    try {
      row = isUuid(id) ? await results.get(id) : null;
    } catch (error) {
      console.error("⚠️ Result page could not read the result:", error);
    }
    const text = row
      ? { title: resultHeadline(toPublic(row)), description: resultDescription(toPublic(row)) }
      : {
          title: "A Deadlock duel",
          description: "Same problem, same clock: the first to pass every test wins. Play a 1v1 coding duel on Deadlock.",
        };
    const pageUrl = row ? `${config.siteOrigin}/r/${id}` : null;
    res
      .status(200)
      .set("Cache-Control", "no-cache")
      .type("html")
      .send(injectPreview(shell, text, pageUrl, row ? { image: `${config.siteOrigin}/r/${id}/card.png`, alt: text.title } : undefined));
  };
}

export function registerResultRoutes(app: Express, results: ResultsService): void {
  app.get("/results/:id", async (req, res) => {
    try {
      const row = isUuid(req.params.id) ? await results.get(req.params.id) : null;
      if (!row) {
        res.status(404).json({ error: "Result not found" });
        return;
      }
      res.set("Cache-Control", "public, max-age=60").json({ result: toPublic(row) });
    } catch (error) {
      console.error("⚠️ Could not serve a result:", error);
      res.status(500).json({ error: "Could not load the result" });
    }
  });
}

/** The card image, on the API domain and (through the edge) under /r/ on the site */
export function resultCardHandler(results: ResultsService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const png = isUuid(req.params.id) ? await cardFor(results, req.params.id) : null;
      if (!png) {
        res.status(404).type("text/plain").send("Result not found");
        return;
      }
      res.set("Cache-Control", "public, max-age=300").type("png").send(png);
    } catch (error) {
      console.error("⚠️ Could not draw a result card:", error);
      res.status(500).type("text/plain").send("Could not draw the card");
    }
  };
}
