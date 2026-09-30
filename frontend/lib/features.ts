/**
 * Marketing switches. Flip these off to hide sections that describe features
 * the backend does not ship.
 */
export const features = {
  /** The landing page "Ranks" section and nav link. */
  rankLadder: true,
};

/**
 * Rank tiers by Elo rating. New players start at 1000 (Bronze); every human
 * match moves the rating by up to 32 points (see backend GameService and
 * migration 011). Practice matches against the bot are not rated.
 */
export const RANK_TIERS = [
  { name: "Iron", min: 0, tone: "#6f6f78" },
  { name: "Bronze", min: 900, tone: "#a0694a" },
  { name: "Silver", min: 1100, tone: "#9aa0ab" },
  { name: "Gold", min: 1300, tone: "#d9b25b" },
  { name: "Platinum", min: 1500, tone: "#5fb3ad" },
  { name: "Diamond", min: 1700, tone: "#8f9cff" },
  { name: "Deadlock", min: 1900, tone: "#e5484d" },
] as const;

export type RankTier = (typeof RANK_TIERS)[number];

export interface TierStanding {
  index: number;
  tier: RankTier;
  next: RankTier | null;
  /** Points still needed for the next tier (0 at the top) */
  toNext: number;
  /** 0..1 through the current tier */
  progress: number;
}

export function tierFor(rating: number): TierStanding {
  let index = 0;
  RANK_TIERS.forEach((t, i) => {
    if (rating >= t.min) index = i;
  });
  const tier = RANK_TIERS[index];
  const next = RANK_TIERS[index + 1] ?? null;
  if (!next) return { index, tier, next: null, toNext: 0, progress: 1 };
  const span = next.min - tier.min;
  return {
    index,
    tier,
    next,
    toNext: next.min - rating,
    progress: Math.min(1, Math.max(0, (rating - tier.min) / span)),
  };
}
