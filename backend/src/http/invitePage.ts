import axios from "axios";
import type { Request, Response } from "express";
import { config } from "../config";
import { describeDifficulty, ROOM_DIFFICULTIES } from "../config/roomDifficulty";
import { normalizeRoomCode } from "../services/RoomService";
import type { RoomPreview } from "../types";

/**
 * Invite link page: /duel/CODE on the site's own domain, which the edge
 * routes here (deploy/Caddyfile).
 *
 * Discord, Slack, iMessage and WhatsApp build a link preview from a page's
 * HTML and never run the app, so the app's static index.html can only ever
 * say "Deadlock". This serves that same index.html with the preview tags
 * filled in for the room: who is inviting, and at what level. Browsers get the
 * normal app from it, which takes over from there.
 */

let lastGoodShell: string | null = null;

/**
 * The app's index.html, fetched fresh each time: it names the current build's
 * hashed bundles, so a cached copy goes stale with every frontend release.
 * The last good copy is only a fallback when the frontend cannot be reached.
 */
async function loadAppShell(): Promise<string | null> {
  try {
    const res = await axios.get<string>(config.appShellUrl, {
      timeout: 3000,
      responseType: "text",
      transformResponse: (data) => data,
    });
    if (typeof res.data === "string" && /<head[\s>]/i.test(res.data)) {
      lastGoodShell = res.data;
      return res.data;
    }
    console.error(`⚠️ App shell from ${config.appShellUrl} is not HTML`);
  } catch (error: any) {
    console.error(`⚠️ Could not load the app shell from ${config.appShellUrl}: ${error.message}`);
  }
  return lastGoodShell;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface PreviewText {
  title: string;
  description: string;
}

export function previewText(preview: RoomPreview | null): PreviewText {
  if (!preview || preview.status !== "open") {
    return {
      title: "Deadlock duel invite",
      description: "This invite has expired. Open a room on Deadlock and challenge a friend to a 1v1 coding duel.",
    };
  }
  if (preview.guest) {
    return {
      title: `${preview.host.username} vs ${preview.guest.username} on Deadlock`,
      description: `A ${ROOM_DIFFICULTIES[preview.difficulty].label.toLowerCase()} friend duel. This room is full; open your own and challenge a friend.`,
    };
  }
  return {
    title: `${preview.host.username} challenged you to a duel`,
    description: `${describeDifficulty(preview.difficulty)}. Same problem, same clock: the first to pass every test wins. Sign up free to take the seat.`,
  };
}

/** Replace the shell's title and preview tags with the room's */
export function injectPreview(html: string, text: PreviewText, pageUrl: string | null): string {
  const image = `${config.siteOrigin}/og.png`;
  const meta = (attr: "name" | "property", key: string, value: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
  const tags = [
    `<title>${escapeHtml(`${text.title} · Deadlock`)}</title>`,
    meta("name", "description", text.description),
    // Rooms come and go; keep them out of search results
    meta("name", "robots", "noindex"),
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", "Deadlock"),
    meta("property", "og:title", text.title),
    meta("property", "og:description", text.description),
    ...(pageUrl ? [meta("property", "og:url", pageUrl)] : []),
    meta("property", "og:image", image),
    meta("property", "og:image:width", "1200"),
    meta("property", "og:image:height", "630"),
    meta("property", "og:image:alt", "Deadlock: same problem, solve it first."),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", text.title),
    meta("name", "twitter:description", text.description),
    meta("name", "twitter:image", image),
  ].join("\n    ");

  // Drop the shell's own preview tags, then put the room's where the title was.
  // Replacer functions, so a "$&" in a username is not read as a pattern.
  const stripped = html.replace(
    /<meta\s[^>]*(?:property="(?:og|twitter):[^"]*"|name="(?:description|robots|twitter:[^"]*)")[^>]*>\s*/gi,
    () => ""
  );
  if (/<title>[\s\S]*?<\/title>/i.test(stripped)) {
    return stripped.replace(/<title>[\s\S]*?<\/title>/i, () => tags);
  }
  return stripped.replace(/<\/head>/i, () => `${tags}\n  </head>`);
}

export function invitePageHandler(getPreview: (code: string) => Promise<RoomPreview | null>) {
  return async (req: Request, res: Response): Promise<void> => {
    const shell = await loadAppShell();
    if (!shell) {
      // The edge serves the plain app when this fails
      res.status(502).type("text/plain").send("The app is not reachable right now.");
      return;
    }

    let preview: RoomPreview | null = null;
    try {
      preview = await getPreview(req.params.code);
    } catch (error) {
      console.error("⚠️ Invite page could not read the room:", error);
    }

    const code = normalizeRoomCode(req.params.code);
    res
      .status(200)
      .set("Cache-Control", "no-cache")
      .type("html")
      .send(injectPreview(shell, previewText(preview), code ? `${config.siteOrigin}/duel/${code}` : null));
  };
}
