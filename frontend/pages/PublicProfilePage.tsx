import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AppShell } from "../components/app/AppNav";
import StatGrid from "../components/app/StatGrid";
import RankPanel from "../components/app/RankPanel";
import HistorySection from "../components/app/HistorySection";
import Avatar from "../components/ui/Avatar";
import NameTitle from "../components/app/NameTitle";
import { ArrowRight } from "@phosphor-icons/react";
import { ButtonLink } from "../components/ui/Button";
import { useAuth } from "../contexts/AuthContext";
import { getAllMatchesByUserId, getRecentMatchesByUserId, getUserProfileByUsername } from "../lib/api";
import { formatDate } from "../lib/format";
import type { Profile } from "../types/database";

const PublicProfilePage: React.FC = () => {
  const { targetUsername } = useParams<{ targetUsername: string }>();
  const { isLoggedIn } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!targetUsername) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    getUserProfileByUsername(targetUsername).then((data) => {
      if (cancelled) return;
      if (!data) setNotFound(true);
      setProfile(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [targetUsername]);

  if (notFound) {
    return (
      <AppShell>
        <p className="label text-fg-3">Player not found</p>
        <h1 className="mt-3 max-w-[14ch] text-[clamp(2.5rem,7vw,6.5rem)] font-medium leading-[0.9] tracking-[-0.06em] text-fg">
          No player called <span className="break-all">{targetUsername}</span>
        </h1>
        <div className="mt-10 max-w-md border-t border-rule pt-5">
          <p className="text-[17px] leading-snug text-fg-2">Check the spelling, or ask them to send you their profile link.</p>
          <ButtonLink to={isLoggedIn ? "/dashboard" : "/"} variant="outline" className="mt-6">
            {isLoggedIn ? "Back to lobby" : "Go home"}
          </ButtonLink>
        </div>
      </AppShell>
    );
  }

  const name = profile?.username || targetUsername || "";

  return (
    <AppShell>
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="label text-fg-3">Player</p>
        <NameTitle name={name} count={profile?.total_matches ?? undefined} className="mt-3" />
        <div className="mt-10 grid gap-8 border-t border-rule pt-5 md:grid-cols-12 md:gap-6">
          <div className="flex items-center gap-4 md:col-span-7">
            <Avatar src={profile?.avatar_url} name={name} size={72} />
            <p className="label text-fg-2">
              {loading ? (
                <span className="inline-block h-3.5 w-32 animate-pulse bg-bg-2 align-middle" />
              ) : (
                profile?.created_at && `Joined ${formatDate(profile.created_at)}`
              )}
            </p>
          </div>
          {!isLoggedIn && (
            <div className="md:col-span-4 md:col-start-9">
              <ButtonLink to="/auth?mode=signup" variant="accent" size="lg" className="w-full justify-between">
                Play Deadlock <ArrowRight weight="bold" className="size-4" />
              </ButtonLink>
            </div>
          )}
        </div>
      </motion.header>

      <RankPanel rating={profile?.rating} loading={loading} className="mt-14 max-w-xl" />
      <StatGrid profile={profile} loading={loading} wide className="mt-12" />

      {profile && (
        <HistorySection
          subjectKey={profile.id}
          loadRecent={() => getRecentMatchesByUserId(profile.id, 5)}
          loadAll={() => getAllMatchesByUserId(profile.id)}
          emptyTitle="No matches yet"
          emptyBody={`${name} has not played a match.`}
        />
      )}
    </AppShell>
  );
};

export default PublicProfilePage;
