import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { AppShell } from "../components/app/AppNav";
import StatGrid from "../components/app/StatGrid";
import HistorySection from "../components/app/HistorySection";
import Avatar from "../components/ui/Avatar";
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
      <AppShell className="flex min-h-[70dvh] items-center justify-center">
        <div className="max-w-sm text-center">
          <MagnifyingGlass className="mx-auto size-9 text-fg-3" weight="duotone" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-fg">No player called {targetUsername}</h1>
          <p className="mt-2 text-[15px] text-fg-2">Check the spelling, or ask them to send you their profile link.</p>
          <ButtonLink to={isLoggedIn ? "/dashboard" : "/"} variant="secondary" className="mt-8">
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
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-center"
      >
        <Avatar src={profile?.avatar_url} name={name} size={88} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold tracking-[-0.035em] text-fg">{name}</h1>
          <p className="mt-1 h-5 text-sm text-fg-3">
            {loading ? (
              <span className="inline-block h-3.5 w-32 animate-pulse rounded bg-surface-3 align-middle" />
            ) : (
              profile?.created_at && `Joined ${formatDate(profile.created_at)}`
            )}
          </p>
        </div>
        {!isLoggedIn && (
          <ButtonLink to="/auth?mode=signup" size="md">
            Play now
          </ButtonLink>
        )}
      </motion.header>

      <StatGrid profile={profile} loading={loading} className="mt-8 md:grid-cols-4" />

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
