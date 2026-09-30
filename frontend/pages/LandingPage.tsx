import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import SiteNav from "../components/landing/SiteNav";
import Hero from "../components/landing/Hero";
import MatchFlow from "../components/landing/MatchFlow";
import RankLadder from "../components/landing/RankLadder";
import FinalCta from "../components/landing/FinalCta";
import SiteFooter from "../components/landing/SiteFooter";
import { useAuth } from "../contexts/AuthContext";
import { useLenis } from "../lib/useLenis";
import { features } from "../lib/features";

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const { scrollTo } = useLenis();

  // Logged-in players go straight to the lobby
  useEffect(() => {
    if (isLoggedIn) navigate("/dashboard", { replace: true });
  }, [isLoggedIn, navigate]);

  return (
    <>
      <a
        href="#main"
        className="fixed left-3 top-3 z-[60] -translate-y-20 rounded-[var(--radius-control)] bg-fg px-3 py-2 text-sm font-medium text-ink focus:translate-y-0"
      >
        Skip to content
      </a>
      <SiteNav onAnchor={scrollTo} />
      <main id="main">
        <Hero onAnchor={scrollTo} />
        <MatchFlow />
        {features.rankLadder && <RankLadder />}
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
};

export default LandingPage;
