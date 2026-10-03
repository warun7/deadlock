import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "@phosphor-icons/react";
import { AppShell } from "../components/app/AppNav";
import Avatar from "../components/ui/Avatar";
import { ButtonLink } from "../components/ui/Button";
import { Label, Tag } from "../components/ui/Chrome";
import { EmptyState } from "../components/app/MatchList";
import { useAuth } from "../contexts/AuthContext";
import { apiGet, ApiError } from "../lib/http";
import { tierFor } from "../lib/features";
import { formatDate } from "../lib/format";
import { track } from "../lib/analytics";

interface Season {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string | null;
}
interface Row {
  rank: number;
  username: string;
  avatarUrl: string | null;
  rating: number;
  matches: number;
  wins: number;
}
interface Board {
  season: Season & { current: boolean };
  seasons: Season[];
  players: Row[];
  total: number;
  you: Omit<Row, "avatarUrl"> | null;
}

const GRID = "grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[64px_minmax(0,1.4fr)_120px_96px_96px] sm:gap-4";

const BoardRow: React.FC<{ row: Row | Omit<Row, "avatarUrl">; you?: boolean; delay?: number }> = ({ row, you, delay = 0 }) => {
  const tier = tierFor(row.rating).tier;
  const losses = row.matches - row.wins;
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`${GRID} border-b border-line py-3 ${you ? "bg-bg-2/70" : ""}`}
    >
      <span className={`tabular text-[clamp(1.125rem,1.6vw,1.375rem)] leading-none tracking-[-0.03em] ${row.rank <= 3 ? "text-fg" : "text-fg-3"}`}>
        {row.rank}
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar src={"avatarUrl" in row ? row.avatarUrl : null} name={row.username} size={28} />
        <Link
          to={`/u/${encodeURIComponent(row.username)}`}
          className="truncate text-[clamp(1.0625rem,1.6vw,1.375rem)] leading-tight tracking-[-0.03em] text-fg transition-colors hover:text-accent-ink"
        >
          {row.username}
        </Link>
        {you && <Tag>You</Tag>}
      </span>
      <span className="label hidden items-center gap-2 text-fg-2 sm:flex">
        <span className="size-[9px] shrink-0" style={{ background: tier.tone }} aria-hidden="true" />
        {tier.name}
      </span>
      <span className="tabular text-right text-[clamp(1.0625rem,1.6vw,1.375rem)] leading-none tracking-[-0.03em] text-fg sm:text-left">
        {row.rating}
      </span>
      <span className="label tabular hidden text-fg-2 sm:block">
        {row.wins}–{losses}
      </span>
    </motion.li>
  );
};

