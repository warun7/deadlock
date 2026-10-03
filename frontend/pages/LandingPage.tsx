import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import SiteNav from "../components/landing/SiteNav";
import Hero from "../components/landing/Hero";
import HowItWorks from "../components/landing/HowItWorks";
import Ranks from "../components/landing/Ranks";
import Faq from "../components/landing/Faq";
import FinalCta from "../components/landing/FinalCta";
import SiteFooter from "../components/landing/SiteFooter";
import { useAuth } from "../contexts/AuthContext";
import { useLenis } from "../lib/useLenis";
import { features } from "../lib/features";
import { returnToPath } from "../lib/returnTo";
import { track } from "../lib/analytics";

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const { scrollTo } = useLenis();

  // Logged-in players go straight to the lobby, or back to the invite they
  // signed up from (a confirmation link can land here if Supabase's redirect
  // list does not include /auth)
  useEffect(() => {
    if (isLoggedIn) navigate(returnToPath() ?? "/dashboard", { replace: true });
  }, [isLoggedIn, navigate]);

  useEffect(() => {
    track("landing_view");
  }, []);

  return (
    <>
      <a
        href="#main"
        className="label fixed left-3 top-3 z-[60] -translate-y-20 rounded-[3px] bg-fg px-3 py-2 text-bg focus:translate-y-0"
      >
        Skip to content
      </a>
      <SiteNav onAnchor={scrollTo} />
      <main id="main">
        <Hero onAnchor={scrollTo} />
        <HowItWorks />
        {features.rankLadder && <Ranks />}
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter onAnchor={scrollTo} />
    </>
  );
};

export default LandingPage;
