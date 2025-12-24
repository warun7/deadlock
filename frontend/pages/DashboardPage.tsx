import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import DashboardHero from "../components/DashboardHero";
import FeatureGrid from "../components/FeatureGrid";
import Footer from "../components/Footer";
import { useAuth } from "../contexts/AuthContext";
import { gameSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [checkingMatch, setCheckingMatch] = useState(true);

  const handleProfileClick = () => {
    navigate("/profile");
  };

  const handleDashboardClick = () => {
    navigate("/dashboard");
  };

  const handleLogout = async () => {
    console.log("Logging out...");
    await logout();
    console.log("Logged out, redirecting to home...");
    navigate("/", { replace: true });
  };

  const handleStartMatchmaking = () => {
    navigate("/matchmaking");
  };

  const handleResumeMatch = () => {
    if (activeMatchId) {
      navigate(`/game/${activeMatchId}`);
    }
  };

  // Check for active match on mount
  useEffect(() => {
    if (!user) {
      console.log("❌ No user, skipping active match check");
      setCheckingMatch(false);
      return;
    }

    console.log("🔍 Dashboard mounted, checking for active match...");

    const checkActiveMatch = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setCheckingMatch(false);
          return;
        }

        // Connect socket to check for active match
        let socket = gameSocket.getSocket();
        if (!socket?.connected) {
          socket = gameSocket.connect(session.access_token);
        }

        // Listen for active match notification from backend
        const handleActiveMatch = (data: { matchId: string }) => {
          console.log("✅ Active match detected:", data.matchId);
          setActiveMatchId(data.matchId);
          setCheckingMatch(false);

          // Clean up listeners
          socket?.off("active_match_found", handleActiveMatch);
          socket?.off("connect", requestCheck);
        };

        // Set up listener FIRST
        socket?.on("active_match_found", handleActiveMatch);

        // Function to request check
        const requestCheck = () => {
          console.log("📡 Socket connected, requesting active match check...");
          socket?.emit("check_active_match");
        };

        // Request check when ready
        if (socket?.connected) {
          console.log("✅ Socket already connected");
          requestCheck();
        } else {
          console.log("⏳ Waiting for socket to connect...");
          socket?.once("connect", requestCheck);
        }

        // Timeout if no response (increased to 5s)
        const timeout = setTimeout(() => {
          console.log("⏱️ Active match check timed out (no active match)");
          setCheckingMatch(false);
          socket?.off("active_match_found", handleActiveMatch);
          socket?.off("connect", requestCheck);
        }, 5000);
      } catch (error) {
        console.error("Error checking active match:", error);
        setCheckingMatch(false);
      }
    };

    checkActiveMatch();
  }, [user]);

  return (
    <>
      <Navbar
        isLoggedIn={true}
        onLogin={() => {}}
        onProfile={handleProfileClick}
        onDashboard={handleDashboardClick}
        onLogout={handleLogout}
      />
      <main>
        <DashboardHero
          onFindMatch={handleStartMatchmaking}
          activeMatchId={activeMatchId}
          onResumeMatch={handleResumeMatch}
          checkingMatch={checkingMatch}
        />
        <FeatureGrid />
      </main>
      <Footer />
    </>
  );
};

export default DashboardPage;
