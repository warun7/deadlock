import React, { useEffect, useState } from "react";
import MatchList, { EmptyState } from "./MatchList";
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
    <section aria-labelledby={`history-${subjectKey}`} className="mt-20 md:mt-28">
      <h2
        id={`history-${subjectKey}`}
        className="text-[clamp(2.25rem,5vw,4.5rem)] font-medium leading-[0.9] tracking-[-0.055em] text-fg"
      >
        {expanded ? "Match history" : "Recent matches"}
        {!loading && (
          <sup className="tabular ml-1 align-top text-[max(0.22em,13px)] font-normal leading-none tracking-normal">
            ({matches.length})
          </sup>
        )}
      </h2>
      <div className="mt-8">
        <MatchList matches={matches} loading={loading} empty={<EmptyState title={emptyTitle} body={emptyBody} />} />
      </div>
      {!loading && !expanded && matches.length >= 5 && (
        <Button variant="outline" onClick={showAll} loading={loadingAll} className="mt-6 w-full sm:w-auto">
          Show all matches
        </Button>
      )}
    </section>
  );
};

export default HistorySection;
