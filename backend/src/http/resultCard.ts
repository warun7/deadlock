import path from "path";
import { Resvg } from "@resvg/resvg-js";
import { formatClock, type PublicResult } from "../services/ResultsService";
import { pixelCells } from "./pixelFont";

/**
 * The 1200x630 share card for a result, in the site's paper style (same
 * layout as frontend/public/og.png): who beat whom, the time in the pixel
 * font, the problem's rating and the rating change. Drawn as SVG and rendered
 * to PNG, since link previews on Discord and X do not show SVG.
 */

const W = 1200;
const H = 630;
const PAD = 56;

const C = {
  bg: "#e8e8e6",
  bg2: "#dcdcd9",
  fg: "#1b1b1b",
  fg2: "#444442",
  fg3: "#626260",
  line: "#c6c6c2",
  accent: "#d92d22",
  pass: "#08703e",
  dot: "rgba(27,27,27,0.22)",
};

const FONT_DIR = path.resolve(__dirname, "../../assets/fonts");
const FONT_FILES = ["Geist-Regular.ttf", "Geist-Medium.ttf", "GeistMono-Medium.ttf"].map((f) => path.join(FONT_DIR, f));

const esc = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Names longer than this are cut with an ellipsis */
const clip = (value: string, max: number) => ([...value].length > max ? `${[...value].slice(0, max - 1).join("")}…` : value);

/** Rough width of text in Geist Medium: about 0.56 of the size per character */
const widthOf = (text: string, size: number) => [...text].length * size * 0.56;

function pixelText(text: string, x: number, y: number, cell: number, fill: string): { svg: string; width: number } {
  const { width, cells } = pixelCells(text);
  const size = cell * 0.9;
  const rects = cells
    .map((c) => `<rect x="${(x + c.x * cell).toFixed(1)}" y="${(y + c.y * cell).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" fill="${fill}"/>`)
    .join("");
  return { svg: rects, width: width * cell };
}

function cross(x: number, y: number): string {
  return `<path d="M${x - 7} ${y}H${x + 7}M${x} ${y - 7}V${y + 7}" stroke="${C.fg}" stroke-width="1.5"/>`;
}

const modeLabel = (mode: PublicResult["mode"]) =>
  mode === "friend" ? "/ FRIEND DUEL" : mode === "ghost" ? "/ GHOST DUEL" : "/ RANKED DUEL";

