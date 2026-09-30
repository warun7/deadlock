import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Avatar from "../components/ui/Avatar";
import { Mark } from "../components/ui/Wordmark";
import { Button, Kbd } from "../components/ui/Button";
import { Chip, CrossRow, Figure, Label } from "../components/ui/Chrome";
import PixelText from "../components/ui/pixel/PixelText";
import { SearchGrid } from "../components/landing/StepDemos";
import DotLoader from "../components/ui/pixel/DotLoader";
import { gameSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";
import { useCurrentProfile } from "../lib/useCurrentProfile";

type Status = "connecting" | "searching" | "found" | "error";

const HANDOFF_MS = 3000;
// Practice starts at once, so the hand-off is only long enough to read it
const PRACTICE_HANDOFF_MS = 1500;
// Ranked is people only; after this long alone, offer Practice instead
const OFFER_PRACTICE_AFTER_S = 30;

const fade = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
};

/**
 * Ranked queue, or the short hand-off into a Practice match against a bot.
 * Mounted with a different `key` per mode, so switching remounts it.
 */
const RealMatchmakingPage: React.FC<{ mode?: "ranked" | "practice" }> = ({ mode = "ranked" }) => {
  const practice = mode === "practice";
  const handoffMs = practice ? PRACTICE_HANDOFF_MS : HANDOFF_MS;
  const navigate = useNavigate();
  const { username, avatarUrl } = useCurrentProfile();
  const [status, setStatus] = useState<Status>("connecting");
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<any>(null);
  const [countdown, setCountdown] = useState(Math.ceil(handoffMs / 1000));
  const queueJoinedRef = useRef(false);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let timerInterval: ReturnType<typeof setInterval> | null = null;
    let cleanupSocketListeners = () => {};
    let isCancelled = false;

    const initSocket = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        // The page may have unmounted while we waited; attaching listeners now would leak them
        if (isCancelled) return;
        if (!session) {
          setError("You are signed out. Log in again to find a match.");
          setStatus("error");
          return;
        }

        const socket = gameSocket.connect(session.access_token);

        const joinQueueOnce = () => {
          if (queueJoinedRef.current) return;
          queueJoinedRef.current = true;
          setStatus("searching");
          if (practice) gameSocket.startPractice();
          else gameSocket.joinQueue();
          timerInterval = setInterval(() => setTimer((t) => t + 1), 1000);
        };

        const handleConnect = () => joinQueueOnce();

        const handleConnectError = (err: Error) => {
          console.error("Connection error:", err);
          setError("Could not reach the match server. Check your connection and try again.");
          setStatus("error");
        };

        const handleDisconnect = () => {
          if (!queueJoinedRef.current) return;
          queueJoinedRef.current = false;
          setStatus("connecting");
          if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
          }
        };

        const handleMatchFound = (data: any) => {
          queueJoinedRef.current = false;
          setMatchData(data);
          setStatus("found");
          if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
          }
          navigationTimeoutRef.current = setTimeout(() => {
            navigate(`/game/${data.matchId}`, { state: { matchData: data } });
          }, handoffMs);
        };

        const handleError = (data: any) => {
          console.error("Socket error:", data);
          setError(data.message);
          setStatus("error");
        };

        if (socket.connected) joinQueueOnce();

        socket.on("connect", handleConnect);
        socket.on("connect_error", handleConnectError);
        socket.on("disconnect", handleDisconnect);
        socket.on("match_found", handleMatchFound);
        socket.on("error", handleError);

        cleanupSocketListeners = () => {
          socket.off("connect", handleConnect);
          socket.off("connect_error", handleConnectError);
          socket.off("disconnect", handleDisconnect);
          socket.off("match_found", handleMatchFound);
          socket.off("error", handleError);
        };
      } catch (err: any) {
        console.error("Init error:", err);
        if (isCancelled) return;
        setError(err.message);
        setStatus("error");
      }
    };

    void initSocket();

    return () => {
      isCancelled = true;
      cleanupSocketListeners();
      if (timerInterval) clearInterval(timerInterval);
      if (navigationTimeoutRef.current) clearTimeout(navigationTimeoutRef.current);
      if (queueJoinedRef.current) {
        if (!practice) gameSocket.leaveQueue();
        queueJoinedRef.current = false;
      }
    };
  }, [navigate, practice, handoffMs]);

  // Countdown shown during the hand-off to the arena
  useEffect(() => {
    if (status !== "found") return;
    setCountdown(Math.ceil(handoffMs / 1000));
    const id = setInterval(() => setCountdown((c) => Math.max(1, c - 1)), 1000);
    return () => clearInterval(id);
  }, [status, handoffMs]);

  const handleCancel = () => {
    if (navigationTimeoutRef.current) clearTimeout(navigationTimeoutRef.current);
    queueJoinedRef.current = false;
    if (!practice) gameSocket.leaveQueue();
    gameSocket.disconnect();
    navigate("/dashboard");
  };

  // Leaving ranked for practice. The unmount cleanup leaves the queue.
  const switchToPractice = () => navigate("/practice");

  // Esc leaves the queue
  useEffect(() => {
    if (status !== "searching" && status !== "connecting") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const opponentName: string = matchData?.opponent?.username || "Opponent";
  const clockText = `${String(Math.floor(timer / 60)).padStart(2, "0")}:${String(timer % 60).padStart(2, "0")}`;
  const queued = status === "searching" || status === "connecting";

  // The tab title carries the queue clock, so you can wait in another tab
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    if (status === "searching") document.title = practice ? "Practice \u00b7 Deadlock" : `${clockText} In queue \u00b7 Deadlock`;
    else if (status === "found") document.title = practice ? "Practice \u00b7 Deadlock" : "Match found \u00b7 Deadlock";
    else if (status === "connecting") document.title = "Connecting \u00b7 Deadlock";
    else document.title = "Queue error \u00b7 Deadlock";
  }, [status, clockText, practice]);

  // A short double buzz on phones when an opponent is found
  useEffect(() => {
    if (status === "found" && !practice) navigator.vibrate?.([24, 60, 24]);
  }, [status, practice]);

  const title = "text-[clamp(2.75rem,6vw,5.75rem)] font-medium leading-[0.9] tracking-[-0.06em] text-fg";
  const lead = "mt-5 max-w-[30ch] text-[clamp(1.25rem,1.8vw,1.5rem)] leading-[1.15] tracking-[-0.03em] text-fg-2";

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-2 px-4">
        <Chip className="px-2">
          <Mark /> Deadlock
        </Chip>
        {queued && (
          <button type="button" onClick={handleCancel} className="rounded-[3px]">
            <Chip k="Esc">{practice ? "Cancel" : "Leave queue"}</Chip>
          </button>
        )}
      </header>

      <main className="flex flex-1 flex-col px-4 pb-6">
        <CrossRow className="mt-3" at={[0, 50, 100]} />
        <div className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-12 lg:gap-6">
          <div className="lg:col-span-6" aria-live="polite">
            <AnimatePresence mode="wait">
              {status === "connecting" && (
                <motion.div key="connecting" {...fade}>
                  <p className="label text-fg-3">Queue</p>
                  <DotLoader pattern="ripple" size={5} cell={10} gap={4} className="mt-5 text-fg" label="Connecting" />
                  <h1 className={`mt-8 ${title}`}>Connecting</h1>
                  <p className={lead}>Reaching the match server.</p>
                  <Button variant="outline" size="lg" className="mt-10" onClick={handleCancel}>
                    Cancel <Kbd>Esc</Kbd>
                  </Button>
                </motion.div>
              )}

              {status === "searching" && practice && (
                <motion.div key="practice" {...fade}>
                  <p className="label text-fg-3">Practice</p>
                  <DotLoader pattern="ripple" size={5} cell={10} gap={4} className="mt-5 text-fg" label="Setting up" />
                  <h1 className={`mt-8 ${title}`}>Setting up practice</h1>
                  <p className={lead}>A practice bot takes the other seat. Practice is unrated.</p>
                  <Button variant="outline" size="lg" className="mt-10" onClick={handleCancel}>
                    Cancel <Kbd>Esc</Kbd>
                  </Button>
                </motion.div>
              )}

              {status === "searching" && !practice && (
                <motion.div key="searching" {...fade}>
                  <p className="label text-fg-3">In queue</p>
                  <div className="mt-5" role="timer" aria-label={`Searching for ${timer} seconds`}>
                    <PixelText text={clockText} led gap={0.16} decorative className="h-[clamp(3.5rem,8vw,6.5rem)] text-fg" />
                  </div>
                  <h1 className={`mt-8 ${title}`}>Finding an opponent</h1>
                  <p className={lead}>Ranked is always another person. You will be paired with the next player who joins.</p>
                  <div className="mt-10 flex flex-wrap gap-2">
                    <Button variant="outline" size="lg" onClick={handleCancel}>
                      Leave queue <Kbd>Esc</Kbd>
                    </Button>
                  </div>
                  {timer >= OFFER_PRACTICE_AFTER_S && (
                    <div className="mt-8 max-w-md animate-[rise-in_0.5s_var(--ease-out-expo)_both] border-t border-rule pt-5 motion-reduce:animate-none">
                      <p className="text-[15px] leading-snug text-fg-2">
                        Nobody else is in the queue right now. Warm up against a bot instead; practice games are unrated.
                      </p>
                      <Button variant="ghost" size="lg" className="mt-3 -ml-3" onClick={switchToPractice}>
                        Practice instead
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}

              {status === "found" && (
                <motion.div key="found" {...fade}>
                  <p className="label text-fg-3">{practice ? "Practice" : "Match found"}</p>
                  <h1 className={`mt-4 ${title}`}>
                    {practice ? "Warm up" : "Locked in"}
                    <span className="text-accent">.</span>
                  </h1>
                  <ul className="mt-10 border-t border-rule">
                    {[
                      { tag: "You", name: username, src: avatarUrl, dot: "bg-fg" },
                      { tag: practice ? "Bot" : "Opponent", name: opponentName, src: undefined, dot: "bg-accent" },
                    ].map((p, i) => (
                      <motion.li
                        key={p.tag}
                        initial={{ opacity: 0, x: i === 0 ? -16 : 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 + i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-4 border-b border-line py-3"
                      >
                        <span className="label flex items-center gap-2 text-fg">
                          <span className={`size-[7px] ${p.dot}`} aria-hidden="true" />
                          {p.tag}
                        </span>
                        <span className="flex min-w-0 items-center gap-3">
                          <Avatar src={p.src} name={p.name} size={32} />
                          <span className="truncate text-[clamp(1.25rem,2vw,1.75rem)] leading-tight tracking-[-0.035em] text-fg">
                            {p.name}
                          </span>
                        </span>
                      </motion.li>
                    ))}
                  </ul>
                  <div className="mt-8 flex items-end gap-4">
                    <span className="label pb-1 text-fg-2">Starting in</span>
                    <PixelText key={countdown} text={String(countdown)} intro="mount" label={`${countdown} seconds`} className="h-16 text-accent" />
                  </div>
                </motion.div>
              )}

              {status === "error" && (
                <motion.div key="error" {...fade}>
                  <p className="label text-accent-ink">Error</p>
                  <h1 className={`mt-4 ${title}`}>{practice ? "Could not start practice" : "Could not join the queue"}</h1>
                  <p className={lead}>{error}</p>
                  <div className="mt-10 flex flex-wrap gap-2">
                    <Button variant="outline" size="lg" onClick={() => navigate("/dashboard")}>
                      Back to lobby
                    </Button>
                    <Button size="lg" onClick={() => window.location.reload()}>
                      Try again
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="lg:col-span-5 lg:col-start-8">
            <Label aside={status === "found" ? <span className="text-accent-ink">Matched</span> : queued ? "Live" : "Idle"}>
              {practice ? "Practice" : "Queue"}
            </Label>
            <Figure n="Q" className="mt-4" bodyClassName="flex items-center justify-center px-5 py-10 sm:px-10 sm:py-16">
              <SearchGrid found={status === "found"} className="max-w-[460px]" />
            </Figure>
          </div>
        </div>
        <CrossRow at={[0, 50, 100]} />
      </main>
    </div>
  );
};

export default RealMatchmakingPage;
