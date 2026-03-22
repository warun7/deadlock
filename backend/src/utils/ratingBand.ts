import type { MatchMode } from "../types";
import { config } from "../config";

/** Average rating used to pick a problem fair to both players. */
export function averageElo(elos: number[]): number {
  if (elos.length === 0) return 1200;
  const sum = elos.reduce((a, b) => a + b, 0);
  return Math.round(sum / elos.length);
}

/** Half-width of problem rating window around the skill center. */
export function problemHalfBand(mode: MatchMode): number {
  return mode === "ranked"
    ? config.problems.rankedHalfBand
    : config.problems.unrankedHalfBand;
}

export function clampProblemRatingRange(
  center: number,
  halfBand: number,
): { min: number; max: number } {
  const min = Math.max(
    config.problems.globalMin,
    Math.round(center - halfBand),
  );
  const max = Math.min(
    config.problems.globalMax,
    Math.round(center + halfBand),
  );
  return min <= max ? { min, max } : { min: max, max: min };
}

/** Bot tier from human ELO (stronger players get a faster bot). */
export function botDifficultyForElo(elo: number): "easy" | "medium" | "hard" {
  if (elo < config.bot.eloThresholds.easyMax) return "easy";
  if (elo < config.bot.eloThresholds.mediumMax) return "medium";
  return "hard";
}

/**
 * Synthetic opponent ELO for bots so ranked gains/losses match skill tier.
 * Keeps K-factor meaningful vs a 1000 anchor.
 */
export function botOpponentEloForHuman(humanElo: number): number {
  const { anchorMin, anchorMax, pullStrength } = config.bot.syntheticElo;
  const pulled = humanElo + (1200 - humanElo) * pullStrength;
  return Math.min(anchorMax, Math.max(anchorMin, Math.round(pulled)));
}
