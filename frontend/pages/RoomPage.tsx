import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Copy, ShareNetwork } from "@phosphor-icons/react";
import Avatar from "../components/ui/Avatar";
import Dialog from "../components/ui/Dialog";
import { Mark } from "../components/ui/Wordmark";
import { Button, ButtonLink, Kbd } from "../components/ui/Button";
import { Chip, ChipLink, CrossRow, Figure, Label, Tag } from "../components/ui/Chrome";
import { Swap } from "../components/ui/micro";
import PixelText from "../components/ui/pixel/PixelText";
import DotLoader from "../components/ui/pixel/DotLoader";
import { SearchGrid } from "../components/landing/StepDemos";
import { useAuth } from "../contexts/AuthContext";
import { gameSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";
import { useCurrentProfile } from "../lib/useCurrentProfile";
import { useShortcuts } from "../lib/useShortcuts";
import { fetchRoomPreview, isRoomRefusal, roomUrl, type RoomPreview, type RoomSeat, type RoomView } from "../lib/rooms";
import { clearReturnTo, rememberReturnTo } from "../lib/returnTo";
import type { MatchFoundPayload } from "../types";

const HANDOFF_MS = 3000;

// Server errors about this room that belong on this page
const ROOM_NOTICES = new Set(["PLAYER_BUSY", "ROOM_START_FAILED", "ROOM_BUSY", "ROOM_CLOSED", "NOT_IN_ROOM"]);

type Phase =
  | { kind: "loading" }
  | { kind: "preview"; preview: RoomPreview }
  | { kind: "room"; room: RoomView }
  | { kind: "starting"; match: MatchFoundPayload }
  | { kind: "full"; preview?: RoomPreview }
  | { kind: "gone"; reason: "missing" | "closed" }
  | { kind: "error"; message: string };

const fade = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
};

const title = "text-[clamp(2.75rem,6vw,5.75rem)] font-medium leading-[0.9] tracking-[-0.06em] text-fg";
const lead = "mt-5 max-w-[34ch] text-[clamp(1.25rem,1.8vw,1.5rem)] leading-[1.15] tracking-[-0.03em] text-fg-2";

/**
 * Duel room: challenge a friend with a link.
 *
 * /duel opens (or reopens) your room and lands on /duel/CODE. Anyone with the
 * link can take the empty seat; signed-out visitors see who invited them and
 * come back here after signing up. When both players are ready the server
 * starts an unrated match, and the room keeps score across rematches.
 */
