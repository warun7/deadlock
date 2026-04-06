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
    <div className="relative min-h-[90vh] flex flex-col items-center justify-center pt-20 sm:pt-16 overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Background Grid */}
      <div className="absolute inset-0 overflow-hidden perspective-1000 opacity-30">
        <div 
          className="absolute inset-0 bg-[size:40px_40px] [transform:rotateX(60deg)_translateY(-20%)_scale(2)] origin-top"
          style={{ backgroundImage: `linear-gradient(to right, var(--grid-line-color) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-line-color) 1px, transparent 1px)` }}
        ></div>
        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, var(--bg-primary), transparent, var(--bg-primary))` }}></div>
      </div>

      <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 z-10 grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
        {/* Left: User Stats */}
        <div className="space-y-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              <span className="text-xs font-mono text-emerald-500 uppercase tracking-widest">
                Connection Stable
              </span>
            </div>
            <h1 className="text-3xl sm:text-5xl md:text-7xl font-black font-mono tracking-tighter mb-2" style={{ color: 'var(--text-primary)' }}>
              WELCOME, <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-red-700 uppercase break-all sm:break-normal">
                {loading ? "LOADING..." : username}
              </span>
            </h1>
            <p className="font-mono text-sm max-w-md" style={{ color: 'var(--text-dim)' }}>
              System ready. Start competing to climb the global leaderboard.
            </p>
          </div>

          <div className="flex gap-3 sm:gap-4">

            <div className="p-4 rounded-sm theme-transition" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-primary)' }}>
              <div className="text-xs font-mono uppercase mb-1" style={{ color: 'var(--text-dim)' }}>
                Win Rate
              </div>
              <div className="text-xl sm:text-2xl font-bold text-red-500">
                {loading ? "..." : `${profile?.win_rate?.toFixed(1) || "0.0"}%`}
              </div>
            </div>
          </div>

          {activeMatchId ? (
            <button
              onClick={onResumeMatch}
              className="group w-full relative px-6 sm:px-8 py-5 sm:py-6 bg-emerald-600 hover:bg-emerald-500 transition-all rounded-sm overflow-hidden flex items-center justify-center gap-3 sm:gap-4"
            >
              <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.2)_50%,transparent_75%)] bg-[length:250%_250%,100%_100%] animate-[shine_3s_infinite]"></div>
              <Activity className="w-8 h-8 text-white group-hover:scale-110 transition-transform" />
              <div className="text-left">
                <div className="text-xl sm:text-2xl font-black text-white italic tracking-tighter uppercase">
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
              className="group w-full relative px-6 sm:px-8 py-5 sm:py-6 bg-red-600 hover:bg-red-500 transition-all rounded-sm overflow-hidden flex items-center justify-center gap-3 sm:gap-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.2)_50%,transparent_75%)] bg-[length:250%_250%,100%_100%] animate-[shine_3s_infinite]"></div>
              <Swords className="w-8 h-8 text-white group-hover:rotate-12 transition-transform" />
              <div className="text-left">
                <div className="text-xl sm:text-2xl font-black text-white italic tracking-tighter uppercase">
                  {checkingMatch ? "Checking..." : "Enter Queue"}
                </div>
                <div className="text-[10px] text-red-200 font-mono tracking-widest">
                  1V1 MATCHMAKING • EST 12s
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Right: 3D Featured Card */}
        <div className="hidden md:flex justify-center perspective-1000">
          <ThreeDTilt intensity={15} className="w-full max-w-md">
            <div className="relative p-8 rounded-lg overflow-hidden group theme-transition" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
              <div className="absolute top-0 right-0 p-4 opacity-20">
                <Swords className="w-32 h-32 text-white" />
              </div>

              <div className="relative z-10">
                <div className="text-emerald-500 font-mono text-xs font-bold uppercase tracking-widest mb-4">
                  System Status
                </div>
                <h3 className="text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                  Matchmaking Active
                </h3>
                <p className="text-sm mb-6 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Jump into 1v1 battles and compete against opponents
                  from around the world. Our intelligent matchmaking system
                  ensures you're always finding competitive matches.
                </p>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                      Global matchmaking active
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                      Players online 24/7
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                      Average wait time: &lt;30 seconds
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-stone-400 text-xs font-mono">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  <span>Test your skills • Code fast • Compete</span>
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
