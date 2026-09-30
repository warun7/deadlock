import React from "react";
import { RANK_TIERS } from "../../lib/features";

/** Tier meter: one lit block per step up the ladder. */
const TierBlocks: React.FC<{ level: number; tone: string; size?: string; className?: string }> = ({
  level,
  tone,
  size = "size-3 sm:size-3.5",
  className = "",
}) => (
  <span className={`flex gap-[3px] ${className}`} aria-hidden="true">
    {RANK_TIERS.map((_, i) => (
      <span
        key={i}
        data-block={i <= level ? "on" : "off"}
        className={`block ${size} ${i <= level ? "" : "bg-fg/10"}`}
        style={i <= level ? { background: tone } : undefined}
      />
    ))}
  </span>
);

export default TierBlocks;
