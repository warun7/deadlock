import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Crown,
  Check,
  Shield,
  Swords,
  Trophy,
  ArrowLeft,
  Loader2,
  Sparkles,
} from "lucide-react";
import Navbar from "../components/Navbar";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

const BACKEND_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";

const PricingPage: React.FC = () => {
  const navigate = useNavigate();
  const { isLoggedIn, isPremium, logout, user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async () => {
    if (!isLoggedIn) {
      navigate("/auth");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        navigate("/auth");
        return;
      }

      const response = await fetch(
        `${BACKEND_URL}/api/stripe/create-checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Failed to create checkout session");
      }
    } catch (err: any) {
      console.error("Checkout error:", err);
      setError("Failed to start checkout. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setIsLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) return;

      const response = await fetch(`${BACKEND_URL}/api/stripe/portal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Portal error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const features = [
    {
      icon: <Swords className="w-5 h-5" />,
      title: "Ranked Mode",
      description:
        "Compete in ELO-rated matches against players at your skill level",
    },
    {
      icon: <Trophy className="w-5 h-5" />,
      title: "Rank Tiers",
      description:
        "Climb from Iron to Master. Your rank is displayed on your profile",
    },
    {
      icon: <Shield className="w-5 h-5" />,
      title: "Premium Badge",
      description:
        "Stand out with a premium badge on your profile and in matches",
    },
    {
      icon: <Sparkles className="w-5 h-5" />,
      title: "Ranked Leaderboard",
      description: "Compete for the top spot on the ranked leaderboard",
    },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <Navbar
        isLoggedIn={isLoggedIn}
        onLogin={() => navigate("/auth")}
        onProfile={() => navigate("/profile")}
        onDashboard={() => navigate("/dashboard")}
        onLogout={handleLogout}
      />

      <div className="pt-24 pb-20 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-16">
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 text-stone-500 hover:text-white transition-colors mb-8"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-4">
              GO <span className="text-amber-400">PREMIUM</span>
            </h1>
            <p className="text-stone-400 text-lg max-w-md mx-auto">
              Unlock ranked mode and compete for your place on the leaderboard
            </p>
          </div>

          {/* Pricing Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md mx-auto"
          >
            <div className="relative">
              {/* Glow effect */}
              <div className="absolute -inset-[2px] bg-gradient-to-b from-amber-500/40 via-amber-600/20 to-transparent rounded-2xl blur-sm" />

              <div className="relative bg-gradient-to-b from-stone-900 to-stone-950 border border-amber-800/40 rounded-2xl p-8">
                {/* Badge */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-amber-900/40 rounded-xl flex items-center justify-center">
                      <Crown className="w-6 h-6 text-amber-400" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-white">
                        Premium
                      </h2>
                      <p className="text-sm text-stone-500">Monthly</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-black text-white">
                      $5
                      <span className="text-sm font-normal text-stone-500">
                        /mo
                      </span>
                    </div>
                  </div>
                </div>

                {/* Features */}
                <div className="space-y-4 mb-8">
                  {features.map((feature, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="mt-0.5 text-amber-400">
                        <Check className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">
                          {feature.title}
                        </div>
                        <div className="text-xs text-stone-500">
                          {feature.description}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                {error && (
                  <div className="mb-4 p-3 bg-red-900/20 border border-red-800 rounded-lg text-sm text-red-400">
                    {error}
                  </div>
                )}

                {isPremium ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-emerald-900/20 border border-emerald-800 rounded-lg text-center">
                      <span className="text-emerald-400 font-bold text-sm">
                        You're a Premium member!
                      </span>
                    </div>
                    <button
                      onClick={handleManageSubscription}
                      disabled={isLoading}
                      className="w-full py-3 px-4 bg-stone-800 hover:bg-stone-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      ) : (
                        "Manage Subscription"
                      )}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleSubscribe}
                    disabled={isLoading}
                    className="w-full py-4 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-black text-lg rounded-lg transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)] disabled:opacity-50"
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    ) : isLoggedIn ? (
                      "Subscribe Now"
                    ) : (
                      "Sign In to Subscribe"
                    )}
                  </button>
                )}

                
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default PricingPage;