const RoomPage: React.FC = () => {
  const { code: rawCode } = useParams<{ code?: string }>();
  const code = rawCode?.toUpperCase();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { username, avatarUrl } = useCurrentProfile();
  const userId = user?.id;

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [countdown, setCountdown] = useState(HANDOFF_MS / 1000);
  // "Rematch" from the result screen arrives ready
  const autoReadyRef = useRef(!!(location.state as { autoReady?: boolean } | null)?.autoReady);

  // Signed out: show the invite and who sent it
  useEffect(() => {
    if (authLoading || userId) return;
    if (!code) {
      navigate("/auth", { replace: true });
      return;
    }
    let cancelled = false;
    fetchRoomPreview(code)
      .then((preview) => {
        if (cancelled) return;
        if (!preview) setPhase({ kind: "gone", reason: "missing" });
        else if (preview.status === "closed") setPhase({ kind: "gone", reason: "closed" });
        else if (preview.guest) setPhase({ kind: "full", preview });
        else setPhase({ kind: "preview", preview });
      })
      .catch(() => !cancelled && setPhase({ kind: "error", message: "Could not reach the match server. Check your connection and try again." }));
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, code, navigate]);

  // Signed in: open or join the room over the socket
  useEffect(() => {
    if (authLoading || !userId) return;
    let cancelled = false;
    let cleanup = () => {};
    let handoff: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) {
        setPhase({ kind: "error", message: "You are signed out. Log in again to open the room." });
        return;
      }
      const socket = gameSocket.connect(session.access_token);

      const enter = async () => {
        try {
          if (!code) {
            const res = await gameSocket.createRoom();
            if (cancelled) return;
            if (isRoomRefusal(res)) setPhase({ kind: "error", message: res.message });
            else navigate(`/duel/${res.room.code}`, { replace: true });
            return;
          }
          const res = await gameSocket.joinRoom(code);
          if (cancelled) return;
          if (isRoomRefusal(res)) {
            if (res.code === "ROOM_FULL") setPhase({ kind: "full", preview: res.preview });
            else if (res.code === "ROOM_NOT_FOUND" || res.code === "ROOM_CLOSED")
              setPhase({ kind: "gone", reason: res.code === "ROOM_CLOSED" ? "closed" : "missing" });
            else setPhase({ kind: "error", message: res.message });
          } else {
            clearReturnTo();
            setPhase((p) => (p.kind === "starting" ? p : { kind: "room", room: res.room }));
            if (autoReadyRef.current) {
              autoReadyRef.current = false;
              if (!res.room.activeMatchId) gameSocket.setRoomReady(code, true);
              // A refresh should not ready you up again
              navigate(`/duel/${code}`, { replace: true, state: null });
            }
          }
        } catch {
          if (!cancelled && !socket.connected) setConnectionLost(true);
          else if (!cancelled) setPhase({ kind: "error", message: "The match server did not answer. Try again." });
        }
      };

      const onConnect = () => {
        setConnectionLost(false);
        void enter();
      };
      const onDisconnect = () => setConnectionLost(true);
      const onUpdate = (room: RoomView) => {
        if (room.code !== code) return;
        setPhase((p) => (p.kind === "starting" ? p : { kind: "room", room }));
      };
      const onClosed = (data: { code: string }) => {
        if (data.code === code) setPhase({ kind: "gone", reason: "closed" });
      };
      const onMatchFound = (data: MatchFoundPayload) => {
        if (!code || data.roomCode !== code) return;
        setNotice(null);
        setPhase({ kind: "starting", match: data });
        handoff = setTimeout(() => navigate(`/game/${data.matchId}`, { state: { matchData: data } }), HANDOFF_MS);
      };
      const onError = (data: { message: string; code?: string }) => {
        if (data.code && ROOM_NOTICES.has(data.code)) setNotice(data.message);
      };

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("room_update", onUpdate);
      socket.on("room_closed", onClosed);
      socket.on("match_found", onMatchFound);
      socket.on("error", onError);
      if (socket.connected) void enter();

      cleanup = () => {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
        socket.off("room_update", onUpdate);
        socket.off("room_closed", onClosed);
        socket.off("match_found", onMatchFound);
        socket.off("error", onError);
      };
    };

    void run();
    return () => {
      cancelled = true;
      cleanup();
      if (handoff) clearTimeout(handoff);
      // The seat is kept; only stop following the room
      if (code) gameSocket.unwatchRoom(code);
    };
  }, [authLoading, userId, code, navigate]);

  const room = phase.kind === "room" ? phase.room : null;
  const mySeat: "host" | "guest" | null = room ? (room.host.id === userId ? "host" : room.guest?.id === userId ? "guest" : null) : null;
  const me: RoomSeat | null = room && mySeat ? room[mySeat] : null;
  const opponent: RoomSeat | null = room && mySeat ? (mySeat === "host" ? room.guest : room.host) : null;
  const inMyMatch = !!room?.activeMatchId && !!mySeat;
  const url = code ? roomUrl(code) : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // A notice is about the last attempt; it goes stale once the room moves on
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // Countdown into the arena
  useEffect(() => {
    if (phase.kind !== "starting") return;
    setCountdown(HANDOFF_MS / 1000);
    const id = setInterval(() => setCountdown((c) => Math.max(1, c - 1)), 1000);
    return () => clearInterval(id);
  }, [phase.kind]);

  // A short buzz on phones when your friend shows up, a double one when the duel starts
  const opponentOnline = !!opponent?.online;
  useEffect(() => {
    if (opponentOnline) navigator.vibrate?.(24);
  }, [opponentOnline]);
  useEffect(() => {
    if (phase.kind === "starting") navigator.vibrate?.([24, 60, 24]);
  }, [phase.kind]);

  // Tab title, so the host can wait in another tab
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    if (phase.kind === "starting") document.title = "Starting · Deadlock";
    else if (room && opponent?.online) document.title = `${opponent.username} is here · Deadlock`;
    else if (room) document.title = `Room ${room.code} · Deadlock`;
    else if (phase.kind === "preview") document.title = `${phase.preview.host.username} challenged you · Deadlock`;
    else document.title = "Duel room · Deadlock";
  }, [phase, room, opponent?.online, opponent?.username]);

  const toggleReady = () => {
    if (!code || !me || inMyMatch) return;
    setNotice(null);
    gameSocket.setRoomReady(code, !me.ready);
  };

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable: the link is on screen to copy by hand */
    }
  };

  const shareLink = async () => {
    try {
      await navigator.share({ title: "Deadlock duel", text: `${username} challenged you to a coding duel on Deadlock.`, url });
    } catch {
      /* dismissed */
    }
  };

  const leave = () => {
    if (!code) return;
    setConfirmClose(false);
    gameSocket.leaveRoom(code);
    navigate("/dashboard");
  };

  const goSignUp = (mode: "signup" | "login") => {
    if (code) rememberReturnTo(`/duel/${code}`);
    navigate(mode === "signup" ? "/auth?mode=signup" : "/auth");
  };

  useShortcuts(
    {
      r: toggleReady,
      c: () => {
        if (mySeat === "host") void copyLink();
      },
    },
    phase.kind === "room" && !!mySeat
  );

  const signedIn = !!userId;
  const backTo = signedIn ? "/dashboard" : "/";

  const seatRow = (seat: RoomSeat | null, tag: string, dot: string, i: number, isMe: boolean) => (
    <motion.li
      key={tag}
      initial={{ opacity: 0, x: i === 0 ? -16 : 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 + i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-3 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:gap-4"
    >
      <span className="label flex items-center gap-2 text-fg">
        <span className={`size-[7px] ${dot}`} aria-hidden="true" />
        {tag}
      </span>
      {seat ? (
        <>
          <span className="flex min-w-0 items-center gap-3">
            <Avatar src={isMe ? avatarUrl : undefined} name={seat.username} size={32} />
            <span className="truncate text-[clamp(1.25rem,2vw,1.75rem)] leading-tight tracking-[-0.035em] text-fg">{seat.username}</span>
            {isMe && <span className="label shrink-0 text-fg-3">You</span>}
          </span>
          {inMyMatch ? (
            <Tag>In duel</Tag>
          ) : !seat.online ? (
            <Tag tone="warn">Away</Tag>
          ) : seat.ready ? (
            <Tag tone="pass">Ready</Tag>
          ) : (
            <Tag>Not ready</Tag>
          )}
        </>
      ) : (
        <>
          <span className="flex min-w-0 items-center gap-3 text-fg-3">
            <DotLoader pattern="orbit" />
            <span className="truncate text-[clamp(1.25rem,2vw,1.75rem)] leading-tight tracking-[-0.035em]">Waiting for a friend</span>
          </span>
          <span />
        </>
      )}
    </motion.li>
  );

  const startOver = (
    <div className="mt-10 flex flex-wrap gap-2">
      {signedIn ? (
        <>
          <ButtonLink to="/duel" variant="accent" size="lg" className="group">
            Open your own room
            <ArrowRight weight="bold" className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
          </ButtonLink>
          <ButtonLink to="/dashboard" variant="outline" size="lg">
            Back to lobby
          </ButtonLink>
        </>
      ) : (
        <>
          <ButtonLink to="/auth?mode=signup" variant="accent" size="lg" className="group">
            Play Deadlock
            <ArrowRight weight="bold" className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
          </ButtonLink>
          <ButtonLink to="/" variant="outline" size="lg">
            Home
          </ButtonLink>
        </>
      )}
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-2 px-4">
        <Link to={backTo} className="rounded-[3px]" aria-label={signedIn ? "Lobby" : "Deadlock home"}>
          <Chip className="px-2">
            <Mark /> Deadlock
          </Chip>
        </Link>
        {signedIn && phase.kind !== "starting" && <ChipLink to="/dashboard">Lobby</ChipLink>}
      </header>

      {connectionLost && (
        <div role="status" className="flex items-center gap-3 border-y border-rule bg-bg-2 px-4 py-2">
          <DotLoader pattern="orbit" className="text-accent" />
          <span className="label text-fg">Connection lost. Reconnecting; your seat is held.</span>
        </div>
      )}

      <main className="flex flex-1 flex-col px-4 pb-6">
        <CrossRow className="mt-3" at={[0, 50, 100]} />
        <div className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-12 lg:gap-6">
          <div className="lg:col-span-6" aria-live="polite">
            <AnimatePresence mode="wait">
              {phase.kind === "loading" && (
                <motion.div key="loading" {...fade}>
                  <p className="label text-fg-3">Friend duel</p>
                  <DotLoader pattern="ripple" size={5} cell={10} gap={4} className="mt-5 text-fg" label="Opening the room" />
                  <h1 className={`mt-8 ${title}`}>{code ? "Joining the room" : "Opening your room"}</h1>
                  <p className={lead}>Reaching the match server.</p>
                </motion.div>
              )}

              {phase.kind === "preview" && (
                <motion.div key="preview" {...fade}>
                  <p className="label text-fg-3">Friend duel &middot; Room {phase.preview.code}</p>
                  <h1 className={`mt-4 ${title}`}>
                    {phase.preview.host.username} challenged you<span className="text-accent">.</span>
                  </h1>
                  <p className={lead}>
                    A 1v1 coding race: the same problem on the same clock, and the first to pass every test wins. Sign up free to
                    take the seat.
                  </p>
                  {phase.preview.host.online && (
                    <p className="label mt-6 flex items-center gap-2 text-pass-ink">
                      <span className="size-[7px] bg-pass" aria-hidden="true" />
                      {phase.preview.host.username} is in the room now
                    </p>
                  )}
                  <div className="mt-10 flex flex-wrap gap-2">
                    <Button variant="accent" size="lg" className="group" onClick={() => goSignUp("signup")}>
                      Sign up to accept
                      <ArrowRight weight="bold" className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </Button>
                    <Button variant="outline" size="lg" onClick={() => goSignUp("login")}>
                      I have an account
                    </Button>
                  </div>
                </motion.div>
              )}

              {phase.kind === "room" && room && (
                <motion.div key="room" {...fade}>
                  <p className="label text-fg-3">Friend duel &middot; Room {room.code}</p>
                  <h1 className={`mt-4 ${title}`}>
                    {inMyMatch
                      ? "Duel in progress"
                      : mySeat === "guest"
                        ? `${room.host.username} challenged you`
                        : opponent
                          ? opponent.online
                            ? `${opponent.username} is here`
                            : `${opponent.username} stepped away`
                          : "Invite a friend"}
                    <span className="text-accent">.</span>
                  </h1>
                  <p className={lead}>
                    {inMyMatch
                      ? "Your match is still running. Jump back in before the clock runs down."
                      : opponent
                        ? "Same problem, same clock. First to pass every test takes the round. Friend duels are unrated."
                        : "Send them this link. The duel starts as soon as you are both ready."}
                  </p>

                  {mySeat === "host" && !inMyMatch && (
                    <div className="mt-8 max-w-xl">
                      <div className="flex items-stretch gap-[3px]">
                        <div className="flex h-12 min-w-0 flex-1 items-center rounded-[3px] border border-line bg-bg px-3">
                          <span className="truncate font-mono text-[13px] text-fg sm:text-[14px]" title={url}>
                            {url.replace(/^https?:\/\//, "")}
                          </span>
                        </div>
                        <Button variant="primary" size="lg" onClick={copyLink} aria-label={copied ? "Link copied" : "Copy invite link"} className="px-4 sm:px-5">
                          <Swap on={copied} off={<Copy className="size-4" />} onNode={<Check weight="bold" className="size-4" />} />
                          <span className="hidden sm:inline">
                            <Swap on={copied} off="Copy" onNode="Copied" align="start" />
                          </span>
                          <Kbd>C</Kbd>
                        </Button>
                        {canShare && (
                          <Button variant="outline" size="lg" onClick={shareLink} aria-label="Share invite link" className="px-4">
                            <ShareNetwork className="size-4" weight="bold" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  <ul className="mt-10 border-t border-rule">
                    {seatRow(room.host, "Host", "bg-fg", 0, mySeat === "host")}
                    {seatRow(room.guest, "Guest", "bg-accent", 1, mySeat === "guest")}
                  </ul>

                  {mySeat && (
                    <div className="mt-8 flex flex-wrap items-center gap-2">
                      {inMyMatch ? (
                        <Button variant="accent" size="lg" autoFocus onClick={() => navigate(`/game/${room.activeMatchId}`)}>
                          Rejoin duel
                        </Button>
                      ) : me?.ready ? (
                        <Button variant="outline" size="lg" onClick={toggleReady}>
                          Not ready <Kbd>R</Kbd>
                        </Button>
                      ) : (
                        <Button variant="accent" size="lg" autoFocus onClick={toggleReady}>
                          Ready <Kbd>R</Kbd>
                        </Button>
                      )}
                      {!inMyMatch && (
                        <Button
                          variant="ghost"
                          size="lg"
                          onClick={() => (mySeat === "host" ? setConfirmClose(true) : leave())}
                        >
                          {mySeat === "host" ? "Close room" : "Leave room"}
                        </Button>
                      )}
                    </div>
                  )}
                  <p className="label mt-4 min-h-[1.2em] text-fg-3" role="status">
                    {notice ? (
                      <span className="text-accent-ink">{notice}</span>
                    ) : me?.ready && !inMyMatch ? (
                      opponent?.ready ? "Starting" : opponent ? `Waiting for ${opponent.username} to get ready` : "Ready. Waiting for a friend to join."
                    ) : null}
                  </p>
                </motion.div>
              )}

              {phase.kind === "starting" && (
                <motion.div key="starting" {...fade}>
                  <p className="label text-fg-3">Friend duel</p>
                  <h1 className={`mt-4 ${title}`}>
                    Locked in<span className="text-accent">.</span>
                  </h1>
                  <ul className="mt-10 border-t border-rule">
                    {[
                      { tag: "You", name: username, src: avatarUrl, dot: "bg-fg" },
                      { tag: "Friend", name: phase.match.opponent.username, src: undefined, dot: "bg-accent" },
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
                          <span className="truncate text-[clamp(1.25rem,2vw,1.75rem)] leading-tight tracking-[-0.035em] text-fg">{p.name}</span>
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

              {phase.kind === "full" && (
                <motion.div key="full" {...fade}>
                  <p className="label text-fg-3">Friend duel</p>
                  <h1 className={`mt-4 ${title}`}>This room is full</h1>
                  <p className={lead}>
                    {phase.preview?.guest
                      ? `${phase.preview.host.username} and ${phase.preview.guest.username} are already dueling.`
                      : "Two players already have the seats."}{" "}
                    Open a room of your own and send the link to a friend.
                  </p>
                  {startOver}
                </motion.div>
              )}

              {phase.kind === "gone" && (
                <motion.div key="gone" {...fade}>
                  <p className="label text-fg-3">Friend duel</p>
                  <h1 className={`mt-4 ${title}`}>{phase.reason === "closed" ? "The host closed this room" : "This invite has expired"}</h1>
                  <p className={lead}>
                    {phase.reason === "closed"
                      ? "Rooms end when the host closes them."
                      : "Rooms close after a few hours without a game, or the link is mistyped."}{" "}
                    Open your own and send the link to a friend.
                  </p>
                  {startOver}
                </motion.div>
              )}

              {phase.kind === "error" && (
                <motion.div key="error" {...fade}>
                  <p className="label text-accent-ink">Error</p>
                  <h1 className={`mt-4 ${title}`}>Could not open the room</h1>
                  <p className={lead}>{phase.message}</p>
                  <div className="mt-10 flex flex-wrap gap-2">
                    <ButtonLink to={backTo} variant="outline" size="lg">
                      {signedIn ? "Back to lobby" : "Home"}
                    </ButtonLink>
                    <Button size="lg" onClick={() => window.location.reload()}>
                      Try again
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="lg:col-span-5 lg:col-start-8">
            <Label aside={room?.guest ? "Unrated" : phase.kind === "starting" ? <span className="text-accent-ink">Starting</span> : "Waiting"}>
              {room?.guest ? "Score" : "Room"}
            </Label>
            <Figure n="R" className="mt-4" bodyClassName="flex flex-col items-center justify-center gap-6 px-5 py-10 sm:px-10 sm:py-16">
              {room?.guest && me && opponent ? (
                <>
                  <PixelText
                    key={`${me.wins}:${opponent.wins}`}
                    text={`${me.wins}:${opponent.wins}`}
                    led
                    gap={0.16}
                    intro="mount"
                    label={`You ${me.wins}, ${opponent.username} ${opponent.wins}`}
                    className="h-[clamp(4rem,9vw,7rem)] text-fg"
                  />
                  <div className="label grid w-full max-w-[420px] grid-cols-2 gap-4 text-fg-2" aria-hidden="true">
                    <span className="truncate">You</span>
                    <span className="truncate text-right normal-case">{opponent.username}</span>
                  </div>
                </>
              ) : (
                <SearchGrid found={phase.kind === "starting" || !!room?.guest} className="max-w-[460px]" />
              )}
            </Figure>
          </div>
        </div>
        <CrossRow at={[0, 50, 100]} />
      </main>

      <Dialog open={confirmClose} onClose={() => setConfirmClose(false)} eyebrow="Room" title="Close this room?">
        <p className="mt-4 text-[16px] leading-snug text-fg-2">
          The invite link stops working{opponent ? ` and ${opponent.username} loses their seat` : ""}. You can open a new room any time.
        </p>
        <div className="mt-8 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmClose(false)}>
            Keep it open
          </Button>
          <Button variant="danger" onClick={leave}>
            Close room
          </Button>
        </div>
      </Dialog>
    </div>
  );
};

export default RoomPage;
