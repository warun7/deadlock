import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Clock,
  Code2,
  Crosshair,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import ThreeDTilt from "./ThreeDTilt";
import {
  getUserProfileByUsername,
  getRecentMatchesByUserId,
  getAllMatchesByUserId,
} from "../lib/api";
import { Profile, MatchDetailed } from "../types/database";
import MatchHistoryModal from "./MatchHistoryModal";

const PublicProfilePage: React.FC = () => {
  const { targetUsername } = useParams<{ targetUsername: string }>();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [recentMatches, setRecentMatches] = useState<MatchDetailed[]>([]);
  const [allMatchesData, setAllMatchesData] = useState<MatchDetailed[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loadingAllMatches, setLoadingAllMatches] = useState(false);

  useEffect(() => {
    if (!targetUsername) return;

    const fetchData = async () => {
      setLoading(true);
      setNotFound(false);

      const profileData = await getUserProfileByUsername(targetUsername);

      if (!profileData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setProfile(profileData);

      const matchesData = await getRecentMatchesByUserId(profileData.id, 5);
      setRecentMatches(matchesData);
      setLoading(false);
    };

    fetchData();
  }, [targetUsername]);

  const handleViewAllMatches = async () => {
    setIsModalOpen(true);
    if (allMatchesData.length === 0 && profile) {
      setLoadingAllMatches(true);
      const matches = await getAllMatchesByUserId(profile.id);
      setAllMatchesData(matches);
      setLoadingAllMatches(false);
    }
  };

  const avatarSeed = (profile?.username || targetUsername || "user").replace(
    /[^a-zA-Z0-9]/g,
    ""
  );
  const avatarUrl =
    profile?.avatar_url ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}&backgroundColor=b6e3f4`;

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center font-mono"
        style={{ backgroundColor: "var(--bg-primary)" }}
      >
        <div className="flex items-center gap-3 text-stone-400">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-sm uppercase tracking-widest">
            Loading profile...
          </span>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div
        className="min-h-screen flex items-center justify-center font-mono"
        style={{ backgroundColor: "var(--bg-primary)" }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-sm px-6"
        >
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-6 opacity-60" />
          <h1 className="text-3xl font-black text-white mb-3 tracking-tighter">
            User Not Found
          </h1>
          <p className="text-stone-500 text-sm mb-2">
            No player with username{" "}
            <span className="text-red-400 font-bold">
              &quot;{targetUsername}&quot;
            </span>{" "}
            exists.
          </p>
          <p className="text-stone-600 text-xs mb-8">
            Check the URL or ask your opponent to share their profile link.
          </p>
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 mx-auto px-6 py-3 bg-stone-900 hover:bg-stone-800 border border-stone-700 hover:border-red-600 text-white font-bold text-sm uppercase tracking-wider transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Home
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen pt-20 sm:pt-24 pb-12 font-mono relative overflow-hidden"
      style={{ backgroundColor: "var(--bg-primary)" }}
    >
      {/* Background Grid */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-red-900/10 to-transparent" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">

        {/* Back button */}
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-stone-500 hover:text-white text-xs uppercase tracking-widest mb-8 transition-colors group"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          Back
        </motion.button>

        {/* Profile Header */}
        <div
          className="flex flex-col md:flex-row gap-6 md:gap-8 items-start md:items-end mb-12 md:mb-16 pb-6 md:pb-8"
          style={{ borderBottom: "1px solid var(--border-primary)" }}
        >
          <ThreeDTilt intensity={10} className="w-auto mx-auto md:mx-0">
            <div
              className="relative w-40 h-40 rounded-sm border-2 p-1"
              style={{
                backgroundColor: "var(--bg-card-solid)",
                borderColor: "var(--border-primary)",
              }}
            >
              <div className="w-full h-full overflow-hidden bg-black relative">
                <img
                  src={avatarUrl}
                  alt={`${profile?.username}'s avatar`}
                  className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-300"
                />
                <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
              </div>
              <div className="absolute -bottom-3 -right-3 bg-stone-700 text-stone-300 text-[10px] font-bold px-2 py-0.5 uppercase tracking-widest border border-black shadow-[4px_4px_0_black]">
                PLAYER
              </div>
            </div>
          </ThreeDTilt>

          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-red-500 font-bold tracking-widest text-xs uppercase">
                [ Public Profile ]
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-6xl font-black text-white tracking-tighter break-all sm:break-normal mb-2">
              {profile?.username}
            </h1>

            <p className="text-stone-600 text-xs font-bold uppercase tracking-wide">
              Member since{" "}
              {profile?.created_at
                ? new Date(profile.created_at).toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })
                : "—"}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-8">
          {[
            {
              label: "Win Rate",
              value: `${profile?.win_rate?.toFixed(1) || "0.0"}%`,
              icon: <Crosshair className="w-4 h-4" />,
              color: "text-emerald-400",
            },
            {
              label: "Best Streak",
              value: `${profile?.best_streak || 0} Win${
                (profile?.best_streak || 0) === 1 ? "" : "s"
              }`,
              icon: <Zap className="w-4 h-4" />,
              color: "text-yellow-400",
            },
            {
              label: "Total Matches",
              value: `${profile?.total_matches || 0}`,
              icon: <Code2 className="w-4 h-4" />,
              color: "text-blue-400",
            },
          ].map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-4 relative group overflow-hidden"
              style={{
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border-primary)",
              }}
            >
              <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                {stat.icon}
              </div>
              <div className="text-[10px] text-stone-500 uppercase tracking-widest mb-1">
                {stat.label}
              </div>
              <div className={`text-xl font-black ${stat.color}`}>
                {stat.value}
              </div>
              <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-stone-700 to-transparent group-hover:via-red-600 transition-colors" />
            </motion.div>
          ))}
        </div>

        {/* Match History */}
        <div
          className="p-6 relative"
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-primary)",
          }}
        >
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-white uppercase flex items-center gap-2">
              <Clock className="w-4 h-4 text-red-500" />
              Recent Matches
            </h3>
            <button
              onClick={handleViewAllMatches}
              className="text-[10px] text-stone-500 hover:text-white uppercase tracking-widest transition-colors"
            >
              View All
            </button>
          </div>

          <div className="space-y-1">
            {recentMatches.length === 0 ? (
              <div className="text-center text-stone-500 py-8">
                <Code2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No matches played yet.</p>
              </div>
            ) : (
              <>
                {/* Desktop rows */}
                {recentMatches.map((match) => {
                  const isWin = match.result === "won";
                  const isDraw = match.result === "draw";
                  const resultLetter = isWin ? "W" : isDraw ? "D" : "L";
                  const resultColor = isWin
                    ? "bg-emerald-500/10 text-emerald-500"
                    : isDraw
                    ? "bg-yellow-500/10 text-yellow-500"
                    : "bg-red-500/10 text-red-500";

                  return (
                    <div
                      key={match.id}
                      className="hidden sm:grid grid-cols-12 gap-4 items-center p-3 hover:bg-stone-900/50 transition-colors border-l-2 border-transparent hover:border-red-600 group"
                    >
                      <div className="col-span-1">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${resultColor}`}
                        >
                          {resultLetter}
                        </span>
                      </div>
                      <div className="col-span-4 text-sm font-bold text-stone-300 group-hover:text-white transition-colors">
                        {match.bot_username || match.opponent_username}
                      </div>
                      <div className="col-span-4 text-xs text-stone-500">
                        {match.problem_title}
                      </div>
                      <div className="col-span-3 text-right text-[10px] text-stone-600 uppercase">
                        {match.language}
                      </div>
                    </div>
                  );
                })}

                {/* Mobile cards */}
                {recentMatches.map((match) => {
                  const isWin = match.result === "won";
                  const isDraw = match.result === "draw";
                  const resultLetter = isWin ? "W" : isDraw ? "D" : "L";
                  const resultColor = isWin
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                    : isDraw
                    ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                    : "bg-red-500/10 text-red-500 border-red-500/20";

                  return (
                    <div
                      key={`mobile-${match.id}`}
                      className="sm:hidden flex items-center gap-3 p-3 hover:bg-stone-900/50 transition-colors border-l-2 border-transparent hover:border-red-600"
                    >
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm shrink-0 ${resultColor}`}
                      >
                        {resultLetter}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-stone-300 truncate">
                          {match.bot_username || match.opponent_username}
                        </div>
                        <div className="text-[10px] text-stone-600 truncate">
                          {match.problem_title} · {match.language}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Match History Modal */}
      <MatchHistoryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        matches={allMatchesData}
        loading={loadingAllMatches}
      />
    </div>
  );
};

export default PublicProfilePage;
