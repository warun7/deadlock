import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowCounterClockwise,
  CaretUp,
  CheckCircle,
  Flag,
  Info,
  Play,
  XCircle,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import CodeEditor from "./CodeEditor";
import TestPips from "./arena/TestPips";
import Avatar from "./ui/Avatar";
import Dialog from "./ui/Dialog";
import { Mark } from "./ui/Wordmark";
import { Button, Kbd } from "./ui/Button";
import { Chip, Label, Tag } from "./ui/Chrome";
import PixelText from "./ui/pixel/PixelText";
import DotLoader from "./ui/pixel/DotLoader";
import { PixelBurst } from "./ui/micro";
import { motion } from "framer-motion";
import { gameSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { invalidateCurrentProfile, useCurrentProfile } from "../lib/useCurrentProfile";
import type { MatchFoundPayload } from "../types";

// Codeforces uses $$$...$$$ for inline math; KaTeX expects $...$.
// Section markers like "-----Input-----" become headings.
const convertCodeforcesMath = (text: string): string => {
  if (!text) return "";
  return text
    .replace(/\$\$\$([^$]+)\$\$\$/g, "$$$1$")
    .replace(/^\s*-{3,}\s*([A-Za-z][A-Za-z ]{0,30}?)\s*-{3,}\s*$/gm, "\n### $1\n");
};

const LANGUAGE_IDS = { python: 71, javascript: 63, cpp: 54 } as const;
type Language = keyof typeof LANGUAGE_IDS;
const LANGUAGES: { id: Language; label: string }[] = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "cpp", label: "C++" },
];

const STARTER_CODE: Record<Language, string> = {
  python: `import sys


def main():
    data = sys.stdin.read().split()
    # Write your solution here


if __name__ == "__main__":
    main()
`,
  javascript: `const data = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/);

// Write your solution here
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    // Write your solution here

    return 0;
}
`,
};

// Hidden tests arrive as { testIndex, passed, status, hidden: true } only; the
// server never sends their input, output or expected answer.
type TestResult = {
  testIndex: number;
  passed: boolean;
  status: string;
  hidden?: boolean;
  stdout?: string;
  expected?: string;
  message?: string;
};
type SubmissionResult = {
  status: string;
  passed: number;
  total: number;
  stderr?: string;
  testResults?: TestResult[];
};

const STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted",
  wrong_answer: "Wrong answer",
  runtime_error: "Runtime error",
  time_limit: "Time limit exceeded",
  compile_error: "Compilation error",
};

/** Server status strings carry emoji ("❌ Failed"); strip them and map to plain labels. */
function describeOpponent(raw: string | null): string {
  if (!raw) return "No submissions yet";
  const s = raw.replace(/[^\x20-\x7E]/g, "").trim().replace(/\.\.\.$/, "").replace(/!$/, "");
  switch (s.toLowerCase()) {
    case "testing":
      return "Running tests";
    case "checking":
      return "Checking";
    case "failed":
      return "Last submission failed";
    case "solved":
      return "Solved";
    case "error":
      return "Submission errored";
    case "disconnected":
      return "Disconnected, waiting for them";
    case "reconnected":
      return "Back online";
    default:
      return s || "No submissions yet";
  }
}

const draftKey = (matchId: string, lang: Language) => `deadlock:draft:${matchId}:${lang}`;
const langKey = (matchId: string) => `deadlock:lang:${matchId}`;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage full or blocked: drafts just won't persist */
  }
}
function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const WIN_BURST = ["var(--pass)", "var(--fg)", "var(--pass)"];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

type MobileTab = "problem" | "code";

