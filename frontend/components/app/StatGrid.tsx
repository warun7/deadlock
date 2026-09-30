import React from "react";
import type { Profile } from "../../types/database";
import { RollingNumber } from "../ui/micro";

interface Stat {
  label: string;
  value: string;
  hint?: string;
}

export function profileStats(profile: Profile | null): Stat[] {
  const won = profile?.matches_won ?? 0;
  const lost = profile?.matches_lost ?? 0;
  const total = profile?.total_matches ?? 0;
  return [
    { label: "Win rate", value: total > 0 ? `${(profile?.win_rate ?? 0).toFixed(1)}%` : "0%" },
    { label: "Record", value: `${won}-${lost}`, hint: `${total} played` },
    { label: "Streak", value: String(profile?.current_streak ?? 0) },
    { label: "Best streak", value: String(profile?.best_streak ?? 0) },
  ];
}

/** Stat readout: mono label over a big tabular number, hairlines between cells. */
const CELL_2 = "[&:nth-child(odd)]:border-r [&:nth-child(even)]:pl-4";
const CELL_4 = `${CELL_2} md:border-r md:pl-4 md:first:pl-0 md:last:border-r-0`;

const StatGrid: React.FC<{ profile: Profile | null; loading: boolean; wide?: boolean; className?: string }> = ({
  profile,
  loading,
  wide = false,
  className = "",
}) => {
  const stats = profileStats(profile);
  return (
    <dl className={`grid grid-cols-2 border-t border-rule ${wide ? "md:grid-cols-4" : ""} ${className}`}>
      {stats.map((s) => (
        <div
          key={s.label}
          className={`flex min-w-0 flex-col justify-between gap-6 border-b border-line py-4 pr-4 ${wide ? CELL_4 : CELL_2}`}
        >
          <dt className="label flex items-center justify-between gap-2 text-fg">
            {s.label}
            {!loading && s.hint && <span className="text-fg-3">{s.hint}</span>}
          </dt>
          <dd className="m-0">
            {loading ? (
              <span className="block h-10 w-20 animate-pulse bg-bg-2" aria-hidden="true" />
            ) : (
              <RollingNumber
                value={s.value}
                className="tabular text-[clamp(2.25rem,4vw,3.25rem)] font-medium leading-none tracking-[-0.05em] text-fg"
              />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
};

export default StatGrid;
