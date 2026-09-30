import React from "react";
import { Link } from "react-router-dom";
import type { MatchDetailed } from "../../types/database";
import { formatClock, formatRelative, languageLabel } from "../../lib/format";
import { Tag } from "../ui/Chrome";

const RESULT = {
  won: { label: "Won", tone: "pass" },
  lost: { label: "Lost", tone: "fail" },
  draw: { label: "Draw", tone: "warn" },
} as const;

const GRID = "grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 sm:grid-cols-[120px_minmax(0,1.1fr)_minmax(0,1fr)_120px]";

export const MatchRow: React.FC<{ match: MatchDetailed }> = ({ match }) => {
  const r = RESULT[match.result] ?? RESULT.draw;
  const opponent = match.bot_username || match.opponent_username || "Unknown";
  const lang = languageLabel(match.language);
  const linkable = !match.is_bot_match && !!match.opponent_username;

  return (
    <li className={`${GRID} group relative border-b border-line py-3 transition-colors hover:bg-bg-2/60`}>
      <span className="flex items-center gap-2">
        <span
          className="size-[7px] shrink-0 bg-fg transition-[background-color,transform] duration-300 ease-[var(--ease-out-expo)] group-hover:rotate-45 group-hover:bg-accent"
          aria-hidden="true"
        />
        <Tag tone={r.tone}>{r.label}</Tag>
        {!!match.rating_change && (
          <span className={`label tabular hidden sm:inline ${match.rating_change > 0 ? "text-pass-ink" : "text-accent-ink"}`}>
            {match.rating_change > 0 ? "+" : "\u2212"}
            {Math.abs(match.rating_change)}
          </span>
        )}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[clamp(1.125rem,1.8vw,1.5rem)] leading-tight tracking-[-0.03em] text-fg">
          {linkable ? (
            <Link to={`/u/${encodeURIComponent(opponent)}`} className="transition-colors hover:text-accent-ink">
              {opponent}
            </Link>
          ) : (
            opponent
          )}
        </div>
        <div className="truncate text-[13px] text-fg-3 sm:hidden">{match.problem_title}</div>
      </div>
      <div className="hidden min-w-0 truncate text-[15px] text-fg-2 sm:block">{match.problem_title}</div>
      <div className="label flex flex-col items-end gap-1 text-right">
        <span className="tabular text-fg">{match.duration_seconds != null ? formatClock(match.duration_seconds) : ""}</span>
        <span className="whitespace-nowrap text-fg-3">{[lang, formatRelative(match.completed_at)].filter(Boolean).join(" / ")}</span>
      </div>
    </li>
  );
};

export const MatchListHeader: React.FC = () => (
  <div className={`${GRID} label border-b border-rule pb-2 text-fg`} aria-hidden="true">
    <span>/ Result</span>
    <span>/ Opponent</span>
    <span className="hidden sm:block">/ Problem</span>
    <span className="text-right">/ Time</span>
  </div>
);

export const MatchListSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <ul aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => (
      <li key={i} className="flex items-center gap-4 border-b border-line py-4">
        <span className="h-[22px] w-14 animate-pulse bg-bg-2" />
        <span className="h-5 w-40 animate-pulse bg-bg-2" />
        <span className="ml-auto h-4 w-16 animate-pulse bg-bg-2" />
      </li>
    ))}
  </ul>
);

export const EmptyState: React.FC<{ title: string; body: string; children?: React.ReactNode }> = ({ title, body, children }) => (
  <div className="dots flex flex-col items-start gap-2 border-b border-line px-0 py-12">
    <p className="bg-bg pr-2 text-[clamp(1.25rem,2vw,1.625rem)] leading-tight tracking-[-0.03em] text-fg">{title}</p>
    <p className="bg-bg pr-2 text-[15px] text-fg-2">{body}</p>
    {children && <div className="mt-4">{children}</div>}
  </div>
);

const MatchList: React.FC<{
  matches: MatchDetailed[];
  loading: boolean;
  empty: React.ReactNode;
}> = ({ matches, loading, empty }) => (
  <div>
    <MatchListHeader />
    {loading ? (
      <MatchListSkeleton />
    ) : matches.length === 0 ? (
      empty
    ) : (
      <ul>
        {matches.map((m) => (
          <MatchRow key={m.id} match={m} />
        ))}
      </ul>
    )}
  </div>
);

export default MatchList;
