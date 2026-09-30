import React, { useEffect, useState } from "react";
import MatchList from "./MatchList";
import { Button } from "../ui/Button";
import type { MatchDetailed } from "../../types/database";

interface HistorySectionProps {
  /** Changes when the subject changes (e.g. a different public profile). */
  subjectKey: string;
  loadRecent: () => Promise<MatchDetailed[]>;
  loadAll: () => Promise<MatchDetailed[]>;
  emptyTitle: string;
  emptyBody: string;
}

/** Recent matches with an inline "Show all" that loads the full history in place. */
const HistorySection: React.FC<HistorySectionProps> = ({ subjectKey, loadRecent, loadAll, emptyTitle, emptyBody }) => {
  const [matches, setMatches] = useState<MatchDetailed[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setExpanded(false);
    loadRecent()
      .then((m) => !cancelled && setMatches(m))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey]);

  const showAll = async () => {
    setLoadingAll(true);
    try {
      setMatches(await loadAll());
      setExpanded(true);
    } finally {
      setLoadingAll(false);
    }
  };

  return (
    <section aria-labelledby={`history-${subjectKey}`} className="mt-12">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 id={`history-${subjectKey}`} className="text-lg font-medium tracking-[-0.01em] text-fg">
          {expanded ? "Match history" : "Recent matches"}
        </h2>
        {expanded && <span className="text-[13px] text-fg-3">{matches.length} matches</span>}
      </div>
      <MatchList
        matches={matches}
        loading={loading}
        empty={
          <div className="rounded-[var(--radius-panel)] border border-dashed border-line-strong px-6 py-10 text-center">
            <p className="text-[15px] text-fg">{emptyTitle}</p>
            <p className="mt-1 text-sm text-fg-3">{emptyBody}</p>
          </div>
        }
      />
      {!loading && !expanded && matches.length >= 5 && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" size="sm" onClick={showAll} loading={loadingAll}>
            Show all matches
          </Button>
        </div>
      )}
    </section>
  );
};

export default HistorySection;
