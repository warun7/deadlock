import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "@phosphor-icons/react";
import { AppShell } from "../components/app/AppNav";
import { ButtonLink } from "../components/ui/Button";
import { Figure, Label, Tag } from "../components/ui/Chrome";
import PixelText from "../components/ui/pixel/PixelText";
import { useAuth } from "../contexts/AuthContext";
import { apiGet, ApiError } from "../lib/http";
import { SOCKET_URL } from "../lib/socket";
import { formatClock, formatDate } from "../lib/format";
import { track } from "../lib/analytics";

interface Side {
  name: string;
  rating: number | null;
  change: number | null;
  ghost: boolean;
}
interface Result {
  id: string;
  mode: "ranked" | "friend" | "ghost";
  winner: Side;
  loser: Side;
  problem: { title: string | null; rating: number | null };
  endReason: string;
  durationSeconds: number;
  score: { winner: number; loser: number } | null;
  at: string;
  voided: boolean;
}

const MODE_LABEL = { ranked: "Ranked duel", friend: "Friend duel", ghost: "Ghost duel" } as const;
const sideName = (s: Side) => (s.ghost ? `${s.name}'s ghost` : s.name);

/** A shared result: /r/<matchId>. Public, so a link in Discord opens for anyone. */
const ResultPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { isLoggedIn } = useAuth();
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    apiGet<{ result: Result }>(`/results/${encodeURIComponent(id)}`, false)
      .then((r) => {
        if (cancelled) return;
        setResult(r.result);
        setState("ready");
        track("result_view", { mode: r.result.mode });
      })
      .catch((e: unknown) => !cancelled && setState(e instanceof ApiError && e.status === 404 ? "missing" : "error"));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state === "missing" || state === "error") {
    return (
      <AppShell>
        <p className="label text-fg-3">Result</p>
        <h1 className="mt-3 max-w-[16ch] text-[clamp(2.5rem,7vw,6.5rem)] font-medium leading-[0.9] tracking-[-0.06em] text-fg">
          {state === "missing" ? "This result is not here" : "Could not load the result"}
        </h1>
        <div className="mt-10 max-w-md border-t border-rule pt-5">
          <p className="text-[17px] leading-snug text-fg-2">
            {state === "missing" ? "The link may be mistyped. Play a duel of your own instead." : "Check your connection and reload the page."}
          </p>
          <ButtonLink to={isLoggedIn ? "/dashboard" : "/auth?mode=signup"} variant="accent" className="mt-6">
            {isLoggedIn ? "Back to lobby" : "Play Deadlock"}
          </ButtonLink>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {state === "loading" || !result ? (
        <div aria-busy="true" className="space-y-4">
          <span className="block h-3 w-24 animate-pulse bg-bg-2" />
          <span className="block h-20 w-2/3 animate-pulse bg-bg-2" />
          <span className="block aspect-[1200/630] w-full max-w-3xl animate-pulse bg-bg-2" />
        </div>
      ) : (
        <>
          <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            <p className="label flex items-center gap-2 text-fg-3">
              {MODE_LABEL[result.mode]} <span aria-hidden="true">·</span> {formatDate(result.at)}
              {result.voided && <Tag tone="warn">Rating voided</Tag>}
            </p>
            <h1 className="mt-3 max-w-[18ch] text-[clamp(2.75rem,8vw,7rem)] font-medium leading-[0.9] tracking-[-0.06em] text-fg">
              {sideName(result.winner)} <span className="text-fg-3">beat</span> {sideName(result.loser)}
              <span className="text-accent">.</span>
            </h1>
          </motion.header>

          <div className="mt-12 grid gap-10 lg:grid-cols-12 lg:gap-6">
            <section className="lg:col-span-7" aria-label="Result card">
              <Figure n="R" bodyClassName="bg-bg">
                <img
                  src={`${SOCKET_URL}/results/${result.id}/card.png`}
                  alt={`${sideName(result.winner)} beat ${sideName(result.loser)}`}
                  width={1200}
                  height={630}
                  className="block h-auto w-full"
                />
              </Figure>
            </section>

            <section className="lg:col-span-4 lg:col-start-9" aria-labelledby="result-detail">
              <Label as="h2" id="result-detail">
                The duel
              </Label>
              <div className="mt-5">
                <p className="label text-fg-3">{result.endReason === "solved" ? "Solved in" : "Won by"}</p>
                {result.endReason === "solved" ? (
                  <PixelText text={formatClock(result.durationSeconds)} led gap={0.16} label={formatClock(result.durationSeconds)} className="mt-2 h-12 text-fg" />
                ) : (
                  <p className="mt-2 text-[clamp(1.5rem,2.4vw,2rem)] font-medium tracking-[-0.04em] text-fg">
                    {result.endReason === "forfeit" ? "Forfeit" : result.endReason === "disconnect" ? "Disconnect" : "Decision"}
                  </p>
                )}
              </div>
              <ul className="mt-6 border-t border-rule">
                {[
                  { tag: "Winner", side: result.winner },
                  { tag: "Loser", side: result.loser },
                ].map(({ tag, side }) => (
                  <li key={tag} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-3">
                    <span className="label flex items-center gap-2 text-fg">
                      <span className={`size-[7px] ${tag === "Winner" ? "bg-pass" : "bg-accent"}`} aria-hidden="true" />
                      {tag}
                    </span>
                    {side.ghost ? (
                      <span className="truncate text-[17px] tracking-[-0.01em] text-fg">{sideName(side)}</span>
                    ) : (
                      <Link to={`/u/${encodeURIComponent(side.name)}`} className="truncate text-[17px] tracking-[-0.01em] text-fg transition-colors hover:text-accent-ink">
                        {side.name}
                      </Link>
                    )}
                    <span className="label tabular text-right text-fg-2">
                      {side.rating != null && side.change != null ? (
                        <>
                          {side.rating}{" "}
                          <span className={side.change >= 0 ? "text-pass-ink" : "text-accent-ink"}>
                            {side.change >= 0 ? "+" : "−"}
                            {Math.abs(side.change)}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="label mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-fg-3">
                {result.problem.rating && (
                  <>
                    <dt>Problem</dt>
                    <dd className="text-fg">Rated {result.problem.rating}</dd>
                  </>
                )}
                {result.score && (
                  <>
                    <dt>Room score</dt>
                    <dd className="tabular text-fg">
                      {result.score.winner}:{result.score.loser}
                    </dd>
                  </>
                )}
              </dl>

              <div className="mt-10 border-t border-rule pt-5">
                <p className="text-[17px] leading-snug text-fg-2">Same problem, same clock. Think you&apos;re faster?</p>
                <ButtonLink to={isLoggedIn ? "/matchmaking" : "/auth?mode=signup"} variant="accent" size="lg" className="mt-5 w-full justify-between">
                  {isLoggedIn ? "Find a match" : "Play Deadlock"} <ArrowRight weight="bold" className="size-4" />
                </ButtonLink>
                {isLoggedIn && result.mode !== "friend" && (
                  <ButtonLink to="/ghost" variant="outline" size="lg" className="mt-2 w-full justify-between">
                    Race a ghost <span className="label text-fg-3">Unrated</span>
                  </ButtonLink>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </AppShell>
  );
};

export default ResultPage;
