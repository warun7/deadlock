import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  Lock,
  Terminal,
  Shield,
  Cpu,
  Github,
  Mail,
  Key,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import ThreeDTilt from "./ThreeDTilt";
import GlitchText from "./GlitchText";

const GOOGLE_CLIENT_ID: string =
  "943611085882-csv3fvtir81prgeusd7qd37vd3n77r1v.apps.googleusercontent.com";

interface AuthPageProps {
  onBack: () => void;
  onLogin: () => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ onBack, onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  // Check if we have a real Client ID
  const hasRealId =
    GOOGLE_CLIENT_ID &&
    GOOGLE_CLIENT_ID.length > 0 &&
    !GOOGLE_CLIENT_ID.includes("YOUR_CLIENT_ID");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setLoading(false);
      onLogin();
    }, 1500);
  };

  const loginWithGoogle = () => {
    setLoading(true);

    if (window.google && hasRealId) {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/userinfo.profile",
        callback: (response: any) => {
          if (response.access_token) {
            // Real OAuth Success - Fetch User Info
            fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${response.access_token}` },
            })
              .then((res) => res.json())
              .then((data) => {
                console.log("Logged in as:", data.name);
                setLoading(false);
                onLogin();
              })
              .catch((err) => {
                console.error(err);
                setLoading(false);
              });
          }
        },
      });
      client.requestAccessToken();
    } else {
      // Fallback Simulation for Demo
      console.log("Running in Demo Mode (No Client ID provided)");
      setTimeout(() => {
        setLoading(false);
        onLogin();
      }, 1500);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-4 relative overflow-hidden font-mono">
      {/* Background Effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#222_1px,transparent_1px),linear-gradient(to_bottom,#222_1px,transparent_1px)] bg-[size:40px_40px] opacity-10 [transform:perspective(1000px)_rotateX(60deg)] origin-top h-1/2"></div>
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,transparent_0%,#050505_100%)]"></div>
      </div>

      {/* Back Button */}
      <button
        onClick={onBack}
        className="absolute top-8 left-8 z-50 flex items-center gap-2 text-stone-500 hover:text-red-500 transition-colors group"
      >
        <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
        <span className="text-xs font-bold tracking-widest uppercase">
          Abort_Sequence
        </span>
      </button>

      {/* Demo Mode Badge */}
      {!hasRealId && (
        <div className="absolute top-8 right-8 z-50 flex items-center gap-2 px-3 py-1 bg-yellow-500/10 border border-yellow-500/30 rounded-full text-yellow-500 text-[10px] font-bold uppercase tracking-widest animate-pulse">
          <AlertTriangle className="w-3 h-3" />
          Demo Environment
        </div>
      )}

      <div className="w-full max-w-md relative z-20">
        <ThreeDTilt intensity={10} className="w-full">
          <div className="bg-[#0a0a0a] border border-stone-800 rounded-sm overflow-hidden relative group">
            {/* Scanline Overlay */}
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] z-50 opacity-20"></div>

            {/* Header */}
            <div className="p-8 pb-0 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border border-red-900/40 bg-red-950/30 text-red-400 text-[10px] font-mono uppercase tracking-widest">
                <Lock className="w-3 h-3" />
                SECURE_GATEWAY // 443
              </div>
              <h2 className="text-3xl font-black text-white tracking-tighter mb-2">
                <GlitchText text={isLogin ? "SYSTEM_LOGIN" : "NEW_USER_REG"} />
              </h2>
              <p className="text-xs text-stone-500 uppercase tracking-widest">
                {isLogin
                  ? "Enter credentials to access mainframe"
                  : "Initialize new developer profile"}
              </p>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-stone-800 mt-8">
              <button
                onClick={() => setIsLogin(true)}
                className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest transition-colors relative ${
                  isLogin
                    ? "text-white bg-stone-900/50"
                    : "text-stone-600 hover:text-stone-400"
                }`}
              >
                Login
                {isLogin && (
                  <div className="absolute bottom-0 left-0 w-full h-[2px] bg-red-600"></div>
                )}
              </button>
              <button
                onClick={() => setIsLogin(false)}
                className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest transition-colors relative ${
                  !isLogin
                    ? "text-white bg-stone-900/50"
                    : "text-stone-600 hover:text-stone-400"
                }`}
              >
                Register
                {!isLogin && (
                  <div className="absolute bottom-0 left-0 w-full h-[2px] bg-red-600"></div>
                )}
              </button>
            </div>

            {/* Form */}
            <div className="p-8 bg-[#080808]">
              {/* Google Auth - Primary */}
              <button
                type="button"
                onClick={loginWithGoogle}
                className="w-full bg-white text-black font-black uppercase text-sm py-3 px-4 flex items-center justify-center gap-3 hover:bg-stone-200 transition-colors mb-6 group relative overflow-hidden"
              >
                <img
                  src="https://www.svgrepo.com/show/475656/google-color.svg"
                  alt="Google"
                  className="w-5 h-5 relative z-10"
                />
                <span className="relative z-10 tracking-wider">
                  Continue with Google
                </span>
                <div className="absolute inset-0 bg-red-500 translate-y-full group-hover:translate-y-0 transition-transform duration-300 z-0"></div>
                <span className="relative z-10 group-hover:text-white transition-colors duration-200 absolute top-0 left-0 w-full h-full flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100">
                  ACCESS_GRANTED
                </span>
              </button>

              <div className="flex items-center gap-4 mb-6">
                <div className="h-[1px] flex-1 bg-stone-800"></div>
                <span className="text-[10px] text-stone-600 uppercase font-bold">
                  OR USE ENCRYPTION KEY
                </span>
                <div className="h-[1px] flex-1 bg-stone-800"></div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-stone-500 ml-1">
                    Identity // Email
                  </label>
                  <div className="relative group">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600 group-focus-within:text-red-500 transition-colors" />
                    <input
                      type="email"
                      placeholder="usr@deadlock.dev"
                      className="w-full bg-[#050505] border border-stone-800 text-stone-300 text-sm py-3 pl-10 pr-4 focus:outline-none focus:border-red-600 focus:bg-stone-900/30 transition-all placeholder:text-stone-700"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-stone-500 ml-1">
                    Passphrase
                  </label>
                  <div className="relative group">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600 group-focus-within:text-red-500 transition-colors" />
                    <input
                      type="password"
                      placeholder="••••••••••••"
                      className="w-full bg-[#050505] border border-stone-800 text-stone-300 text-sm py-3 pl-10 pr-4 focus:outline-none focus:border-red-600 focus:bg-stone-900/30 transition-all placeholder:text-stone-700"
                    />
                  </div>
                </div>

                {!isLogin && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="space-y-1"
                  >
                    <label className="text-[10px] uppercase font-bold text-stone-500 ml-1">
                      Confirm Passphrase
                    </label>
                    <div className="relative group">
                      <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600 group-focus-within:text-red-500 transition-colors" />
                      <input
                        type="password"
                        placeholder="••••••••••••"
                        className="w-full bg-[#050505] border border-stone-800 text-stone-300 text-sm py-3 pl-10 pr-4 focus:outline-none focus:border-red-600 focus:bg-stone-900/30 transition-all placeholder:text-stone-700"
                      />
                    </div>
                  </motion.div>
                )}

                <button
                  disabled={loading}
                  className="w-full mt-6 bg-stone-900 border border-stone-800 text-white font-bold uppercase text-xs py-3 px-4 hover:border-red-600 hover:text-red-500 transition-all flex items-center justify-between group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>{loading ? "INITIALIZING..." : "EXECUTE"}</span>
                  <ArrowRight
                    className={`w-4 h-4 transition-transform ${
                      loading ? "animate-spin" : "group-hover:translate-x-1"
                    }`}
                  />
                </button>
              </form>
            </div>

            {/* Footer */}
            <div className="p-4 bg-[#050505] border-t border-stone-900 flex justify-between items-center text-[10px] text-stone-600 font-mono">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                SYSTEM ONLINE
              </div>
              <div className="flex gap-4">
                <a href="#" className="hover:text-stone-400">
                  RECOVER_PWD
                </a>
                <a href="#" className="hover:text-stone-400">
                  HELP
                </a>
              </div>
            </div>
          </div>
        </ThreeDTilt>

        <div className="mt-8 text-center">
          <p className="text-[10px] text-stone-700 font-mono uppercase tracking-widest">
            By accessing this system you agree to the <br />
            <a
              href="#"
              className="text-stone-500 hover:text-red-500 underline decoration-stone-800"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="#"
              className="text-stone-500 hover:text-red-500 underline decoration-stone-800"
            >
              Privacy Protocols
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