const LeaderboardPage: React.FC = () => {
  const { isLoggedIn } = useAuth();
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");

  useEffect(() => {
    track("leaderboard_view");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => (s === "ready" ? s : "loading"));
    apiGet<Board>(`/leaderboard${seasonId ? `?season=${seasonId}` : ""}`)
      .then((b) => {
        if (cancelled) return;
        setBoard(b);
        setState("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState(e instanceof ApiError && e.code === "NOT_AVAILABLE" ? "unavailable" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId]);

  const youOnBoard = !!board?.you && board.players.some((p) => p.rank === board.you!.rank && p.username === board.you!.username);

  return (
    <AppShell>
      <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
        <p className="label text-fg-3">Leaderboard</p>
        <h1 className="mt-3 text-[clamp(3rem,9vw,8.25rem)] font-medium leading-[0.88] tracking-[-0.06em] text-fg">
          {board?.season.name ?? "This season"}
          {board && (
            <sup className="tabular ml-[0.08em] align-top text-[max(0.2em,14px)] font-normal leading-none tracking-normal">({board.total})</sup>
          )}
        </h1>
        {board && (
          <p className="mt-5 max-w-[52ch] text-[17px] leading-snug text-fg-2">
            {board.season.current
              ? `Since ${formatDate(board.season.startsAt)}. Ranked and ghost duels count; ratings decide the order.`
              : `Final standings, ${formatDate(board.season.startsAt)} to ${formatDate(board.season.endsAt!)}.`}
          </p>
        )}
        {board && board.seasons.length > 1 && (
          <div className="mt-6 flex flex-wrap gap-[3px]" role="radiogroup" aria-label="Season">
            {board.seasons.map((s) => {
              const active = s.id === board.season.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSeasonId(s.endsAt === null ? null : s.id)}
                  className={`label h-7 rounded-[3px] px-2 transition-colors ${active ? "bg-fg text-bg" : "bg-bg-2 text-fg hover:bg-bg-3"}`}
                >
                  {s.name}
                  {s.endsAt === null ? " · Now" : ""}
                </button>
              );
            })}
          </div>
        )}
      </motion.header>

      <section aria-labelledby="board-title" className="mt-14 md:mt-20">
        <Label as="h2" id="board-title" aside={board?.you ? `You: #${board.you.rank}` : isLoggedIn ? "Play a ranked match to place" : undefined}>
          Standings
        </Label>
        <div className={`${GRID} label mt-4 border-b border-rule pb-2 text-fg`} aria-hidden="true">
          <span>/ #</span>
          <span>/ Player</span>
          <span className="hidden sm:block">/ Tier</span>
          <span className="text-right sm:text-left">/ Rating</span>
          <span className="hidden sm:block">/ W–L</span>
        </div>

        {state === "loading" && (
          <ul aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-4 border-b border-line py-4">
                <span className="h-5 w-8 animate-pulse bg-bg-2" />
                <span className="h-5 w-40 animate-pulse bg-bg-2" />
                <span className="ml-auto h-5 w-14 animate-pulse bg-bg-2" />
              </li>
            ))}
          </ul>
        )}

        {state === "unavailable" && <EmptyState title="The leaderboard is not open yet" body="It opens with the next server update. Ratings are already counting." />}
        {state === "error" && <EmptyState title="Could not load the leaderboard" body="Check your connection and reload the page." />}

        {state === "ready" && board && board.players.length === 0 && (
          <EmptyState title="Nobody on the board yet" body="Win a ranked match this season to take the top spot.">
            <ButtonLink to={isLoggedIn ? "/matchmaking" : "/auth?mode=signup"} variant="accent">
              {isLoggedIn ? "Find a match" : "Sign up and play"} <ArrowRight weight="bold" className="size-4" />
            </ButtonLink>
          </EmptyState>
        )}

        {state === "ready" && board && board.players.length > 0 && (
          <ol>
            {board.players.map((row, i) => (
              <BoardRow
                key={`${row.rank}-${row.username}`}
                row={row}
                you={!!board.you && board.you.username === row.username}
                delay={Math.min(i, 12) * 0.025}
              />
            ))}
            {board.you && !youOnBoard && (
              <>
                <li aria-hidden="true" className="label border-b border-line py-2 text-center text-fg-3">
                  ···
                </li>
                <BoardRow row={board.you} you />
              </>
            )}
          </ol>
        )}

        <p className="label mt-6 max-w-[70ch] leading-relaxed text-fg-3">
          Players under fair-play review are left out until a person has checked their matches. Each season ends with a soft
          reset: every rating moves halfway back to 1000.
        </p>
      </section>

      {!isLoggedIn && (
        <div className="mt-16 max-w-md border-t border-rule pt-5">
          <p className="text-[17px] leading-snug text-fg-2">Same problem, same clock. Climb the board in ranked 1v1s.</p>
          <ButtonLink to="/auth?mode=signup" variant="accent" size="lg" className="mt-5">
            Play Deadlock <ArrowRight weight="bold" className="size-4" />
          </ButtonLink>
        </div>
      )}
    </AppShell>
  );
};

export default LeaderboardPage;
