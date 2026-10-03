import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowClockwise, ArrowRight, Ghost } from "@phosphor-icons/react";
import { AppShell } from "../components/app/AppNav";
import StatGrid from "../components/app/StatGrid";
import NameTitle from "../components/app/NameTitle";
import RankPanel from "../components/app/RankPanel";
import RankedHour from "../components/app/RankedHour";
import MatchList, { EmptyState } from "../components/app/MatchList";
import { Button, ButtonLink, Kbd } from "../components/ui/Button";
import { Detail, Figure, Label } from "../components/ui/Chrome";
import { QueueDemo } from "../components/landing/StepDemos";
import { RollText } from "../components/ui/micro";
import { useAuth } from "../contexts/AuthContext";
import { useCurrentProfile } from "../lib/useCurrentProfile";
import { useShortcuts } from "../lib/useShortcuts";
import { getRecentMatches } from "../lib/api";
import { gameSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";
import { useLobbyStats } from "../lib/useLobby";
import type { MatchDetailed } from "../types/database";

const reveal = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.04 + i * 0.07, duration: 0.7, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, loading: profileLoading, username } = useCurrentProfile();
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [recent, setRecent] = useState<MatchDetailed[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const lobby = useLobbyStats();
  const ghosts = lobby?.ghosts !== false;

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
  useShortcuts({
    m: () => navigate(inMatch ? `/game/${activeMatchId}` : "/matchmaking"),
    p: () => {
      if (!inMatch) navigate("/practice");
    },
    f: () => {
      if (!inMatch) navigate("/duel");
    },
    g: () => {
      if (!inMatch && ghosts) navigate("/ghost");
    },
  });

  return (
    <AppShell>
      <motion.header initial="hidden" animate="show" custom={0} variants={reveal}>
        <p className="label text-fg-3">Lobby</p>
        <NameTitle name={username} count={profile?.total_matches ?? undefined} className="mt-3" />
      </motion.header>

      <div className="mt-14 grid gap-14 md:mt-20 lg:grid-cols-12 lg:gap-6">
        {/* Play */}
        <motion.section
          initial="hidden"
          animate="show"
          custom={1}
          variants={reveal}
          aria-labelledby="play-title"
          className="flex flex-col lg:col-span-7"
        >
          <Label
            as="h2"
            id="play-title"
            aside={
              inMatch ? (
                <span className="text-pass-ink">Live</span>
              ) : lobby ? (
                <span aria-live="polite">
                  <span className="tabular text-fg">{lobby.online}</span> online <span aria-hidden="true">·</span>{" "}
                  <span className="tabular text-fg">{lobby.inQueue}</span> in queue
                  {lobby.inMatches > 0 && (
                    <>
                      {" "}
                      <span aria-hidden="true">·</span> <span className="tabular text-fg">{lobby.inMatches}</span> playing
                    </>
                  )}
                </span>
              ) : (
                "1v1"
              )
            }
          >
            {inMatch ? "Match in progress" : "Play"}
          </Label>

          <div className="mt-5 grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-col">
              {inMatch ? (
                <p className="text-[clamp(1.5rem,2.4vw,2rem)] leading-[1.08] tracking-[-0.035em] text-fg-2">
                  <strong className="font-medium text-fg">Your match is still running.</strong> The clock kept going
                  while you were away. Jump back in before your opponent finishes.
                </p>
              ) : lobby && lobby.online <= 1 && lobby.inQueue === 0 ? (
                <p className="text-[clamp(1.5rem,2.4vw,2rem)] leading-[1.08] tracking-[-0.035em] text-fg-2">
                  <strong className="font-medium text-fg">Quiet right now.</strong> Race a ghost of a real player&apos;s win
                  (rated), or send a friend a duel link. The ranked hour fills the queue.
                </p>
              ) : (
                <p className="text-[clamp(1.5rem,2.4vw,2rem)] leading-[1.08] tracking-[-0.035em] text-fg-2">
                  <strong className="font-medium text-fg">Ranked 1v1.</strong> Another player, a problem matched to your
                  rating. The first submission to pass every test wins.
                </p>
              )}
              <Detail label={inMatch ? "Status" : "Languages"} className="mt-6">
                {inMatch ? "Clock running" : "Python, JavaScript, C++"}
              </Detail>
              <div className="mt-6">
                {inMatch ? (
                  <Button variant="accent" size="lg" autoFocus onClick={() => navigate(`/game/${activeMatchId}`)} className="group w-full justify-between">
                    <span className="inline-flex items-center gap-2">
                      <ArrowClockwise weight="bold" className="size-4" />
                      <RollText>Rejoin match</RollText>
                    </span>
                    <Kbd>M</Kbd>
                  </Button>
                ) : (
                  <>
                    <ButtonLink to="/matchmaking" variant="accent" size="lg" autoFocus className="group w-full justify-between">
                      <span className="inline-flex items-center gap-2">
                        <RollText>Find match</RollText>
                        <ArrowRight weight="bold" className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                      </span>
                      <Kbd>M</Kbd>
                    </ButtonLink>
                    <ButtonLink to="/duel" variant="outline" size="lg" className="group mt-2 w-full justify-between">
                      <span className="inline-flex items-center gap-2">
                        <RollText>Challenge a friend</RollText>
                        <span className="label text-fg-3">Link</span>
                      </span>
                      <Kbd>F</Kbd>
                    </ButtonLink>
                    {ghosts && (
                      <ButtonLink to="/ghost" variant="outline" size="lg" className="group mt-2 w-full justify-between">
                        <span className="inline-flex items-center gap-2">
                          <Ghost className="size-4" />
                          <RollText>Race a ghost</RollText>
                          <span className="label text-fg-3">Rated</span>
                        </span>
                        <Kbd>G</Kbd>
                      </ButtonLink>
                    )}
                    <ButtonLink to="/practice" variant="outline" size="lg" className="group mt-2 w-full justify-between">
                      <span className="inline-flex items-center gap-2">
                        <RollText>Practice vs bot</RollText>
                        <span className="label text-fg-3">Unrated</span>
                      </span>
                      <Kbd>P</Kbd>
                    </ButtonLink>
                  </>
                )}
              </div>
            </div>
            <Figure n="Q" className="hidden aspect-[4/3] sm:flex">
              <QueueDemo />
            </Figure>
          </div>
        </motion.section>

        {/* Stats */}
        <motion.section
          initial="hidden"
          animate="show"
          custom={2}
          variants={reveal}
          aria-labelledby="stats-title"
          className="lg:col-span-4 lg:col-start-9"
        >
          <RankPanel rating={profile?.rating} loading={profileLoading} />
          <ButtonLink to="/leaderboard" variant="ghost" size="sm" className="group -ml-3.5 mt-3">
            Leaderboard
            <ArrowRight weight="bold" className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            <Kbd>B</Kbd>
          </ButtonLink>
          <Label as="h2" id="stats-title" rule={false} className="mt-8">
            Record
          </Label>
          <StatGrid profile={profile} loading={profileLoading} className="mt-0" />
          <RankedHour stats={lobby} className="mt-10" />
        </motion.section>
      </div>

      {/* Recent matches */}
      <motion.section
        initial="hidden"
        animate="show"
        custom={3}
        variants={reveal}
        aria-labelledby="recent-title"
        className="mt-20 md:mt-28"
      >
        <div className="flex items-end justify-between gap-4">
          <h2 id="recent-title" className="text-[clamp(2.25rem,5vw,4.5rem)] font-medium leading-[0.9] tracking-[-0.055em] text-fg">
            Recent matches
            {!recentLoading && (
              <sup className="tabular ml-1 align-top text-[max(0.22em,13px)] font-normal leading-none tracking-normal">
                ({recent.length})
              </sup>
            )}
          </h2>
          {recent.length > 0 && (
            <ButtonLink to="/profile" variant="outline" size="sm">
              Full history
            </ButtonLink>
          )}
        </div>
        <div className="mt-8">
          <MatchList
            matches={recent}
            loading={recentLoading}
            empty={<EmptyState title="No matches yet" body="Your results will show up here after your first duel." />}
          />
        </div>
      </motion.section>
    </AppShell>
  );
};

export default DashboardPage;
