import React from "react";
import { Label } from "../ui/Chrome";
import TierBlocks from "../ui/TierBlocks";
import { RollingNumber } from "../ui/micro";
import { tierFor } from "../../lib/features";

/** Current tier, rating and distance to the next tier. */
const RankPanel: React.FC<{ rating: number | null | undefined; loading: boolean; className?: string }> = ({
  rating,
  loading,
  className = "",
}) => {
  const standing = rating != null ? tierFor(rating) : null;

  return (
    <section aria-label="Rank" className={className}>
      <Label aside={standing?.next ? `${standing.toNext} to ${standing.next.name}` : standing ? "Top tier" : undefined}>
        Rank
      </Label>
      {loading || !standing ? (
        <div className="mt-4 space-y-3" aria-hidden="true">
          <span className="block h-10 w-40 animate-pulse bg-bg-2" />
          <span className="block h-3 w-full animate-pulse bg-bg-2" />
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-end justify-between gap-4">
            <p className="flex items-center gap-3 text-[clamp(2rem,3.4vw,2.75rem)] font-medium leading-none tracking-[-0.05em] text-fg">
              <span className="size-3 shrink-0" style={{ background: standing.tier.tone }} aria-hidden="true" />
              {standing.tier.name}
            </p>
            <p className="text-right">
              <RollingNumber
                value={String(rating)}
                className="tabular text-[clamp(1.5rem,2.4vw,2rem)] font-medium leading-none tracking-[-0.04em] text-fg"
              />
              <span className="label ml-1.5 text-fg-3">Rating</span>
            </p>
          </div>
          <TierBlocks level={standing.index} tone={standing.tier.tone} className="mt-4" />
          <div
            className="mt-3 h-[3px] bg-fg/10"
            role="progressbar"
            aria-label={standing.next ? `Progress to ${standing.next.name}` : "Top tier reached"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(standing.progress * 100)}
          >
            <span
              className="block h-full origin-left bg-fg transition-transform duration-700 ease-[var(--ease-out-expo)]"
              style={{ transform: `scaleX(${standing.progress})` }}
            />
          </div>
        </div>
      )}
    </section>
  );
};

export default RankPanel;