export function resultCardSvg(r: PublicResult): string {
  const winner = clip(r.winner.ghost ? `${r.winner.name}'s ghost` : r.winner.name, 22);
  const loser = clip(r.loser.ghost ? `${r.loser.name}'s ghost` : r.loser.name, 22);
  const line1 = winner;
  const line2 = `beat ${loser}`;

  // Two lines of headline, as large as fits the card
  const maxWidth = W - PAD * 2;
  const longest = Math.max(widthOf(line1, 1), widthOf(line2 + ".", 1));
  const size = Math.round(Math.max(56, Math.min(116, maxWidth / longest)));
  const headlineWidth = longest * size;
  // Centred in the band between the top rule and the stats
  const top = 132 + Math.max(0, (262 - size * 2) / 2);
  const y1 = top + size * 0.86;
  const y2 = y1 + size * 1.0;
  // No full stop after a cut name
  const stop = line2.endsWith("\u2026") ? "" : `<tspan fill="${C.accent}">.</tspan>`;

  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);

  // Dot field on the right, when the headline leaves room for it
  if (headlineWidth < 760) {
    for (let x = 856; x <= 1144; x += 26) {
      for (let y = 146; y <= 380; y += 26) parts.push(`<circle cx="${x}" cy="${y}" r="1.6" fill="${C.dot}"/>`);
    }
  }

  // Chip and mode
  parts.push(`<rect x="${PAD}" y="44" width="156" height="44" rx="4" fill="${C.bg2}"/>`);
  parts.push(`<rect x="72" y="56" width="12" height="12" fill="${C.fg}"/><rect x="80" y="64" width="12" height="12" fill="${C.accent}"/>`);
  parts.push(`<text x="106" y="73" font-family="Geist Mono" font-weight="500" font-size="18" fill="${C.fg}">DEADLOCK</text>`);
  parts.push(`<text x="${W - PAD}" y="73" text-anchor="end" font-family="Geist Mono" font-weight="500" font-size="18" fill="${C.fg2}">${modeLabel(r.mode)}</text>`);

  // Rule with crosses
  parts.push(`<path d="M48 118H${W - 48}" stroke="${C.fg}" stroke-width="1.5"/>`);
  parts.push(cross(PAD, 118), cross(732, 118), cross(W - PAD, 118));

  // Headline
  parts.push(`<text x="${PAD - 4}" y="${y1.toFixed(0)}" font-family="Geist" font-weight="500" font-size="${size}" letter-spacing="${(-size * 0.045).toFixed(1)}" fill="${C.fg}">${esc(line1)}</text>`);
  parts.push(
    `<text x="${PAD - 4}" y="${y2.toFixed(0)}" font-family="Geist" font-weight="500" font-size="${size}" letter-spacing="${(-size * 0.045).toFixed(1)}" fill="${C.fg}">${esc(line2)}${stop}</text>`
  );

  // Stats: time (pixel clock), problem, rating or room score
  const statsY = 438;
  const label = (x: number, text: string) =>
    `<text x="${x}" y="${statsY}" font-family="Geist Mono" font-weight="500" font-size="16" fill="${C.fg3}">${esc(text)}</text>`;
  const value = (x: number, text: string, fill = C.fg) =>
    `<text x="${x}" y="${statsY + 52}" font-family="Geist" font-weight="500" font-size="40" letter-spacing="-1.2" fill="${fill}">${esc(text)}</text>`;

  if (r.endReason === "solved") {
    parts.push(label(PAD, "SOLVED IN"));
    parts.push(pixelText(formatClock(r.durationSeconds), PAD, statsY + 14, 7, C.fg).svg);
  } else {
    parts.push(label(PAD, "WON BY"));
    parts.push(value(PAD, r.endReason === "forfeit" ? "Forfeit" : r.endReason === "disconnect" ? "Disconnect" : "Decision"));
  }
  if (r.problem.rating) {
    parts.push(label(420, "PROBLEM"));
    parts.push(value(420, `Rated ${r.problem.rating}`));
  }
  const ratedSide = r.winner.ghost ? r.loser : r.winner;
  if (r.voided) {
    parts.push(label(760, "RATING"));
    parts.push(value(760, "Voided", C.fg3));
  } else if (r.score) {
    parts.push(label(760, "ROOM SCORE"));
    parts.push(pixelText(`${r.score.winner}:${r.score.loser}`, 760, statsY + 14, 7, C.fg).svg);
  } else if (ratedSide.rating != null && ratedSide.change != null) {
    const sign = ratedSide.change >= 0 ? "+" : "−";
    parts.push(label(760, r.winner.ghost ? `${clip(r.loser.name, 14).toUpperCase()}'S RATING` : "RATING"));
    parts.push(
      `<text x="760" y="${statsY + 52}" font-family="Geist" font-weight="500" font-size="40" letter-spacing="-1.2" fill="${C.fg}">${ratedSide.rating} <tspan fill="${ratedSide.change >= 0 ? C.pass : C.accent}">${sign}${Math.abs(ratedSide.change)}</tspan></text>`
    );
  }

  // Footer
  parts.push(`<path d="M${PAD} 528H${W - PAD}" stroke="${C.line}" stroke-width="1.5"/>`);
  parts.push(`<text x="${PAD}" y="580" font-family="Geist" font-size="30" letter-spacing="-0.6" fill="${C.fg2}">Same problem. Same clock. Think you're faster?</text>`);
  parts.push(`<text x="${W - PAD}" y="578" text-anchor="end" font-family="Geist Mono" font-weight="500" font-size="20" fill="${C.fg}">DEADLOCK.SBS</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

export function renderResultCard(r: PublicResult): Buffer {
  const resvg = new Resvg(resultCardSvg(r), {
    fitTo: { mode: "width", value: W },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Geist" },
  });
  return resvg.render().asPng();
}
