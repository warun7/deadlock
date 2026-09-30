import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowCounterClockwise,
  CaretUp,
  CheckCircle,
  CircleNotch,
  Flag,
  Info,
  Play,
  WarningCircle,
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
import Wordmark from "./ui/Wordmark";
import { Button, Kbd } from "./ui/Button";
import { gameSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useCurrentProfile } from "../lib/useCurrentProfile";
import { formatClock } from "../lib/format";
import type { MatchFoundPayload } from "../types";

// Codeforces uses $$$...$$$ for inline math; KaTeX expects $...$
const convertCodeforcesMath = (text: string): string => {
  if (!text) return "";
  return text.replace(/\$\$\$([^$]+)\$\$\$/g, "$$$1$");
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

type TestResult = { testIndex: number; passed: boolean; status: string; stdout?: string; expected?: string };
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
      const handleOpponentProgress = (data: { playerId?: string; status: string; testsProgress?: string }) => {
        if (data.playerId && data.playerId === userIdRef.current) return;
        setOpponentStatus(data.status);
        const m = data.testsProgress?.match(/^(\d+)\/(\d+)$/);
        if (m) setOpponentTests({ passed: Number(m[1]), total: Number(m[2]) });
      };

      const handleGameOver = (data: { winnerId: string | null; reason?: string }) => {
        setGameOver(true);
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

      socket.on("match_found", handleMatchFound);
      socket.on("submission_result", handleSubmissionResult);
      socket.on("opponent_progress", handleOpponentProgress);
      socket.on("game_over", handleGameOver);
      socket.on("error", handleError);

      if (socket.connected) gameSocket.rejoinMatch(matchId);
      else socket.on("connect", handleConnect);

      cleanupSocketListeners = () => {
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

  // Freeze the clock and clear saved drafts once the match is decided
  useEffect(() => {
    if (!gameOver) return;
    setFinalSeconds(elapsed);
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
  const opponentName = currentMatchData?.opponent?.username || "Opponent";
  const visibleTests = currentMatchData?.problem?.testCases ?? [];
  const opponentLabel = describeOpponent(opponentStatus);
  const opponentSolved = opponentLabel === "Solved";

  const statement = useMemo(
    () => convertCodeforcesMath(currentMatchData?.problem?.description || ""),
    [currentMatchData?.problem?.description]
  );

  // First failing test we are allowed to show in full (a public sample)
  const sampleFailure = useMemo(() => {
    const results = submissionResult?.testResults;
    if (!results || submissionResult?.status === "accepted") return null;
    for (const r of results) {
      if (!r || r.passed) continue;
      const sample = visibleTests.find((t) => t.expectedOutput === r.expected);
      if (sample) return { index: r.testIndex, input: sample.input, expected: sample.expectedOutput, got: r.stdout ?? "", status: r.status };
    }
    return null;
  }, [submissionResult, visibleTests]);

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] flex-col" aria-busy="true">
        <div className="h-14 border-b border-line" />
        <div className="grid flex-1 gap-px md:grid-cols-[42%_1fr]">
          <div className="space-y-3 p-6">
            <div className="h-6 w-1/2 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-surface-2" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="hidden bg-surface-1 md:block" />
        </div>
        <span className="sr-only">Loading match</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-[100dvh] items-center justify-center px-5">
        <div className="max-w-sm text-center">
          <WarningCircle className="mx-auto size-9 text-accent-text" weight="duotone" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-fg">This match is over</h1>
          <p className="mt-2 text-[15px] text-fg-2">{loadError}</p>
          <div className="mt-8 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => navigate("/dashboard")}>
              Back to lobby
            </Button>
            <Button onClick={() => navigate("/matchmaking")}>Find a new match</Button>
          </div>
        </div>
      </div>
    );
  }

  const submitHint = (
    <span className="hidden lg:contents">
      <Kbd>{isMac ? "⌘" : "Ctrl"} {"↵"}</Kbd>
    </span>
  );

  const resultTone = submissionResult?.status === "accepted" ? "text-pass" : "text-accent-text";

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {/* Top bar */}
      <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-ink px-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Wordmark className="hidden text-[15px] text-fg sm:inline" />
          <span className="hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
          <span className="truncate text-sm text-fg-2">{currentMatchData?.problem?.title}</span>
        </div>

        <div
          className={`tabular rounded-[8px] px-2.5 py-1 font-mono text-sm ${gameOver ? "text-fg-3" : "text-fg"}`}
          aria-label="Match time"
        >
          {formatClock(finalSeconds ?? elapsed)}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="hidden items-center gap-3 rounded-[var(--radius-control)] bg-surface-1 px-3 py-1.5 shadow-[inset_0_0_0_1px_var(--color-line)] md:flex">
            <Avatar name={opponentName} size={24} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="max-w-[9rem] truncate text-[13px] text-fg">{opponentName}</span>
                {opponentTests && (
                  <span className="tabular font-mono text-[12px] text-fg-3">
                    {opponentTests.passed}/{opponentTests.total}
                  </span>
                )}
              </div>
              <div className={`text-[11px] ${opponentSolved ? "text-accent-text" : "text-fg-3"}`} aria-live="polite">
                {opponentLabel}
              </div>
            </div>
            {opponentTests && (
              <TestPips className="w-20" passed={opponentTests.passed} total={opponentTests.total} tone="opponent" />
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowForfeitModal(true)}
            disabled={gameOver}
            aria-label="Forfeit match"
            className="text-fg-3 hover:text-accent-text"
          >
            <Flag className="size-4" />
            <span className="hidden lg:inline">Forfeit</span>
          </Button>
          <Button size="sm" onClick={handleSubmit} loading={isSubmitting} disabled={gameOver} className="pl-3">
            {!isSubmitting && <Play weight="fill" className="size-3.5" />}
            Submit
            {submitHint}
          </Button>
        </div>
      </header>

      {/* Mobile tabs + compact opponent */}
      <div className="flex h-11 shrink-0 items-stretch border-b border-line md:hidden" role="tablist" aria-label="Arena view">
        {(["problem", "code"] as MobileTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={mobileTab === t}
            onClick={() => setMobileTab(t)}
            className={`relative px-4 text-sm transition-colors ${mobileTab === t ? "text-fg" : "text-fg-3"}`}
          >
            {t === "problem" ? "Problem" : "Code"}
            {mobileTab === t && <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-accent" />}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pr-3 text-[12px] text-fg-3" aria-live="polite">
          <span className="max-w-[6rem] truncate text-fg-2">{opponentName}</span>
          {opponentTests ? (
            <span className="tabular font-mono">
              {opponentTests.passed}/{opponentTests.total}
            </span>
          ) : (
            <span>waiting</span>
          )}
        </div>
      </div>

      {gameOver && !showResult && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface-1 px-4 py-2 text-sm">
          <span className={didWin ? "text-pass" : "text-accent-text"}>
            {didWin ? "You won" : "You lost"}. {gameOverReason}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigate("/dashboard")}>
              Lobby
            </Button>
            <Button size="sm" onClick={() => navigate("/matchmaking")}>
              Play again
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Problem */}
        <section
          aria-label="Problem"
          className={`${mobileTab === "problem" ? "flex" : "hidden"} min-h-0 w-full flex-col border-line md:flex md:w-[42%] md:border-r`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg sm:text-2xl">
              {currentMatchData?.problem?.title}
            </h1>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
              <span className="rounded-[6px] bg-white/[0.06] px-2 py-1 text-fg-2">
                Rating <span className="tabular font-mono text-fg">{currentMatchData?.problem?.difficulty || "1000"}</span>
              </span>
              <span className="rounded-[6px] bg-white/[0.06] px-2 py-1 text-fg-2">stdin / stdout</span>
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
          className={`${mobileTab === "code" ? "flex" : "hidden"} min-h-0 w-full flex-1 flex-col bg-[#0e0e11] md:flex`}
        >
          <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line bg-ink px-2 sm:px-3">
            <div className="flex rounded-[9px] bg-surface-1 p-0.5 shadow-[inset_0_0_0_1px_var(--color-line)]" role="radiogroup" aria-label="Language">
              {LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  role="radio"
                  aria-checked={language === l.id}
                  onClick={() => handleLanguageChange(l.id)}
                  className={`rounded-[7px] px-2.5 py-1 text-[13px] transition-colors ${
                    language === l.id ? "bg-surface-3 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-fg-3 hover:text-fg-2"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="hidden items-center gap-1.5 text-[12px] text-fg-3 xl:inline-flex">
                <Info className="size-3.5" aria-hidden="true" />
                Read stdin, print stdout. Include imports and main.
              </span>
              <Button variant="ghost" size="sm" onClick={handleReset} className={confirmReset ? "text-accent-text" : "text-fg-3"}>
                <ArrowCounterClockwise className="size-3.5" />
                {confirmReset ? "Confirm reset" : "Reset"}
              </Button>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <CodeEditor language={language} code={code} onChange={handleCodeChange} onSubmit={handleSubmit} />
          </div>

          {/* Results */}
          <div
            className="relative flex shrink-0 flex-col border-t border-line bg-ink"
            style={{ height: resultsCollapsed ? 44 : resultsHeight }}
          >
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize results panel"
              onPointerDown={onResizeStart}
              className="absolute inset-x-0 -top-1.5 z-10 h-3 cursor-ns-resize touch-none after:absolute after:inset-x-0 after:top-1.5 after:h-px after:bg-transparent hover:after:bg-accent/60"
            />
            <button
              type="button"
              onClick={() => setResultsCollapsed((c) => !c)}
              aria-expanded={!resultsCollapsed}
              className="flex h-11 shrink-0 items-center gap-3 px-4 text-left"
            >
              <span className="text-[13px] font-medium text-fg-2">Results</span>
              {isSubmitting ? (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-3">
                  <CircleNotch className="size-3.5 animate-spin" /> Running tests
                </span>
              ) : submissionResult ? (
                <span className={`inline-flex items-center gap-1.5 text-[13px] ${resultTone}`}>
                  {submissionResult.status === "accepted" ? (
                    <CheckCircle weight="fill" className="size-3.5" />
                  ) : (
                    <XCircle weight="fill" className="size-3.5" />
                  )}
                  {STATUS_LABEL[submissionResult.status] ?? submissionResult.status}
                  <span className="tabular font-mono text-fg-3">
                    {submissionResult.passed}/{submissionResult.total}
                  </span>
                </span>
              ) : null}
              <CaretUp className={`ml-auto size-3.5 text-fg-3 transition-transform ${resultsCollapsed ? "" : "rotate-180"}`} />
            </button>

            {!resultsCollapsed && (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 text-sm" aria-live="polite">
                {socketError && (
                  <p className="mb-3 rounded-[8px] bg-accent/10 px-3 py-2 text-[13px] text-accent-text">{socketError}</p>
                )}

                {isSubmitting ? (
                  <div className="flex gap-[3px]" aria-hidden="true">
                    {Array.from({ length: submissionResult?.total || 10 }, (_, i) => (
                      <span key={i} className="h-2 flex-1 animate-pulse rounded-[2px] bg-white/10" style={{ animationDelay: `${i * 60}ms` }} />
                    ))}
                  </div>
                ) : submissionResult ? (
                  <div className="space-y-4">
                    {submissionResult.testResults && submissionResult.testResults.length > 0 ? (
                      <div className="flex gap-[3px]" aria-label={`${submissionResult.passed} of ${submissionResult.total} tests passed`}>
                        {submissionResult.testResults.map((r, i) => (
                          <span
                            key={i}
                            title={`Test ${i + 1}: ${r?.status ?? ""}`}
                            className={`h-2 flex-1 rounded-[2px] ${r?.passed ? "bg-pass" : "bg-accent"}`}
                          />
                        ))}
                      </div>
                    ) : (
                      <TestPips
                        passed={submissionResult.passed}
                        total={submissionResult.total}
                        tone={submissionResult.status === "accepted" ? "pass" : "you"}
                      />
                    )}

                    {submissionResult.stderr && (
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded-[8px] bg-surface-1 p-3 font-mono text-[12px] leading-relaxed text-accent-text">
                        {submissionResult.stderr}
                      </pre>
                    )}

                    {sampleFailure && (
                      <div className="grid gap-2 font-mono text-[12px] sm:grid-cols-3">
                        {[
                          { label: `Sample test ${sampleFailure.index + 1} input`, value: sampleFailure.input },
                          { label: "Expected", value: sampleFailure.expected },
                          { label: "Your output", value: sampleFailure.got || "(no output)" },
                        ].map((b) => (
                          <div key={b.label} className="min-w-0">
                            <div className="mb-1 font-sans text-[12px] text-fg-3">{b.label}</div>
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] bg-surface-1 p-2.5 text-fg-2">{b.value}</pre>
                          </div>
                        ))}
                      </div>
                    )}

                    {!sampleFailure && submissionResult.status !== "accepted" && !submissionResult.stderr && (
                      <p className="text-[13px] text-fg-3">
                        The sample tests pass. A hidden test failed, so check edge cases and limits.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[13px] text-fg-3">
                    Submit to run your code against every test. {isMac ? "Cmd" : "Ctrl"} + Enter works from the editor.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Forfeit */}
      <Dialog open={showForfeitModal} onClose={() => setShowForfeitModal(false)} title="Forfeit this match?">
        <p className="mt-2 text-[15px] leading-relaxed text-fg-2">
          {opponentName} wins immediately and the loss goes on your record.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setShowForfeitModal(false)}>
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
        title={didWin ? "You won" : "You lost"}
        className="max-w-md text-center"
        initialFocusRef={playAgainRef}
      >
        <p className="mt-2 text-[15px] text-fg-2">{gameOverReason}</p>
        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-2">
            <Avatar src={avatarUrl} name={username} size={44} />
            <span className={`max-w-full truncate text-sm ${didWin ? "text-pass" : "text-fg-2"}`}>{username}</span>
          </div>
          <span className="tabular font-mono text-[13px] text-fg-3">{formatClock(finalSeconds ?? elapsed)}</span>
          <div className="flex flex-col items-center gap-2">
            <Avatar name={opponentName} size={44} />
            <span className={`max-w-full truncate text-sm ${!didWin ? "text-accent-text" : "text-fg-2"}`}>{opponentName}</span>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="ghost" onClick={() => setShowResult(false)}>
            Review code
          </Button>
          <Button variant="secondary" onClick={() => navigate("/dashboard")}>
            Back to lobby
          </Button>
          <Button ref={playAgainRef} onClick={() => navigate("/matchmaking")}>
            Play again
          </Button>
        </div>
      </Dialog>
    </div>
  );
};

export default RealGameArena;
