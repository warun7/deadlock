import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getCurrentUserProfile } from "./api";
import type { Profile } from "../types/database";

// Shared across components so the nav and page don't each refetch, and so an
// edit on the profile page updates every mounted consumer at once.
let cached: { userId: string; profile: Profile | null } | null = null;
let inflight: Promise<Profile | null> | null = null;
const listeners = new Set<(p: Profile | null) => void>();

export function invalidateCurrentProfile() {
  cached = null;
  inflight = null;
}

export function useCurrentProfile() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [profile, setProfile] = useState<Profile | null>(
    cached && cached.userId === userId ? cached.profile : null
  );
  const [loading, setLoading] = useState(!(cached && cached.userId === userId));

  useEffect(() => {
    listeners.add(setProfile);
    return () => {
      listeners.delete(setProfile);
    };
  }, []);

  const load = useCallback(
    async (force = false) => {
      if (!userId) {
        setProfile(null);
        setLoading(false);
        return;
      }
      if (!force && cached && cached.userId === userId) {
        setProfile(cached.profile);
        setLoading(false);
        return;
      }
      setLoading(true);
      if (force || !inflight) inflight = getCurrentUserProfile();
      try {
        const data = await inflight;
        cached = { userId, profile: data };
        listeners.forEach((fn) => fn(data));
      } catch (err) {
        console.error("Failed to load profile", err);
      } finally {
        inflight = null;
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const username =
    profile?.username ||
    user?.user_metadata?.username ||
    user?.user_metadata?.display_name ||
    user?.email?.split("@")[0] ||
    "Player";

  const avatarUrl: string | null =
    profile?.avatar_url || user?.user_metadata?.profile_image || null;

  return { profile, loading, username, avatarUrl, refresh: () => load(true) };
}
