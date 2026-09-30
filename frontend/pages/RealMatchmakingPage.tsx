import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { WarningCircle } from "@phosphor-icons/react";
import Avatar from "../components/ui/Avatar";
import Wordmark from "../components/ui/Wordmark";
import { Button, Kbd } from "../components/ui/Button";
import { gameSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";
import { useCurrentProfile } from "../lib/useCurrentProfile";
import { formatClock } from "../lib/format";

type Status = "connecting" | "searching" | "found" | "error";

const HANDOFF_MS = 3000;

const fade = {
  initial: { opacity: 0, y: 12, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -8, filter: "blur(4px)" },
  transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
};

const RealMatchmakingPage: React.FC = () => {
  const navigate = useNavigate();
  const { username, avatarUrl } = useCurrentProfile();
  const [status, setStatus] = useState<Status>("connecting");
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<any>(null);
  const [countdown, setCountdown] = useState(Math.round(HANDOFF_MS / 1000));
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
          gameSocket.joinQueue();
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
          }, HANDOFF_MS);
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
        gameSocket.leaveQueue();
        queueJoinedRef.current = false;
      }
    };
  }, [navigate]);

  // Countdown shown during the hand-off to the arena
  useEffect(() => {
    if (status !== "found") return;
    setCountdown(Math.round(HANDOFF_MS / 1000));
    const id = setInterval(() => setCountdown((c) => Math.max(1, c - 1)), 1000);
    return () => clearInterval(id);
  }, [status]);

  const handleCancel = () => {
    if (navigationTimeoutRef.current) clearTimeout(navigationTimeoutRef.current);
    queueJoinedRef.current = false;
    gameSocket.leaveQueue();
    gameSocket.disconnect();
    navigate("/dashboard");
  };

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

  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden">
      {/* Search pulse: rings expand while searching, settle into a solid ring once matched */}
      <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center pb-[18vh]" aria-hidden="true">
        <div className="relative size-[min(56vw,340px)]">
          {status === "searching" || status === "connecting" ? (
            [0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute inset-0 animate-[queue-pulse_3s_var(--ease-out-expo)_infinite] rounded-full border border-accent/40 motion-reduce:animate-none motion-reduce:opacity-40"
                style={{ animationDelay: `${i}s` }}
              />
            ))
          ) : status === "found" ? (
            <span className="absolute inset-[18%] rounded-full border-2 border-accent/70 shadow-[0_0_80px_-10px_rgb(229_72_77/0.6)]" />
          ) : null}
          <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgb(229_72_77/0.08),transparent)]" />
      </div>

      <header className="flex h-16 items-center justify-center">
        <Wordmark className="text-[17px] text-fg" />
      </header>

      <main className="flex flex-1 flex-col items-center justify-end px-5 pb-16 text-center sm:pb-24" aria-live="polite">
        <AnimatePresence mode="wait">
          {status === "connecting" && (
            <motion.div key="connecting" {...fade} className="flex flex-col items-center">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg sm:text-3xl">Connecting</h1>
              <p className="mt-2 text-[15px] text-fg-2">Reaching the match server.</p>
              <Button variant="secondary" className="mt-8" onClick={handleCancel}>
                Cancel <Kbd>Esc</Kbd>
              </Button>
            </motion.div>
          )}

          {status === "searching" && (
            <motion.div key="searching" {...fade} className="flex flex-col items-center">
              <p className="tabular font-mono text-5xl font-medium tracking-[-0.03em] text-fg sm:text-6xl" aria-label={`Searching for ${timer} seconds`}>
                {formatClock(timer)}
              </p>
              <h1 className="mt-4 text-xl font-medium tracking-[-0.01em] text-fg sm:text-2xl">Finding an opponent</h1>
              <p className="mt-2 max-w-[36ch] text-[15px] leading-relaxed text-fg-2">
                You will be paired with the next player who joins the queue.
              </p>
              <Button variant="secondary" className="mt-8" onClick={handleCancel}>
                Leave queue <Kbd>Esc</Kbd>
              </Button>
            </motion.div>
          )}

          {status === "found" && (
            <motion.div key="found" {...fade} className="flex w-full max-w-md flex-col items-center">
              <h1 className="text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-4xl">Match found</h1>
              <div className="mt-8 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4">
                <motion.div
                  initial={{ x: -24, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.1 }}
                  className="flex flex-col items-center gap-2"
                >
                  <Avatar src={avatarUrl} name={username} size={56} />
                  <span className="max-w-full truncate text-sm text-fg">{username}</span>
                </motion.div>
                <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg-3">vs</span>
                <motion.div
                  initial={{ x: 24, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.18 }}
                  className="flex flex-col items-center gap-2"
                >
                  <Avatar name={opponentName} size={56} />
                  <span className="max-w-full truncate text-sm text-fg">{opponentName}</span>
                </motion.div>
              </div>
              <p className="mt-8 text-[15px] text-fg-2">
                Starting in <span className="tabular font-mono text-fg">{countdown}</span>
              </p>
            </motion.div>
          )}

          {status === "error" && (
            <motion.div key="error" {...fade} className="flex max-w-sm flex-col items-center">
              <WarningCircle className="size-9 text-accent-text" weight="duotone" aria-hidden="true" />
              <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-fg">Could not join the queue</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{error}</p>
              <div className="mt-8 flex gap-2">
                <Button variant="secondary" onClick={() => navigate("/dashboard")}>
                  Back to lobby
                </Button>
                <Button onClick={() => window.location.reload()}>Try again</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

export default RealMatchmakingPage;