const RealGameArena: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { matchId } = useParams<{ matchId: string }>();
  const { user } = useAuth();
  const { username, avatarUrl } = useCurrentProfile();
  const matchData = location.state?.matchData as MatchFoundPayload | undefined;

  const userIdRef = useRef<string | undefined>(user?.id);
  userIdRef.current = user?.id;

  // Editor state, persisted per match + language so a refresh or reconnect keeps your work
  const [language, setLanguage] = useState<Language>(() => {
    const saved = matchId ? (safeGet(langKey(matchId)) as Language | null) : null;
    return saved && saved in LANGUAGE_IDS ? saved : "python";
  });
  const [drafts, setDrafts] = useState<Record<Language, string>>(() => {
    const out = { ...STARTER_CODE };
    if (matchId) {
      (Object.keys(STARTER_CODE) as Language[]).forEach((l) => {
        const saved = safeGet(draftKey(matchId, l));
        if (saved != null) out[l] = saved;
      });
    }
    return out;
  });
  const code = drafts[language];
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mobileTab, setMobileTab] = useState<MobileTab>("problem");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const [opponentStatus, setOpponentStatus] = useState<string | null>(null);
  const [opponentTests, setOpponentTests] = useState<{ passed: number; total: number } | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [gameOverReason, setGameOverReason] = useState("");
  const [finalSeconds, setFinalSeconds] = useState<number | null>(null);
  const [showForfeitModal, setShowForfeitModal] = useState(false);
  const [ratingResult, setRatingResult] = useState<{ change: number; rating: number } | null>(null);
  const [practiceResult, setPracticeResult] = useState(false);
  const [opponentDeadline, setOpponentDeadline] = useState<number | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const playAgainRef = useRef<HTMLButtonElement>(null);

  const [currentMatchData, setCurrentMatchData] = useState<MatchFoundPayload | null>(matchData ?? null);
  const [isLoading, setIsLoading] = useState(!matchData);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Clock
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (gameOver) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [gameOver]);
  const elapsed = currentMatchData?.startTime ? Math.max(0, (now - currentMatchData.startTime) / 1000) : 0;

  // Results panel (resizable with mouse or touch)
  const [resultsHeight, setResultsHeight] = useState(200);
  const [resultsCollapsed, setResultsCollapsed] = useState(true);
  const editorPanelRef = useRef<HTMLDivElement>(null);

  const onResizeStart = (e: React.PointerEvent) => {
    const panel = editorPanelRef.current;
    if (!panel) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setResultsCollapsed(false);
    const onMove = (ev: PointerEvent) => {
      const rect = panel.getBoundingClientRect();
      const next = Math.min(rect.height * 0.75, Math.max(120, rect.bottom - ev.clientY));
      setResultsHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Socket: rejoin, results, opponent progress, game over
  useEffect(() => {
    let cleanupSocketListeners = () => {};
    let isCancelled = false;

    if (matchData) {
      setCurrentMatchData(matchData);
      setIsLoading(false);
    }

    if (!matchId) {
      navigate("/dashboard");
      return;
    }

    const initSocket = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        navigate("/auth");
        return;
      }
      let socket = gameSocket.getSocket();
      if (!socket?.connected) socket = gameSocket.connect(token);
      return socket;
    };

    const setupSocket = async () => {
      const socket = await initSocket();
      if (!socket || isCancelled) return;

      const handleMatchFound = (data: MatchFoundPayload) => {
        setCurrentMatchData(data);
        setIsLoading(false);
        setLoadError(null);
        setSocketError(null);
      };

      const handleSubmissionResult = (result: SubmissionResult) => {
        setSubmissionResult(result);
        setIsSubmitting(false);
        setSocketError(null);
        setResultsCollapsed(false);
      };

      // The server broadcasts progress to the whole room, including our own submissions
      const handleOpponentProgress = (data: {
        playerId?: string;
        status: string;
        testsProgress?: string;
        reconnectDeadline?: number;
      }) => {
        if (data.playerId && data.playerId === userIdRef.current) return;
        setOpponentStatus(data.status);
        setOpponentDeadline(data.reconnectDeadline ?? null);
        const m = data.testsProgress?.match(/^(\d+)\/(\d+)$/);
        if (m) setOpponentTests({ passed: Number(m[1]), total: Number(m[2]) });
      };

      const handleGameOver = (data: {
        winnerId: string | null;
        reason?: string;
        ratingChange?: number;
        newRating?: number;
        practice?: boolean;
      }) => {
        setGameOver(true);
        setPracticeResult(!!data.practice);
        setOpponentDeadline(null);
        if (typeof data.ratingChange === "number" && typeof data.newRating === "number") {
          setRatingResult({ change: data.ratingChange, rating: data.newRating });
        }
        // Stats and rating changed: make the lobby and profile fetch them again
        invalidateCurrentProfile();
        setShowResult(true);
        setIsSubmitting(false);
        setWinner(data.winnerId);
        let displayReason = data.reason || "Match ended";
        const isWinner = data.winnerId === userIdRef.current;
        if (displayReason === "Opponent disconnected" && !isWinner) displayReason = "You disconnected";
        setGameOverReason(displayReason);
      };

      const handleError = (data: { message: string; code?: string }) => {
        console.error("Socket error:", data);
        setIsSubmitting(false);
        if (data.code === "MATCH_NOT_FOUND" || data.code === "MATCH_ENDED") {
          setLoadError(data.message);
          setIsLoading(false);
        } else if (data.code !== "NOT_PARTICIPANT") {
          setSocketError(data.message);
        }
      };

      const handleConnect = () => {
        gameSocket.rejoinMatch(matchId);
        socket.off("connect", handleConnect);
      };

      // The server holds the match while we are away; say so instead of looking frozen
      const handleDisconnect = () => setConnectionLost(true);
      const handleReconnect = () => setConnectionLost(false);
      socket.on("disconnect", handleDisconnect);
      socket.on("connect", handleReconnect);

      socket.on("match_found", handleMatchFound);
      socket.on("submission_result", handleSubmissionResult);
      socket.on("opponent_progress", handleOpponentProgress);
      socket.on("game_over", handleGameOver);
      socket.on("error", handleError);

      if (socket.connected) gameSocket.rejoinMatch(matchId);
      else socket.on("connect", handleConnect);

      cleanupSocketListeners = () => {
        socket.off("disconnect", handleDisconnect);
        socket.off("connect", handleReconnect);
        socket.off("match_found", handleMatchFound);
        socket.off("submission_result", handleSubmissionResult);
        socket.off("opponent_progress", handleOpponentProgress);
        socket.off("game_over", handleGameOver);
        socket.off("error", handleError);
        socket.off("connect", handleConnect);
      };
    };

    void setupSocket();
    return () => {
      isCancelled = true;
      cleanupSocketListeners();
    };
  }, [matchId, matchData, navigate]);

  // The Submit button shows the verdict for a moment after each run
  const [flash, setFlash] = useState<"pass" | "fail" | null>(null);
  useEffect(() => {
    if (!submissionResult) return;
    setFlash(submissionResult.status === "accepted" ? "pass" : "fail");
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [submissionResult]);

  // Ping the rival's marker whenever their progress changes
  const [oppPing, setOppPing] = useState(0);
  useEffect(() => {
    if (opponentStatus === null && !opponentTests) return;
    setOppPing((n) => n + 1);
  }, [opponentStatus, opponentTests?.passed]);

  // Freeze the clock and clear saved drafts once the match is decided
  useEffect(() => {
    if (!gameOver) return;
    setFinalSeconds(elapsed);
    // A little celebration buzz on phones for a win, one tap otherwise
    navigator.vibrate?.(winner !== null && winner === userIdRef.current ? [30, 50, 30, 50, 70] : 60);
    if (matchId) {
      (Object.keys(LANGUAGE_IDS) as Language[]).forEach((l) => safeRemove(draftKey(matchId, l)));
      safeRemove(langKey(matchId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver]);

  const handleCodeChange = useCallback(
    (value: string) => {
      setDrafts((d) => ({ ...d, [language]: value }));
      if (!matchId || gameOver) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => safeSet(draftKey(matchId, language), value), 300);
    },
    [language, matchId, gameOver]
  );

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    if (matchId) safeSet(langKey(matchId), lang);
  };

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    setConfirmReset(false);
    setDrafts((d) => ({ ...d, [language]: STARTER_CODE[language] }));
    if (matchId) safeRemove(draftKey(matchId, language));
  };

  const submittingRef = useRef(false);
  submittingRef.current = isSubmitting;

  const handleSubmit = useCallback(() => {
    if (gameOver || submittingRef.current) return;
    if (!gameSocket.isConnected()) {
      setSocketError("Not connected to the match server. Reconnecting.");
      return;
    }
    submittingRef.current = true;
    setFlash(null);
    setIsSubmitting(true);
    setSubmissionResult(null);
    setSocketError(null);
    setResultsCollapsed(false);
    gameSocket.submitCode(code, LANGUAGE_IDS[language]);
  }, [code, language, gameOver]);

  // Ctrl/Cmd + Enter submits from anywhere on the page (the editor binds it too)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The editor's own keymap already handled it (and called preventDefault)
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSubmit]);

  const didWin = winner !== null && winner === user?.id;
  // The server ends a timed-out match with no winner
  const isDraw = gameOver && winner === null;
  const opponentName = currentMatchData?.opponent?.username || "Opponent";
  // Practice: an unrated match against a bot, labelled as one
  const isPractice = !!currentMatchData?.opponent?.isBot || practiceResult;
  const playAgainPath = isPractice ? "/practice" : "/matchmaking";
  const visibleTests = currentMatchData?.problem?.testCases ?? [];
  const opponentAway = !!opponentDeadline && !gameOver;
  const opponentLabel = opponentAway
    ? `Disconnected, ${Math.max(0, Math.ceil((opponentDeadline! - now) / 1000))}s to return`
    : describeOpponent(opponentStatus);
  const opponentSolved = opponentLabel === "Solved";

  const statement = useMemo(
    () => convertCodeforcesMath(currentMatchData?.problem?.description || ""),
    [currentMatchData?.problem?.description]
  );

  // First failing test we are allowed to show in full (a public sample)
  const sampleFailure = useMemo(() => {
    const results = submissionResult?.testResults;
    if (!results || submissionResult?.status === "accepted") return null;
    // Visible results come in the same order as the sample tests in match_found
    let sampleIndex = -1;
    for (const r of results) {
      if (!r || r.hidden !== false) continue;
      sampleIndex++;
      if (r.passed) continue;
      const sample = visibleTests.find((t) => t.expectedOutput === r.expected) ?? visibleTests[sampleIndex];
      if (sample)
        return {
          number: sampleIndex + 1,
          input: sample.input,
          expected: sample.expectedOutput,
          got: r.stdout ?? "",
          status: r.status,
          message: r.message,
        };
    }
    return null;
  }, [submissionResult, visibleTests]);

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] flex-col" aria-busy="true">
        <div className="h-[52px] border-b border-rule" />
        <div className="grid flex-1 md:grid-cols-[42%_1fr]">
          <div className="space-y-3 p-6">
            <div className="h-3 w-24 animate-pulse bg-bg-2" />
            <div className="h-9 w-2/3 animate-pulse bg-bg-2" />
            <div className="h-4 w-full animate-pulse bg-bg-2" />
            <div className="h-4 w-5/6 animate-pulse bg-bg-2" />
            <div className="h-4 w-2/3 animate-pulse bg-bg-2" />
          </div>
          <div className="hidden bg-screen md:block" />
        </div>
        <span className="sr-only">Loading match</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[100dvh] flex-col px-4">
        <div className="flex h-[52px] items-center">
          <Chip className="px-2">
            <Mark /> Deadlock
          </Chip>
        </div>
        <div className="flex flex-1 flex-col justify-center py-12">
          <p className="label text-accent-ink">Match unavailable</p>
          <h1 className="mt-4 text-[clamp(2.75rem,6vw,5.75rem)] font-medium leading-[0.9] tracking-[-0.06em] text-fg">
            This match is over
          </h1>
          <p className="mt-5 max-w-[40ch] text-[clamp(1.25rem,1.8vw,1.5rem)] leading-[1.15] tracking-[-0.03em] text-fg-2">{loadError}</p>
          <div className="mt-10 flex flex-wrap gap-2">
            <Button variant="outline" size="lg" onClick={() => navigate("/dashboard")}>
              Back to lobby
            </Button>
            <Button variant="accent" size="lg" onClick={() => navigate("/matchmaking")}>
              Find a new match
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const clockSeconds = Math.floor(finalSeconds ?? elapsed);
  const clockText = `${String(Math.min(99, Math.floor(clockSeconds / 60))).padStart(2, "0")}:${String(clockSeconds % 60).padStart(2, "0")}`;
  const accepted = submissionResult?.status === "accepted";
  const verdictTone = accepted ? "text-screen-pass" : "text-screen-fail";
  const outcome = isDraw ? "Draw" : didWin ? "You won" : "You lost";
  const outcomeStamp = isDraw ? "DRAW" : didWin ? "WIN" : "LOSS";

  const submitHint = (
    <span className="hidden lg:contents">
      <Kbd>{isMac ? "⌘↵" : "Ctrl↵"}</Kbd>
    </span>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {/* HUD */}
      <header className="relative z-20 grid h-[52px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-rule px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Mark className="hidden size-3.5 sm:block" />
          <span className="truncate text-[15px] tracking-[-0.01em] text-fg">{currentMatchData?.problem?.title}</span>
        </div>

        <div role="timer" aria-label={`Match time ${clockText}`} className={gameOver ? "opacity-50" : ""}>
          <PixelText text={clockText} led gap={0.16} decorative className="h-[18px] text-fg sm:h-[22px]" />
        </div>

        <div className="flex items-center justify-end gap-[3px] sm:gap-1.5">
          <div className="mr-2 hidden min-w-0 items-center gap-2.5 md:flex" aria-live="polite">
            <span className="relative size-[7px] shrink-0" aria-hidden="true">
              <span className="absolute inset-0 bg-accent" />
              {oppPing > 0 && (
                <span key={oppPing} className="absolute -inset-[3px] animate-[ping-once_0.9s_ease-out_forwards] border border-accent motion-reduce:hidden" />
              )}
            </span>
            <span className="label max-w-[8rem] truncate normal-case text-fg">{opponentName}</span>
            {isPractice && <Tag>Unrated</Tag>}
            {opponentTests && <TestPips passed={opponentTests.passed} total={opponentTests.total} tone="opponent" size={7} />}
            <span
              className={`label truncate ${opponentAway ? "inline text-warn-ink" : "hidden xl:inline"} ${
                !opponentAway && opponentSolved ? "text-accent-ink" : !opponentAway ? "text-fg-3" : ""
              }`}
            >
              {opponentLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowForfeitModal(true)}
            disabled={gameOver}
            aria-label="Forfeit match"
            className="rounded-[3px] disabled:pointer-events-none disabled:opacity-40"
          >
            <Chip className="hover:text-accent-ink">
              <Flag className="size-3.5" weight="bold" />
              <span className="hidden lg:inline">Forfeit</span>
            </Chip>
          </button>
          <Button
            variant="accent"
            size="sm"
            onClick={handleSubmit}
            loading={isSubmitting}
            disabled={gameOver}
            aria-live="polite"
            className={`min-w-[6.5rem] pl-3 ${flash === "pass" ? "bg-pass! text-[#04130b]! disabled:opacity-100" : ""} ${
              flash === "fail" ? "animate-[shake_0.4s_ease-in-out] motion-reduce:animate-none" : ""
            }`}
          >
            <span key={isSubmitting ? "run" : flash ?? "idle"} className="inline-flex animate-[rise-in_0.25s_var(--ease-out-expo)] items-center gap-2 motion-reduce:animate-none">
              {isSubmitting ? (
                "Judging"
              ) : flash === "pass" ? (
                <>
                  <CheckCircle weight="fill" className="size-3.5" /> Accepted
                </>
              ) : flash === "fail" && submissionResult ? (
                <>
                  <XCircle weight="fill" className="size-3.5" />
                  <span className="tabular">
                    {submissionResult.passed}/{submissionResult.total}
                  </span>
                </>
              ) : (
                <>
                  <Play weight="fill" className="size-3" /> Submit {submitHint}
                </>
              )}
            </span>
          </Button>
        </div>
      </header>

      {/* Mobile tabs + compact opponent */}
      <div className="flex h-10 shrink-0 items-center gap-[3px] border-b border-line px-3 md:hidden" role="tablist" aria-label="Arena view">
        {(["problem", "code"] as MobileTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={mobileTab === t} onClick={() => setMobileTab(t)} className="rounded-[3px]">
            <Chip active={mobileTab === t}>{t === "problem" ? "Problem" : "Code"}</Chip>
          </button>
        ))}
        <div className="label ml-auto flex min-w-0 items-center gap-2 text-fg-3" aria-live="polite">
          <span className="relative size-[7px] shrink-0" aria-hidden="true">
              <span className="absolute inset-0 bg-accent" />
              {oppPing > 0 && (
                <span key={oppPing} className="absolute -inset-[3px] animate-[ping-once_0.9s_ease-out_forwards] border border-accent motion-reduce:hidden" />
              )}
            </span>
          <span className="max-w-[6rem] truncate normal-case text-fg">{opponentName}</span>
          {opponentAway ? (
            <span className="tabular text-warn-ink">Away {Math.max(0, Math.ceil((opponentDeadline! - now) / 1000))}s</span>
          ) : opponentTests ? (
            <span className="tabular">
              {opponentTests.passed}/{opponentTests.total}
            </span>
          ) : (
            <span>Waiting</span>
          )}
        </div>
      </div>

      {connectionLost && !gameOver && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b border-rule bg-bg-2 px-4 py-2"
        >
          <DotLoader pattern="orbit" className="text-accent" />
          <span className="label text-fg">Connection lost. Reconnecting; your match and code are held for you.</span>
        </div>
      )}

      {gameOver && !showResult && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-rule bg-bg-2 px-4 py-2">
          <span className={`label ${isDraw ? "text-warn-ink" : didWin ? "text-pass-ink" : "text-accent-ink"}`}>
            {outcome}. {gameOverReason}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/dashboard")}>
              Lobby
            </Button>
            <Button size="sm" variant="accent" onClick={() => navigate(playAgainPath)}>
              Play again
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Problem */}
        <section
          aria-label="Problem"
          className={`${mobileTab === "problem" ? "flex" : "hidden"} min-h-0 w-full flex-col border-rule md:flex md:w-[42%] md:border-r`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 sm:px-7">
            <Label aside={<span className="tabular">Rated {currentMatchData?.problem?.difficulty || "1000"}</span>}>Problem</Label>
            <h1 className="mt-5 text-[clamp(1.875rem,3vw,2.75rem)] font-medium leading-[0.95] tracking-[-0.05em] text-fg">
              {currentMatchData?.problem?.title}
            </h1>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Tag>stdin / stdout</Tag>
              <Tag>{visibleTests.length} sample {visibleTests.length === 1 ? "test" : "tests"}</Tag>
            </div>
            <div className="statement mt-6">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {statement}
              </ReactMarkdown>
            </div>
          </div>
        </section>

        {/* Editor + results */}
        <section
          ref={editorPanelRef}
          aria-label="Solution"
          className={`${mobileTab === "code" ? "flex" : "hidden"} min-h-0 w-full flex-1 flex-col bg-screen text-screen-fg md:flex`}
        >
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-screen-line px-2 sm:px-3">
            <div className="flex gap-[3px]" role="radiogroup" aria-label="Language">
              {LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  role="radio"
                  aria-checked={language === l.id}
                  onClick={() => handleLanguageChange(l.id)}
                  className={`label relative h-7 rounded-[3px] px-2 transition-colors duration-200 ${
                    language === l.id ? "text-screen" : "text-screen-fg-2 hover:bg-white/10 hover:text-screen-fg"
                  }`}
                >
                  {language === l.id && (
                    <motion.span
                      layoutId="lang-pill"
                      className="absolute inset-0 rounded-[3px] bg-screen-fg"
                      transition={{ type: "spring", stiffness: 520, damping: 38 }}
                    />
                  )}
                  <span className="relative">{l.label}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="label hidden items-center gap-1.5 text-screen-fg-2 xl:inline-flex">
                <Info className="size-3.5" aria-hidden="true" />
                Read stdin, print stdout
              </span>
              <button
                type="button"
                onClick={handleReset}
                className={`label inline-flex h-7 items-center gap-1.5 rounded-[3px] px-2 transition-colors hover:bg-white/10 ${
                  confirmReset ? "text-screen-fail" : "text-screen-fg-2 hover:text-screen-fg"
                }`}
              >
                <ArrowCounterClockwise className="size-3.5" />
                {confirmReset ? "Confirm reset" : "Reset"}
              </button>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <CodeEditor language={language} code={code} onChange={handleCodeChange} onSubmit={handleSubmit} />
          </div>

          {/* Results */}
          <div
            className="relative flex shrink-0 flex-col border-t border-screen-line bg-screen-2"
            style={{ height: resultsCollapsed ? 40 : resultsHeight }}
          >
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize results panel"
              onPointerDown={onResizeStart}
              className="absolute inset-x-0 -top-1.5 z-10 h-3 cursor-ns-resize touch-none after:absolute after:inset-x-0 after:top-1.5 after:h-px after:bg-transparent hover:after:bg-screen-fail/70"
            />
            <button
              type="button"
              onClick={() => setResultsCollapsed((c) => !c)}
              aria-expanded={!resultsCollapsed}
              className="label flex h-10 shrink-0 items-center gap-3 px-3 text-left sm:px-4"
            >
              <span className="text-screen-fg">/ Results</span>
              {isSubmitting ? (
                <span className="inline-flex items-center gap-1.5 text-screen-fg-2">
                  <DotLoader pattern="scan" /> Running tests
                </span>
              ) : submissionResult ? (
                <span className={`inline-flex items-center gap-1.5 ${verdictTone}`}>
                  {accepted ? <CheckCircle weight="fill" className="size-3.5" /> : <XCircle weight="fill" className="size-3.5" />}
                  {STATUS_LABEL[submissionResult.status] ?? submissionResult.status}
                  <span className="tabular text-screen-fg-2">
                    {submissionResult.passed}/{submissionResult.total}
                  </span>
                </span>
              ) : null}
              <CaretUp className={`ml-auto size-3.5 text-screen-fg-2 transition-transform ${resultsCollapsed ? "" : "rotate-180"}`} />
            </button>

            {!resultsCollapsed && (
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 text-sm sm:px-4" aria-live="polite">
                {socketError && (
                  <p className="mb-3 border border-screen-fail/40 px-3 py-2 text-[13px] text-screen-fail">{socketError}</p>
                )}

                {isSubmitting ? (
                  <div className="flex gap-[3px]" aria-hidden="true">
                    {Array.from({ length: submissionResult?.total || 10 }, (_, i) => (
                      <span
                        key={i}
                        className="block size-3 animate-[dot-blink_1.4s_ease-in-out_infinite] bg-white/40 motion-reduce:animate-none"
                        style={{ animationDelay: `${i * 70}ms` }}
                      />
                    ))}
                  </div>
                ) : submissionResult ? (
                  <div className="space-y-4">
                    {submissionResult.testResults && submissionResult.testResults.length > 0 ? (
                      <div className="flex flex-wrap gap-[3px]" aria-label={`${submissionResult.passed} of ${submissionResult.total} tests passed`}>
                        {submissionResult.testResults.map((r, i) => (
                          <span
                            key={i}
                            title={`Test ${i + 1}: ${r?.status ?? ""}`}
                            className={`block size-3 motion-reduce:animate-none! ${r?.passed ? "bg-screen-pass" : "bg-screen-fail"}`}
                            style={{
                              animation: r?.passed
                                ? `cell-pop 0.35s var(--ease-spring) ${i * 40}ms both`
                                : `cell-pop 0.35s var(--ease-spring) ${i * 40}ms both, shake 0.4s ease-in-out ${i * 40 + 380}ms`,
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-[3px]" aria-label={`${submissionResult.passed} of ${submissionResult.total} tests passed`}>
                        {Array.from({ length: Math.max(submissionResult.total, 1) }, (_, i) => (
                          <span
                            key={i}
                            className={`block size-3 animate-[cell-pop_0.35s_var(--ease-spring)_both] motion-reduce:animate-none ${
                              i < submissionResult.passed ? (accepted ? "bg-screen-pass" : "bg-screen-fg") : "bg-white/15"
                            }`}
                            style={{ animationDelay: `${i * 40}ms` }}
                          />
                        ))}
                      </div>
                    )}

                    {submissionResult.stderr && (
                      <pre className="overflow-x-auto whitespace-pre-wrap bg-screen p-3 font-mono text-[12px] leading-relaxed text-screen-fail">
                        {submissionResult.stderr}
                      </pre>
                    )}

                    {sampleFailure && (
                      <div className="grid gap-2 font-mono text-[12px] sm:grid-cols-3">
                        {[
                          { label: `Sample ${sampleFailure.number} input`, value: sampleFailure.input },
                          { label: "Expected", value: sampleFailure.expected },
                          { label: "Your output", value: sampleFailure.got || "(no output)" },
                        ].map((b) => (
                          <div key={b.label} className="min-w-0">
                            <div className="label mb-1.5 text-screen-fg-2">/ {b.label}</div>
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap bg-screen p-2.5 text-screen-fg">{b.value}</pre>
                          </div>
                        ))}
                        {sampleFailure.message && (
                          <p className="font-sans text-[12px] text-screen-fg-2 sm:col-span-3">{sampleFailure.message}</p>
                        )}
                      </div>
                    )}

                    {!sampleFailure && !accepted && !submissionResult.stderr && (
                      <p className="text-[13px] text-screen-fg-2">
                        The sample tests pass. A hidden test failed, so check edge cases and limits.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[13px] text-screen-fg-2">
                    Submit to run your code against every test. {isMac ? "Cmd" : "Ctrl"} + Enter works from the editor.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Forfeit */}
      <Dialog open={showForfeitModal} onClose={() => setShowForfeitModal(false)} eyebrow="Forfeit" title="Give up this match?">
        <p className="mt-4 text-[16px] leading-snug text-fg-2">
          {isPractice
            ? "The practice bot wins. Practice is unrated, so nothing goes on your record."
            : `${opponentName} wins immediately and the loss goes on your record.`}
        </p>
        <div className="mt-8 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setShowForfeitModal(false)}>
            Keep playing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setShowForfeitModal(false);
              gameSocket.forfeit();
            }}
          >
            Forfeit
          </Button>
        </div>
      </Dialog>

      {/* Result */}
      <Dialog
        open={gameOver && showResult}
        dismissible={false}
        eyebrow="Result"
        title={outcome}
        className="max-w-md"
        initialFocusRef={playAgainRef}
      >
        <div className="relative mt-6 w-fit">
          {didWin && <PixelBurst colors={WIN_BURST} delay={0.35} />}
          <PixelText
            text={outcomeStamp}
            intro="mount"
            delay={0.15}
            decorative
            className={`h-14 ${isDraw ? "text-warn-ink" : didWin ? "text-pass" : "text-accent"}`}
          />
        </div>
        <p className="mt-5 text-[16px] leading-snug text-fg-2">{gameOverReason}</p>
        <ul className="mt-6 border-t border-rule">
          {[
            { tag: "You", name: username, src: avatarUrl, win: didWin },
            { tag: isPractice ? "Bot" : "Rival", name: opponentName, src: undefined, win: !didWin && !isDraw },
          ].map((p) => (
            <li key={p.tag} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2.5">
              <span className="label flex items-center gap-2 text-fg">
                <span className={`size-[7px] ${p.tag === "You" ? "bg-fg" : "bg-accent"}`} aria-hidden="true" />
                {p.tag}
              </span>
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar src={p.src} name={p.name} size={24} />
                <span className="truncate text-[16px] tracking-[-0.01em] text-fg">{p.name}</span>
              </span>
              {p.win ? <Tag tone="pass">Winner</Tag> : <span />}
            </li>
          ))}
        </ul>
        <div className="label mt-3 flex flex-wrap items-center justify-between gap-2 text-fg-3">
          <span>
            Match time <span className="tabular text-fg">{clockText}</span>
          </span>
          {isPractice && <span>Practice &middot; unrated</span>}
          {ratingResult && (
            <span>
              Rating <span className="tabular text-fg">{ratingResult.rating}</span>{" "}
              <span className={`tabular ${ratingResult.change >= 0 ? "text-pass-ink" : "text-accent-ink"}`}>
                ({ratingResult.change >= 0 ? "+" : "\u2212"}
                {Math.abs(ratingResult.change)})
              </span>
            </span>
          )}
        </div>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setShowResult(false)}>
            Review code
          </Button>
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Lobby
          </Button>
          <Button ref={playAgainRef} variant="accent" onClick={() => navigate(playAgainPath)}>
            {isPractice ? "Practice again" : "Play again"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
};

export default RealGameArena;
