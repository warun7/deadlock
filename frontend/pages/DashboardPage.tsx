import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowClockwise, Sword } from "@phosphor-icons/react";
import { AppShell } from "../components/app/AppNav";
import StatGrid from "../components/app/StatGrid";
import MatchList from "../components/app/MatchList";
import { Button, ButtonLink } from "../components/ui/Button";
import { useAuth } from "../contexts/AuthContext";
import { useCurrentProfile } from "../lib/useCurrentProfile";
import { getRecentMatches } from "../lib/api";
import { gameSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";
import type { MatchDetailed } from "../types/database";

const reveal = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.05 + i * 0.06, duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, loading: profileLoading, username } = useCurrentProfile();
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [recent, setRecent] = useState<MatchDetailed[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getRecentMatches(6)
      .then((m) => !cancelled && setRecent(m))
      .finally(() => !cancelled && setRecentLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Ask the server whether this player has a match in progress (reconnect support).
  // The Find match button stays usable while this runs; the card switches if a match turns up.
  useEffect(() => {
    if (!user) return;
    let cleanup = () => {};
    let cancelled = false;

    const check = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session || cancelled) return;

        let socket = gameSocket.getSocket();
        if (!socket?.connected) socket = gameSocket.connect(session.access_token);

        let timeout: ReturnType<typeof setTimeout> | null = null;
        const handleActiveMatch = (data: { matchId: string }) => {
          setActiveMatchId(data.matchId);
          if (timeout) clearTimeout(timeout);
          socket?.off("active_match_found", handleActiveMatch);
          socket?.off("connect", handleConnect);
        };
        const handleConnect = () => {
          socket?.emit("check_active_match");
          socket?.off("connect", handleConnect);
        };

        socket?.on("active_match_found", handleActiveMatch);
        if (socket?.connected) socket.emit("check_active_match");
        else socket?.on("connect", handleConnect);

        timeout = setTimeout(() => {
          socket?.off("active_match_found", handleActiveMatch);
          socket?.off("connect", handleConnect);
        }, 5000);

        cleanup = () => {
          if (timeout) clearTimeout(timeout);
          socket?.off("active_match_found", handleActiveMatch);
          socket?.off("connect", handleConnect);
        };
      } catch (error) {
        console.error("Error checking active match:", error);
      }
    };

    void check();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [user]);

  const inMatch = !!activeMatchId;

  return (
    <AppShell>
      <motion.header initial="hidden" animate="show" custom={0} variants={reveal} className="mb-8">
        <p className="text-sm text-fg-3">Welcome back</p>
        <h1 className="mt-1 truncate text-[clamp(2rem,4vw,2.75rem)] font-semibold tracking-[-0.035em] text-fg">
          {username}
        </h1>
      </motion.header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* Play card */}
        <motion.section
          initial="hidden"
          animate="show"
          custom={1}
          variants={reveal}
          aria-labelledby="play-title"
          className="panel relative isolate flex flex-col justify-between overflow-hidden p-6 sm:min-h-[320px] sm:p-8"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 -z-10 size-72 rounded-full bg-[radial-gradient(closest-side,rgb(229_72_77/0.14),transparent)]"
          />

          {inMatch ? (
            <>
              <div>
                <p className="inline-flex items-center gap-2 text-[13px] text-pass">
                  <span className="relative flex size-2">
                    <span className="absolute inset-0 animate-ping rounded-full bg-pass/60 motion-reduce:animate-none" />
                    <span className="size-2 rounded-full bg-pass" />
                  </span>
                  Match in progress
                </p>
                <h2 id="play-title" className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-fg sm:text-3xl">
                  Your match is still running
                </h2>
                <p className="mt-2 max-w-[36ch] text-[15px] leading-relaxed text-fg-2">
                  The clock kept going while you were away. Jump back in before your opponent finishes.
                </p>
              </div>
              <div className="mt-8">
                <Button size="lg" autoFocus onClick={() => navigate(`/game/${activeMatchId}`)}>
                  <ArrowClockwise weight="bold" className="size-4" />
                  Rejoin match
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <h2 id="play-title" className="text-2xl font-semibold tracking-[-0.02em] text-fg sm:text-3xl">
                  1v1 duel
                </h2>
                <p className="mt-2 max-w-[36ch] text-[15px] leading-relaxed text-fg-2">
                  A random problem rated up to 1200. First submission to pass every test wins.
                </p>
                <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Languages">
                  {["Python", "JavaScript", "C++"].map((l) => (
                    <li key={l} className="rounded-[6px] bg-white/[0.06] px-2 py-1 text-[12px] text-fg-2">
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-8">
                <ButtonLink to="/matchmaking" size="lg" autoFocus>
                  <Sword weight="bold" className="size-4" />
                  Find match
                </ButtonLink>
              </div>
            </>
          )}
        </motion.section>

        {/* Stats */}
        <motion.section initial="hidden" animate="show" custom={2} variants={reveal} aria-labelledby="stats-title">
          <h2 id="stats-title" className="sr-only">
            Your stats
          </h2>
          <StatGrid profile={profile} loading={profileLoading} className="h-full [&>div]:flex [&>div]:flex-col [&>div]:justify-center" />
        </motion.section>
      </div>

      {/* Recent matches */}
      <motion.section
        initial="hidden"
        animate="show"
        custom={3}
        variants={reveal}
        aria-labelledby="recent-title"
        className="mt-12"
      >
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="recent-title" className="text-lg font-medium tracking-[-0.01em] text-fg">
            Recent matches
          </h2>
          {recent.length > 0 && (
            <ButtonLink to="/profile" variant="ghost" size="sm">
              Full history
            </ButtonLink>
          )}
        </div>
        <MatchList
          matches={recent}
          loading={recentLoading}
          empty={
            <div className="rounded-[var(--radius-panel)] border border-dashed border-line-strong px-6 py-10 text-center">
              <p className="text-[15px] text-fg">No matches yet</p>
              <p className="mt-1 text-sm text-fg-3">Your results will show up here after your first duel.</p>
            </div>
          }
        />
      </motion.section>
    </AppShell>
  );
};

export default DashboardPage;
