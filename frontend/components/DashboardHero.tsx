import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Swords, Trophy, Activity, Zap } from "lucide-react";
import GlitchText from "./GlitchText";
import ThreeDTilt from "./ThreeDTilt";
import { useAuth } from "../contexts/AuthContext";
import { getCurrentUserProfile } from "../lib/api";
import { Profile } from "../types/database";

interface DashboardHeroProps {
  onFindMatch: () => void;
  activeMatchId?: string | null;
  onResumeMatch?: () => void;
  checkingMatch?: boolean;
}

const DashboardHero: React.FC<DashboardHeroProps> = ({
  onFindMatch,
  activeMatchId,
  onResumeMatch,
  checkingMatch = false,
}) => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Get username from profile or user metadata or fallback
  const username =
    profile?.username ||
    user?.user_metadata?.username ||
    user?.user_metadata?.display_name ||
    user?.email?.split("@")[0] ||
    "CodeMaster";

  // Fetch profile data
  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      try {
        const profileData = await getCurrentUserProfile();
        setProfile(profileData);
      } catch (error) {
        console.error("Error fetching profile:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);
  return (
    <div className="relative min-h-[90vh] flex flex-col items-center justify-center pt-16 overflow-hidden bg-[#050505]">
      {/* Background Grid */}
      <div className="absolute inset-0 overflow-hidden perspective-1000 opacity-30">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:40px_40px] [transform:rotateX(60deg)_translateY(-20%)_scale(2)] origin-top"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-[#050505] via-transparent to-[#050505]"></div>
      </div>

      <div className="max-w-6xl w-full mx-auto px-4 z-10 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        {/* Left: User Stats */}
        <div className="space-y-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              <span className="text-xs font-mono text-emerald-500 uppercase tracking-widest">
                Connection Stable
              </span>
            </div>
            <h1 className="text-5xl md:text-7xl font-black text-white font-mono tracking-tighter mb-2">
              WELCOME, <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-stone-500 uppercase">
                {loading ? "LOADING..." : username}
              </span>
            </h1>
            <p className="text-stone-500 font-mono text-sm max-w-md">
              System ready. Start competing to climb the global leaderboard.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-stone-900/40 border border-stone-800 rounded-sm relative">
              <div className="text-xs text-stone-500 font-mono uppercase mb-1">
                Global Rank
              </div>
              <div className="text-lg font-bold text-stone-600 flex items-center gap-2">
                {loading ? "..." : "COMING SOON"}
                <Activity className="w-4 h-4 text-stone-700" />
              </div>
              {!loading && (
                <div className="absolute top-2 right-2 bg-stone-800 text-stone-500 text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest">
                  SOON
                </div>
              )}
            </div>
            <div className="p-4 bg-stone-900/40 border border-stone-800 rounded-sm relative">
              <div className="text-xs text-stone-500 font-mono uppercase mb-1">
                Global Rank
              </div>
              <div
                className={`text-lg font-bold ${
                  profile?.global_rank ? "text-white" : "text-stone-600"
                }`}
              >
                {loading
                  ? "..."
                  : profile?.global_rank
                  ? `#${profile.global_rank.toLocaleString()}`
                  : "COMING SOON"}
              </div>
              {!loading && !profile?.global_rank && (
                <div className="absolute top-2 right-2 bg-stone-800 text-stone-500 text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-widest">
                  SOON
                </div>
              )}
            </div>
            <div className="p-4 bg-stone-900/40 border border-stone-800 rounded-sm">
              <div className="text-xs text-stone-500 font-mono uppercase mb-1">
                Win Rate
              </div>
              <div className="text-2xl font-bold text-red-500">
                {loading ? "..." : `${profile?.win_rate?.toFixed(1) || "0.0"}%`}
              </div>
            </div>
          </div>

          {activeMatchId ? (
            <button
              onClick={onResumeMatch}
              className="group w-full md:w-auto relative px-8 py-6 bg-emerald-600 hover:bg-emerald-500 transition-all rounded-sm overflow-hidden flex items-center justify-center gap-4 shadow-[0_0_40px_rgba(16,185,129,0.3)] hover:shadow-[0_0_60px_rgba(16,185,129,0.5)] animate-pulse"
            >
              <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.2)_50%,transparent_75%)] bg-[length:250%_250%,100%_100%] animate-[shine_3s_infinite]"></div>
              <Activity className="w-8 h-8 text-white group-hover:scale-110 transition-transform" />
              <div className="text-left">
                <div className="text-2xl font-black text-white italic tracking-tighter uppercase">
                  Resume Match
                </div>
                <div className="text-[10px] text-emerald-200 font-mono tracking-widest">
                  MATCH IN PROGRESS • CLICK TO REJOIN
                </div>
              </div>
            </button>
          ) : (
            <button
              onClick={onFindMatch}
              disabled={checkingMatch}
              className="group w-full md:w-auto relative px-8 py-6 bg-red-600 hover:bg-red-500 transition-all rounded-sm overflow-hidden flex items-center justify-center gap-4 shadow-[0_0_40px_rgba(220,38,38,0.3)] hover:shadow-[0_0_60px_rgba(220,38,38,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.2)_50%,transparent_75%)] bg-[length:250%_250%,100%_100%] animate-[shine_3s_infinite]"></div>
              <Swords className="w-8 h-8 text-white group-hover:rotate-12 transition-transform" />
              <div className="text-left">
                <div className="text-2xl font-black text-white italic tracking-tighter uppercase">
                  {checkingMatch ? "Checking..." : "Enter Queue"}
                </div>
                <div className="text-[10px] text-red-200 font-mono tracking-widest">
                  RANKED 1v1 • EST 12s
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Right: 3D Featured Card */}
        <div className="hidden md:flex justify-center perspective-1000">
          <ThreeDTilt intensity={15} className="w-full max-w-md">
            <div className="relative bg-[#0a0a0a] border border-stone-800 p-8 rounded-lg overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-20">
                <Swords className="w-32 h-32 text-white" />
              </div>

              <div className="relative z-10">
                <div className="text-emerald-500 font-mono text-xs font-bold uppercase tracking-widest mb-4">
                  System Status
                </div>
                <h3 className="text-3xl font-bold text-white mb-4">
                  Matchmaking Active
                </h3>
                <p className="text-stone-400 text-sm mb-6 leading-relaxed">
                  Jump into ranked 1v1 battles and compete against opponents
                  from around the world. Our intelligent matchmaking system
                  ensures you're always finding competitive matches.
                </p>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-xs font-mono text-stone-300">
                      Global matchmaking active
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-xs font-mono text-stone-300">
                      Players online 24/7
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-xs font-mono text-stone-300">
                      Average wait time: &lt;30 seconds
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-stone-400 text-xs font-mono">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  <span>Earn ELO • Climb Rankings • Track Stats</span>
                </div>
              </div>
            </div>
          </ThreeDTilt>
        </div>
      </div>
    </div>
  );
};

export default DashboardHero;
