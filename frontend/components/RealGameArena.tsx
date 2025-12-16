import React, { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Play,
  CheckCircle,
  XCircle,
  Terminal,
  Maximize2,
  RotateCcw,
  Clock,
  ChevronDown,
  AlertCircle,
  Loader2,
  Trophy,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import CodeEditor from "../components/CodeEditor";
import { gameSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";

// Convert Codeforces-style math ($$$...$$$) to standard LaTeX ($...$)
const convertCodeforcesMath = (text: string): string => {
  if (!text) return "";
  // Replace $$$ with $ for inline math (Codeforces uses $$$ for inline)
  return text.replace(/\$\$\$([^$]+)\$\$\$/g, "$$$1$");
};

const LANGUAGE_IDS = {
  python: 71,
  javascript: 63,
  cpp: 54,
};

const STARTER_CODE = {
  python: `# Write your solution here
def solve():
    pass

if __name__ == '__main__':
    solve()`,
  javascript: `// Write your solution here
function solve() {
    
}

solve();`,
  cpp: `#include <iostream>
using namespace std;

int main() {
    // Write your solution here
    return 0;
}`,
};

type Language = keyof typeof STARTER_CODE;

// Codeforces difficulty color mapping
const getDifficultyColor = (difficulty: string | number) => {
  const rating =
    typeof difficulty === "string" ? parseInt(difficulty) : difficulty;

  if (rating < 1200) return "text-gray-500 bg-gray-500/10 border-gray-500/20";
  if (rating < 1400)
    return "text-green-500 bg-green-500/10 border-green-500/20";
  if (rating < 1600) return "text-cyan-500 bg-cyan-500/10 border-cyan-500/20";
  if (rating < 1900) return "text-blue-500 bg-blue-500/10 border-blue-500/20";
  if (rating < 2100)
    return "text-purple-500 bg-purple-500/10 border-purple-500/20";
  if (rating < 2400)
    return "text-orange-500 bg-orange-500/10 border-orange-500/20";
  return "text-red-500 bg-red-500/10 border-red-500/20";
};

const RealGameArena: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { matchId } = useParams<{ matchId: string }>();
  const matchData = location.state?.matchData;

  const [language, setLanguage] = useState<Language>("python");
  const [code, setCode] = useState(STARTER_CODE.python);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<any>(null);
  const [opponentProgress, setOpponentProgress] = useState<string>("Idle");
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [gameOverReason, setGameOverReason] = useState<string>("");
  const [showForfeitModal, setShowForfeitModal] = useState(false);

  /* State */
  const [resultsHeight, setResultsHeight] = useState(192); // Default h-48 equivalent
  const editorPanelRef = React.useRef<HTMLDivElement>(null);
  const isDragging = React.useRef(false);

  /* Resize Logic */
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !editorPanelRef.current) return;

      const panelRect = editorPanelRef.current.getBoundingClientRect();
      const newHeight = panelRect.bottom - e.clientY;
      const maxHeight = panelRect.height * 0.8;

      if (newHeight >= 40 && newHeight <= maxHeight) {
        setResultsHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "default";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    document.body.style.cursor = "ns-resize";
    e.preventDefault();
  };

  // Store match data in state (can be updated from rejoin)
  const [currentMatchData, setCurrentMatchData] = useState<any>(matchData);
  const [isLoading, setIsLoading] = useState(!matchData);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Handle socket connection and match rejoin
  useEffect(() => {
    // If we have match data from navigation, use it
    if (matchData) {
      setCurrentMatchData(matchData);
      setIsLoading(false);
    }

    // If no match ID in URL, redirect
    if (!matchId) {
      console.error("No match ID in URL, redirecting...");
      navigate("/dashboard");
      return;
    }

    // Get auth token from Supabase session
    const initSocket = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        console.error("No auth token, redirecting to auth...");
        navigate("/auth");
        return;
      }

      // Connect socket if not connected
      let socket = gameSocket.getSocket();
      if (!socket?.connected) {
        socket = gameSocket.connect(token);
      }

      return socket;
    };

    initSocket().then((socket) => {
      if (!socket) return;

      // Handle match_found event (for rejoin)
      const handleMatchFound = (data: any) => {
        console.log("Match data received:", data);
        setCurrentMatchData(data);
        setIsLoading(false);
        setLoadError(null);
      };

      // Listen for submission results
      const handleSubmissionResult = (result: any) => {
        console.log("Submission result:", result);
        setSubmissionResult(result);
        setIsSubmitting(false);
      };

      // Listen for opponent progress
      const handleOpponentProgress = (data: any) => {
        console.log("Opponent progress:", data);
        setOpponentProgress(data.status);
      };

      // Listen for game over
      const handleGameOver = (data: any) => {
        console.log("Game over:", data);
        setGameOver(true);
        setWinner(data.winnerId);
        setGameOverReason(data.reason || "Match ended");
      };

      // Listen for errors
      const handleError = (data: any) => {
        console.error("Socket error:", data);
        if (data.code === "MATCH_NOT_FOUND" || data.code === "MATCH_ENDED") {
          setLoadError(data.message);
          setIsLoading(false);
        } else if (data.code !== "NOT_PARTICIPANT") {
          // Don't show alert for normal errors during rejoin
          if (!isLoading) {
            alert(data.message);
          }
        }
      };

      socket?.on("match_found", handleMatchFound);
      socket?.on("submission_result", handleSubmissionResult);
      socket?.on("opponent_progress", handleOpponentProgress);
      socket?.on("game_over", handleGameOver);
      socket?.on("error", handleError);

      // If no match data (page refresh), request rejoin
      if (!matchData && matchId) {
        console.log("No match data, requesting rejoin...");

        const attemptRejoin = () => {
          if (socket?.connected) {
            gameSocket.rejoinMatch(matchId);
          } else {
            // Wait for socket to connect
            socket?.once("connect", () => {
              gameSocket.rejoinMatch(matchId);
            });
          }
        };

        attemptRejoin();
      }

      return () => {
        socket?.off("match_found", handleMatchFound);
        socket?.off("submission_result", handleSubmissionResult);
        socket?.off("opponent_progress", handleOpponentProgress);
        socket?.off("game_over", handleGameOver);
        socket?.off("error", handleError);
      };
    });
  }, [matchId, matchData, navigate]);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    setCode(STARTER_CODE[lang]);
    setIsLangMenuOpen(false);
  };

  const handleSubmit = () => {
    if (!gameSocket.isConnected()) {
      alert("Not connected to server");
      return;
    }

    setIsSubmitting(true);
    setSubmissionResult(null);

    gameSocket.submitCode(code, LANGUAGE_IDS[language]);
  };

  // Determine if current user won (if winner is opponent, we lost)
  const didWin = winner !== null && winner !== currentMatchData?.opponent?.id;

  // Show loading state
  if (isLoading) {
    return (
      <div className="h-screen w-full bg-[#050505] flex items-center justify-center font-mono">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-stone-400 animate-spin mx-auto mb-4" />
          <p className="text-stone-400">Loading match...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (loadError) {
    return (
      <div className="h-screen w-full bg-[#050505] flex items-center justify-center font-mono">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-white text-xl mb-2">Match Not Found</p>
          <p className="text-stone-400 mb-6">{loadError}</p>
          <button
            onClick={() => navigate("/dashboard")}
            className="px-6 py-2 bg-stone-800 hover:bg-stone-700 text-white rounded-lg transition-colors"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (gameOver) {
    return (
      <div className="fixed inset-0 z-50 bg-[#050505]/95 backdrop-blur-sm flex items-center justify-center">
        {/* Background code pattern effect */}
        <div className="absolute inset-0 opacity-10 overflow-hidden pointer-events-none">
          <pre className="text-[8px] text-stone-500 whitespace-pre-wrap leading-tight">
            {`for (int i = 0; i < n; i++) { double ans = 0; for (int j = 0; j < m; j++) { ans += a[i][j]; } } 
int main() { scanf("%d", &n); for (int i = 0; i < n; i++) { printf("%d\\n", solve(i)); } return 0; }
while (left <= right) { int mid = (left + right) / 2; if (check(mid)) ans = mid, left = mid + 1; else right = mid - 1; }`.repeat(
              50
            )}
          </pre>
        </div>

        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="relative z-10 text-center px-12 py-10 bg-gradient-to-b from-stone-900/80 to-stone-950/90 border border-stone-800 rounded-2xl shadow-2xl"
        >
          {didWin ? (
            <>
              {/* Victory */}
              <div className="text-7xl mb-4">🏆</div>
              <h1 className="text-5xl font-black text-emerald-400 mb-3 tracking-tight">
                VICTORY
              </h1>
              <p className="text-stone-400 text-lg mb-8">{gameOverReason}</p>
            </>
          ) : (
            <>
              {/* Defeat */}
              <div className="text-7xl mb-4">💀</div>
              <h1 className="text-5xl font-black text-red-500 mb-3 tracking-tight">
                DEFEAT
              </h1>
              <p className="text-stone-400 text-lg mb-8">{gameOverReason}</p>
            </>
          )}

          <button
            onClick={() => navigate("/dashboard")}
            className="px-8 py-3 bg-white text-stone-900 font-bold rounded-lg hover:bg-stone-200 transition-colors"
          >
            Return to Dashboard
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-[#050505] flex flex-col font-mono overflow-hidden">
      {/* Forfeit Confirmation Modal */}
      {showForfeitModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-gradient-to-b from-stone-900 to-stone-950 border border-stone-700 rounded-xl p-8 max-w-sm w-full mx-4 shadow-2xl"
          >
            <div className="text-center">
              <div className="text-5xl mb-4">🏳️</div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Forfeit Match?
              </h2>
              <p className="text-stone-400 text-sm mb-6">
                You will lose this match and receive a rating penalty. This
                action cannot be undone.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowForfeitModal(false)}
                  className="flex-1 px-4 py-2.5 bg-stone-800 hover:bg-stone-700 text-white font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowForfeitModal(false);
                    gameSocket.forfeit();
                  }}
                  className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-colors"
                >
                  Forfeit
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Game Header */}
      <div className="h-14 border-b border-stone-800 bg-[#0a0a0a] flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-4">
          <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-sm uppercase">
            Ranked Match
          </div>
          <div className="flex items-center gap-2 text-stone-400 text-xs">
            <Clock className="w-3 h-3" />
            <span>LIVE</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-stone-500">
            Opponent: <span className="text-white">{opponentProgress}</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold px-4 py-1.5 rounded-sm flex items-center gap-2 transition-colors"
          >
            {isSubmitting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3 fill-current" />
            )}
            SUBMIT
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Problem */}
        <div className="w-1/2 border-r border-stone-800 flex flex-col bg-[#050505]">
          {/* Tabs */}
          <div className="flex items-center h-10 bg-[#0a0a0a] border-b border-stone-800 px-2">
            <button className="flex items-center gap-2 px-4 h-full text-xs font-medium text-white border-b-2 border-white bg-white/5 transition-colors">
              <span className="text-blue-400">📄</span> Description
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-white mb-4 flex items-center gap-3">
                {currentMatchData?.problem?.title || "Loading..."}
              </h1>

              <div className="flex items-center gap-3 text-xs">
                <span
                  className={`px-3 py-1 rounded-full font-medium bg-opacity-10 border border-opacity-20 ${getDifficultyColor(
                    currentMatchData?.problem?.difficulty || 1500
                  )}`}
                >
                  {currentMatchData?.problem?.difficulty || "Medium"}
                </span>
              </div>
            </div>

            <div className="prose prose-invert prose-sm max-w-none text-stone-300 leading-relaxed theme-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  h1: ({ node, ...props }) => (
                    <h1
                      className="text-xl font-bold text-white mt-6 mb-3"
                      {...props}
                    />
                  ),
                  h2: ({ node, ...props }) => (
                    <h2
                      className="text-lg font-bold text-white mt-5 mb-2"
                      {...props}
                    />
                  ),
                  h3: ({ node, ...props }) => (
                    <h3
                      className="text-base font-bold text-white mt-4 mb-2"
                      {...props}
                    />
                  ),
                  p: ({ node, ...props }) => (
                    <p className="mb-4 text-stone-300 leading-7" {...props} />
                  ),
                  code: ({ node, inline, ...props }: any) =>
                    inline ? (
                      <code
                        className="bg-stone-800/50 px-1.5 py-0.5 rounded text-stone-200 border border-stone-700/50 text-sm font-mono"
                        {...props}
                      />
                    ) : (
                      <code
                        className="block bg-[#111] p-4 rounded-lg my-4 text-sm font-mono border border-stone-800 overflow-x-auto text-stone-300 leading-6"
                        {...props}
                      />
                    ),
                  pre: ({ node, ...props }) => (
                    <pre
                      className="bg-transparent p-0 m-0 border-0"
                      {...props}
                    />
                  ),
                  ul: ({ node, ...props }) => (
                    <ul
                      className="list-disc list-outside ml-4 mb-4 space-y-2 text-stone-300"
                      {...props}
                    />
                  ),
                  ol: ({ node, ...props }) => (
                    <ol
                      className="list-decimal list-outside ml-4 mb-4 space-y-2 text-stone-300"
                      {...props}
                    />
                  ),
                  strong: ({ node, ...props }) => (
                    <strong className="text-white font-semibold" {...props} />
                  ),
                  li: ({ node, ...props }) => (
                    <li className="pl-1" {...props} />
                  ),
                }}
              >
                {convertCodeforcesMath(
                  currentMatchData?.problem?.description || "Loading problem..."
                )}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        {/* Right Panel: Editor & Results */}
        <div
          ref={editorPanelRef}
          className="w-1/2 flex flex-col h-full bg-[#080808]"
        >
          {/* Code Editor Header */}
          <div className="h-10 bg-[#0a0a0a] border-b border-stone-800 flex items-center justify-between px-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <button
                  onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                  className="flex items-center gap-2 text-xs text-stone-300 hover:text-white font-medium transition-colors"
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  {language === "cpp" ? "C++" : language}
                  <ChevronDown className="w-3 h-3" />
                </button>

                {isLangMenuOpen && (
                  <div className="absolute top-full left-0 mt-2 w-32 bg-[#1a1a1a] border border-stone-700 rounded-md shadow-xl z-50 py-1">
                    {Object.keys(STARTER_CODE).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => handleLanguageChange(lang as Language)}
                        className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-stone-800 ${
                          language === lang ? "text-blue-400" : "text-stone-300"
                        }`}
                      >
                        {lang === "cpp" ? "C++" : lang}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sub-Header Actions (Opponent Info + Reset) */}
            <div className="flex items-center gap-6">
              {/* Opponent Info */}
              <div className="flex items-center gap-3 px-3 py-1 bg-stone-900/50 rounded border border-stone-800">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                  <span className="text-xs font-bold text-stone-400 uppercase">
                    Opponent
                  </span>
                </div>
                <div className="h-3 w-px bg-stone-700"></div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-white font-medium">
                    {matchData?.opponent?.username || "Unknown"}
                  </span>
                  <span className="text-stone-500">
                    ({matchData?.opponent?.elo || "?"})
                  </span>
                </div>
                <div className="flex items-center gap-1.5 ml-2">
                  <span className="block w-1.5 h-1.5 rounded-full bg-stone-600"></span>
                  <span className="text-[10px] text-stone-400 uppercase tracking-wider">
                    {opponentProgress}
                  </span>
                </div>
              </div>

              <div className="h-4 w-px bg-stone-800"></div>

              <button
                onClick={() => setShowForfeitModal(true)}
                className="text-red-500 hover:text-red-400 hover:bg-red-500/10 px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5"
                title="Forfeit Match"
              >
                <XCircle className="w-3.5 h-3.5" />
                Forfeit
              </button>
            </div>
          </div>

          {/* WARNING MESSAGE */}
          <div className="bg-blue-900/20 border-b border-blue-900/30 px-4 py-2 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-blue-400 shrink-0" />
            <p className="text-xs text-blue-200 font-medium">
              Important: You submitted code must include the full implementation
              including the{" "}
              <code className="bg-blue-900/40 px-1 rounded text-blue-100">
                main
              </code>{" "}
              function and imports.
            </p>
          </div>

          {/* Code Editor Area */}
          <div className="flex-1 relative overflow-hidden bg-[#0c0c0c]">
            <CodeEditor language={language} code={code} onChange={setCode} />
          </div>

          {/* Resizable Results Area */}
          <div
            className="relative flex flex-col border-t border-stone-800 bg-[#0a0a0a]"
            style={{ height: resultsHeight }}
          >
            {/* Drag Handle */}
            <div
              className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500/50 transition-colors z-50 group"
              onMouseDown={handleMouseDown}
            >
              <div className="absolute inset-x-0 -top-2 h-4 w-full"></div>{" "}
              {/* Invisible hit area */}
            </div>

            <div className="h-9 border-b border-stone-800 flex items-center px-1 bg-[#0a0a0a] shrink-0">
              <button className="flex items-center gap-2 px-4 h-full text-xs font-medium text-white border-t-2 border-transparent">
                <Terminal className="w-3.5 h-3.5 text-stone-400" />
                Testcase
              </button>
              <button className="flex items-center gap-2 px-4 h-full text-xs font-medium text-stone-500 hover:text-stone-300">
                Test Result
              </button>

              <div className="ml-auto mr-4 text-[10px] text-stone-600 font-mono">
                {resultsHeight}px
              </div>
            </div>

            <div className="flex-1 p-4 overflow-auto font-mono text-xs custom-scrollbar">
              {isSubmitting ? (
                <div className="flex items-center gap-2 text-stone-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting to backend...
                </div>
              ) : submissionResult ? (
                <div className="space-y-3">
                  {submissionResult.status === "accepted" ? (
                    <div className="flex items-center gap-2 text-emerald-500 font-bold">
                      <CheckCircle className="w-4 h-4" />
                      Accepted ({submissionResult.passed}/
                      {submissionResult.total} tests passed)
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-red-500 font-bold">
                      <XCircle className="w-4 h-4" />
                      {submissionResult.status} ({submissionResult.passed}/
                      {submissionResult.total} tests passed)
                    </div>
                  )}

                  {submissionResult.stderr && (
                    <div className="bg-stone-900/50 p-2 rounded-sm border border-red-900/50">
                      <span className="text-stone-500 block text-[10px] uppercase mb-1">
                        Error
                      </span>
                      <pre className="text-red-400 whitespace-pre-wrap">
                        {submissionResult.stderr}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-stone-600 italic">
                  Submit your code to see results...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RealGameArena;
