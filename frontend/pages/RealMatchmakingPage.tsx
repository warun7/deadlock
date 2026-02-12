import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Server, Globe, Crown, Swords, Shield, Lock } from "lucide-react";
import GlitchText from "../components/GlitchText";
import { gameSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { RANK_TIERS } from "../types/database";

type MatchMode = "ranked" | "unranked";

const RealMatchmakingPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isPremium, currentRating, rankTier } = useAuth();

  // Check for mode param (e.g. /matchmaking?mode=ranked)
  const modeParam = searchParams.get("mode") as MatchMode | null;

  const [selectedMode, setSelectedMode] = useState<MatchMode | null>(modeParam);
  const [status, setStatus] = useState<
    "selecting" | "connecting" | "searching" | "found" | "error"
  >(modeParam ? "connecting" : "selecting");
  const [timer, setTimer] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<any>(null);

  // Start matchmaking when a mode is selected (runs ONCE per mode selection)
  useEffect(() => {
    if (!selectedMode || status === "selecting") return;

    let timerInterval: NodeJS.Timeout;
    let cancelled = false;

    const initSocket = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session || cancelled) {
          if (!cancelled) {
            setError("Not authenticated");
            setStatus("error");
          }
          return;
        }

        const socket = gameSocket.connect(session.access_token);

        // Clear any stale listeners
        socket.off("connect");
        socket.off("connect_error");
        socket.off("queue_joined");
        socket.off("match_found");
        socket.off("error");

        const joinQueue = () => {
          if (cancelled) return;
          setStatus("searching");
          gameSocket.joinQueue(selectedMode);

          timerInterval = setInterval(() => {
            setTimer((t) => t + 1);
          }, 1000);
        };

        if (socket.connected) {
          joinQueue();
        } else {
          socket.on("connect", () => {
            joinQueue();
          });
        }

        socket.on("connect_error", (err) => {
          if (cancelled) return;
          console.error("Connection error:", err);
          setError("Failed to connect to server");
          setStatus("error");
        });

        socket.on("queue_joined", () => {
          // Queue joined successfully
        });

        socket.on("match_found", (data) => {
          if (cancelled) return;
          setMatchData(data);
          setStatus("found");
          clearInterval(timerInterval);

          setTimeout(() => {
            navigate(`/game/${data.matchId}`, { state: { matchData: data } });
          }, 3000);
        });

        socket.on("error", (data) => {
          if (cancelled) return;
          console.error("Socket error:", data);
          if (data.code === "PREMIUM_REQUIRED") {
            setError("Premium subscription required for ranked mode");
            setStatus("error");
          } else if (data.code !== "ALREADY_IN_MATCH") {
            // Ignore ALREADY_IN_MATCH (stale match cleanup race)
            setError(data.message);
            setStatus("error");
          }
        });
      } catch (err: any) {
        if (cancelled) return;
        console.error("Init error:", err);
        setError(err.message);
        setStatus("error");
      }
    };

    initSocket();

    return () => {
      cancelled = true;
      clearInterval(timerInterval);
      gameSocket.leaveQueue();
    };
    // Only re-run when selectedMode changes, NOT on status changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMode]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSelectMode = (mode: MatchMode) => {
    if (mode === "ranked" && !isPremium) {
      navigate("/pricing");
      return;
    }
    setSelectedMode(mode);
    setStatus("connecting");
  };

  const handleCancel = () => {
    if (status === "searching" || status === "connecting") {
      gameSocket.leaveQueue();
      gameSocket.disconnect();
    }
    if (status === "selecting") {
      navigate("/dashboard");
    } else {
      setSelectedMode(null);
      setStatus("selecting");
      setTimer(0);
      setError(null);
    }
  };

  const tierColor =
    RANK_TIERS[rankTier as keyof typeof RANK_TIERS]?.color || "#ffd700";

  if (status === "error") {
    return (
      <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center font-mono pixel-grid-bg">
        <div className="text-center">
          <div className="w-6 h-6 bg-red-500/40 border-2 border-red-500 mx-auto mb-6 animate-pixel-shake" />
          <h1 className="pixel-font text-xl text-red-600 mb-4 animate-retro-glow">
            {error?.includes("Premium")
              ? "PREMIUM REQUIRED"
              : "CONNECTION ERROR"}
          </h1>
          <p className="text-stone-400 mb-8 font-mono text-sm">{error}</p>
          <div className="flex gap-4 justify-center">
            {error?.includes("Premium") && (
              <button
                onClick={() => navigate("/pricing")}
                className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold hover:from-amber-400 hover:to-orange-400 rounded-lg"
              >
                GET PREMIUM
              </button>
            )}
            <button
              onClick={handleCancel}
              className="px-6 py-3 bg-stone-800 text-white font-bold hover:bg-stone-700 rounded-lg"
            >
              GO BACK
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center font-mono crt-scanlines pixel-grid-bg">
      {/* Floating pixel particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 bg-red-500/30"
            style={{
              left: `${8 + i * 8}%`,
              top: `${10 + (i % 5) * 18}%`,
              animation: `pixel-float ${2 + (i % 3)}s ease-in-out ${i * 0.3}s infinite`,
            }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ====== MODE SELECTION SCREEN ====== */}
        {status === "selecting" && (
          <motion.div
            key="selecting"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center"
          >
            <h1 className="pixel-font text-2xl md:text-3xl text-white mb-2 tracking-tight">
              SELECT <span className="text-red-500 animate-retro-glow">MODE</span>
            </h1>
            <p className="text-stone-500 text-sm mb-12 animate-pixel-blink">
              &gt; Choose your battlefield _
            </p>

            <div className="flex flex-col md:flex-row gap-6">
              {/* Unranked Card */}
              <button
                onClick={() => handleSelectMode("unranked")}
                className="group relative w-72 p-6 bg-stone-900/50 border-2 border-stone-700 rounded-none hover:border-stone-400 hover:bg-stone-900/80 transition-all duration-150 text-left"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-lg bg-stone-800 flex items-center justify-center">
                    <Swords className="w-6 h-6 text-stone-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white">UNRANKED</h2>
                    <p className="text-xs text-stone-500 uppercase tracking-wider">
                      Casual Play
                    </p>
                  </div>
                </div>
                <p className="text-sm text-stone-400 leading-relaxed">
                  Play for fun. No rating changes. Practice your skills against
                  other players.
                </p>
                <div className="mt-4 pt-4 border-t border-stone-800">
                  <span className="text-xs text-stone-600 uppercase tracking-wider">
                    Free for all players
                  </span>
                </div>
              </button>

              {/* Ranked Card */}
              <button
                onClick={() => handleSelectMode("ranked")}
                className={`group relative w-72 p-6 rounded-none transition-all duration-150 text-left ${
                  isPremium
                    ? "bg-gradient-to-b from-amber-950/30 to-stone-900/50 border-2 border-amber-700/60 hover:border-amber-400"
                    : "bg-stone-900/30 border-2 border-stone-700 hover:border-stone-500"
                }`}
              >
                {/* Premium glow */}
                {isPremium && (
                  <div className="absolute -inset-[1px] bg-gradient-to-b from-amber-500/20 to-transparent rounded-xl blur-sm -z-10" />
                )}

                <div className="flex items-center gap-3 mb-4">
                  <div
                    className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                      isPremium ? "bg-amber-900/50" : "bg-stone-800"
                    }`}
                  >
                    <Crown
                      className={`w-6 h-6 ${
                        isPremium ? "text-amber-400" : "text-stone-600"
                      }`}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-black text-white">RANKED</h2>
                      {!isPremium && (
                        <Lock className="w-4 h-4 text-stone-600" />
                      )}
                    </div>
                    <p className="text-xs text-amber-500/80 uppercase tracking-wider">
                      Competitive
                    </p>
                  </div>
                </div>

                <p className="text-sm text-stone-400 leading-relaxed">
                  Compete for ELO rating. Climb the ranks. Get matched with
                  players at your skill level.
                </p>

                {isPremium ? (
                  <div className="mt-4 pt-4 border-t border-amber-900/30">
                    <div className="flex items-center justify-between">
                      <span
                        className="text-sm font-bold"
                        style={{ color: tierColor }}
                      >
                        {rankTier} - {currentRating} ELO
                      </span>
                      <Shield className="w-4 h-4 text-amber-500" />
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 pt-4 border-t border-stone-800">
                    <span className="text-xs text-amber-500 uppercase tracking-wider">
                      Premium required
                    </span>
                  </div>
                )}
              </button>
            </div>

            <button
              onClick={() => navigate("/dashboard")}
              className="mt-10 text-stone-600 hover:text-stone-400 text-sm transition-colors"
            >
              Back to Dashboard
            </button>
          </motion.div>
        )}

        {/* ====== CONNECTING ====== */}
        {status === "connecting" && (
          <motion.div
            key="connecting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-center"
          >
            <div className="text-2xl text-stone-400 animate-pulse">
              Connecting...
            </div>
            {selectedMode === "ranked" && (
              <div className="mt-4 text-sm text-amber-500">
                <Crown className="w-4 h-4 inline mr-1" />
                Ranked Mode
              </div>
            )}
          </motion.div>
        )}

        {/* ====== SEARCHING ====== */}
        {status === "searching" && (
          <motion.div
            key="searching"
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex flex-col items-center relative"
          >
            {/* Mode badge */}
            {selectedMode === "ranked" && (
              <div className="absolute -top-16 flex items-center gap-2 px-4 py-1.5 bg-amber-900/30 border border-amber-700/50 rounded-full">
                <Crown className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                  Ranked
                </span>
                <span
                  className="text-xs font-mono"
                  style={{ color: tierColor }}
                >
                  {currentRating}
                </span>
              </div>
            )}

            {/* Radar Ring */}
            <div className="relative w-64 h-64 md:w-96 md:h-96 border border-stone-800 rounded-full flex items-center justify-center mb-12">
              <div
                className={`absolute inset-0 border-2 rounded-full animate-[ping_2s_linear_infinite] ${
                  selectedMode === "ranked"
                    ? "border-amber-900/30"
                    : "border-red-900/30"
                }`}
              ></div>
              <div
                className={`absolute inset-0 border-t-2 rounded-full animate-[radar-spin_3s_linear_infinite] ${
                  selectedMode === "ranked"
                    ? "border-amber-500"
                    : "border-red-600"
                }`}
              ></div>
              <div
                className={`absolute inset-0 ${
                  selectedMode === "ranked"
                    ? "bg-[radial-gradient(circle,rgba(245,158,11,0.1)_0%,transparent_70%)]"
                    : "bg-[radial-gradient(circle,rgba(220,38,38,0.1)_0%,transparent_70%)]"
                }`}
              ></div>

              <div className="text-center z-10">
                <div className="pixel-font text-3xl text-white mb-3 tracking-widest animate-retro-glow">
                  {formatTime(timer)}
                </div>
                <div
                  className={`pixel-font text-[10px] uppercase tracking-widest animate-pixel-blink ${
                    selectedMode === "ranked"
                      ? "text-amber-500"
                      : "text-red-500"
                  }`}
                >
                  {selectedMode === "ranked" ? "Finding Opponent" : "Searching..."}
                </div>
              </div>
            </div>

            <div className="mt-8 flex gap-8 text-stone-600 text-xs uppercase tracking-widest">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4" />
                LIVE SERVER
              </div>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                {selectedMode === "ranked" ? "ELO MATCHED" : "GLOBAL"}
              </div>
            </div>

            <button
              onClick={handleCancel}
              className={`mt-12 px-6 py-2 border transition ${
                selectedMode === "ranked"
                  ? "border-amber-900 text-amber-500 hover:bg-amber-900/20"
                  : "border-red-900 text-red-500 hover:bg-red-900/20"
              }`}
            >
              CANCEL
            </button>
          </motion.div>
        )}

        {/* ====== MATCH FOUND ====== */}
        {status === "found" && (
          <motion.div
            key="found"
            initial={{ opacity: 0, scale: 1.5 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative flex flex-col items-center justify-center w-full h-full"
          >
            <motion.div
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className={`absolute inset-0 z-0 ${
                selectedMode === "ranked" ? "bg-amber-600" : "bg-red-600"
              }`}
            />

            <div className="relative z-10 text-center">
              {/* Ranked badge */}
              {matchData?.matchType === "ranked" && (
                <div className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 bg-amber-900/40 border border-amber-700/50 rounded-full">
                  <Crown className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                    Ranked Match
                  </span>
                </div>
              )}

              <h1 className="pixel-font text-4xl md:text-6xl text-white tracking-tighter mb-4 mix-blend-difference animate-pixel-expand">
                <GlitchText text="MATCH" /> <br />
                <span
                  className={`animate-retro-glow ${
                    selectedMode === "ranked"
                      ? "text-amber-500"
                      : "text-red-600"
                  }`}
                >
                  FOUND
                </span>
              </h1>

              <div className="flex items-center justify-center gap-12 mt-12">
                <div className="text-center">
                  <div className="w-24 h-24 bg-stone-900 rounded-none border-2 border-white flex items-center justify-center mb-4 animate-pixel-expand">
                    <span className="pixel-font text-lg">YOU</span>
                  </div>
                  <div className="pixel-font text-[10px] text-stone-500">Ready</div>
                </div>

                <div className="pixel-font text-3xl text-red-600 animate-pixel-bounce">
                  VS
                </div>

                <div className="text-center">
                  <div className="w-24 h-24 bg-stone-900 rounded-none border-2 border-red-600 flex items-center justify-center mb-4 relative overflow-hidden animate-pixel-expand" style={{ animationDelay: '0.2s' }}>
                    <div className="absolute inset-0 bg-red-900/20 animate-pulse"></div>
                    <span className="pixel-font text-lg text-red-500">
                      {matchData?.opponent?.username?.[0] || "?"}
                    </span>
                  </div>
                  <div className="pixel-font text-[10px] text-stone-400">
                    {matchData?.opponent?.username || "OPPONENT"}
                  </div>
                  {matchData?.opponent?.elo &&
                    matchData?.matchType === "ranked" && (
                      <div className="text-xs text-stone-600 mt-1">
                        {matchData.opponent.elo} ELO
                      </div>
                    )}
                </div>
              </div>

              <p className="mt-12 pixel-font text-stone-500 text-[10px] uppercase tracking-[0.3em] animate-pixel-blink">
                Loading Game...
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default RealMatchmakingPage;
