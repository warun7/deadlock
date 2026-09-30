import React from "react";
import { Link } from "react-router-dom";
import type { MatchDetailed } from "../../types/database";
import { formatClock, formatRelative, languageLabel } from "../../lib/format";

const RESULT = {
  won: { letter: "W", label: "Won", cls: "bg-pass/12 text-pass" },
  lost: { letter: "L", label: "Lost", cls: "bg-accent/12 text-accent-text" },
  draw: { letter: "D", label: "Draw", cls: "bg-warn/12 text-warn" },
} as const;

export const MatchRow: React.FC<{ match: MatchDetailed }> = ({ match }) => {
  const r = RESULT[match.result] ?? RESULT.draw;
  const opponent = match.bot_username || match.opponent_username || "Unknown";
  const lang = languageLabel(match.language);
  const linkable = !match.is_bot_match && !!match.opponent_username;

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 sm:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1fr)_auto] sm:gap-4">
      <span
        className={`inline-flex size-8 items-center justify-center rounded-[8px] font-mono text-[13px] font-semibold ${r.cls}`}
        aria-label={r.label}
        title={r.label}
      >
        {r.letter}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[15px] text-fg">
          {linkable ? (
            <Link to={`/u/${encodeURIComponent(opponent)}`} className="hover:underline hover:underline-offset-4">
              {opponent}
            </Link>
          ) : (
            opponent
          )}
        </div>
        <div className="truncate text-[13px] text-fg-3 sm:hidden">{match.problem_title}</div>
      </div>
      <div className="hidden min-w-0 truncate text-sm text-fg-2 sm:block">{match.problem_title}</div>
      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className="tabular font-mono text-[13px] text-fg-2">
          {match.duration_seconds != null ? formatClock(match.duration_seconds) : ""}
        </span>
        <span className="whitespace-nowrap text-[12px] text-fg-3">
          {[lang, formatRelative(match.completed_at)].filter(Boolean).join(", ")}
        </span>
      </div>
    </li>
  );
};

export const MatchListSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <ul aria-hidden="true" className="divide-y divide-line">
    {Array.from({ length: rows }, (_, i) => (
      <li key={i} className="flex items-center gap-4 py-3.5">
        <span className="size-8 animate-pulse rounded-[8px] bg-surface-3" />
        <span className="h-3.5 w-32 animate-pulse rounded bg-surface-3" />
        <span className="ml-auto h-3.5 w-14 animate-pulse rounded bg-surface-3" />
      </li>
    ))}
  </ul>
);

const MatchList: React.FC<{
  matches: MatchDetailed[];
  loading: boolean;
  empty: React.ReactNode;
}> = ({ matches, loading, empty }) => {
  if (loading) return <MatchListSkeleton />;
  if (matches.length === 0) return <>{empty}</>;
  return (
    <ul className="divide-y divide-line">
      {matches.map((m) => (
        <MatchRow key={m.id} match={m} />
      ))}
    </ul>
  );
};

export default MatchList;
