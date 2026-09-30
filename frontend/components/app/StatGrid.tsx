import React from "react";
import type { Profile } from "../../types/database";

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
    { label: "Record", value: `${won}W ${lost}L`, hint: `${total} played` },
    { label: "Current streak", value: String(profile?.current_streak ?? 0) },
    { label: "Best streak", value: String(profile?.best_streak ?? 0) },
  ];
}

const StatGrid: React.FC<{ profile: Profile | null; loading: boolean; className?: string }> = ({
  profile,
  loading,
  className = "",
}) => {
  const stats = profileStats(profile);
  return (
    <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] bg-line ${className}`}>
      {stats.map((s) => (
        <div key={s.label} className="bg-surface-1 p-4 sm:p-5">
          <dt className="text-[13px] text-fg-3">{s.label}</dt>
          <dd className="mt-1.5 flex items-baseline gap-2">
            {loading ? (
              <span className="h-7 w-16 animate-pulse rounded bg-surface-3" aria-hidden="true" />
            ) : (
              <span className="tabular font-mono text-2xl font-medium tracking-[-0.02em] text-fg">{s.value}</span>
            )}
            {!loading && s.hint && <span className="text-[12px] text-fg-3">{s.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
};

export default StatGrid;
