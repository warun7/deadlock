/**
 * Marketing switches. Flip these off to hide sections that describe features
 * the backend does not ship yet.
 */
export const features = {
  /**
   * The landing page "Ranks" section and nav link. Rank tiers are not implemented
   * server-side yet (profiles.rating never updates), so turn this off before
   * shipping to production unless rating persistence and tiers exist by then.
   */
  rankLadder: true,
};

/** Tier names used by the rank ladder. Placeholder names, rename freely. */
export const RANK_TIERS = [
  { name: "Iron", tone: "#6f6f78" },
  { name: "Bronze", tone: "#a0694a" },
  { name: "Silver", tone: "#b4b8c2" },
  { name: "Gold", tone: "#d9b25b" },
  { name: "Platinum", tone: "#7fc6c1" },
  { name: "Diamond", tone: "#9aa7ff" },
  { name: "Deadlock", tone: "#e5484d" },
] as const;
