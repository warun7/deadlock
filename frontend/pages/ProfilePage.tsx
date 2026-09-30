import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, Check, Copy, PencilSimple } from "@phosphor-icons/react";
import { AppShell } from "../components/app/AppNav";
import StatGrid from "../components/app/StatGrid";
import RankPanel from "../components/app/RankPanel";
import HistorySection from "../components/app/HistorySection";
import Avatar from "../components/ui/Avatar";
import Field from "../components/ui/Field";
import { Button, ButtonLink } from "../components/ui/Button";
import NameTitle from "../components/app/NameTitle";
import { Swap } from "../components/ui/micro";
import DotLoader from "../components/ui/pixel/DotLoader";
import { useAuth } from "../contexts/AuthContext";
import { useCurrentProfile } from "../lib/useCurrentProfile";
import { supabase } from "../lib/supabase";
import { getAllMatches, getRecentMatches } from "../lib/api";
import { formatDate } from "../lib/format";

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const { profile, loading, username, avatarUrl, refresh } = useCurrentProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [localImage, setLocalImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Validate and check availability as the user types (debounced)
  useEffect(() => {
    const trimmed = newUsername.trim();
    if (!trimmed || trimmed.length < 3) {
      setUsernameError(trimmed ? "At least 3 characters." : null);
      return;
    }
    if (!USERNAME_RE.test(trimmed)) {
      setUsernameError("Only letters, numbers and underscores.");
      return;
    }
    if (trimmed.length > 20) {
      setUsernameError("20 characters at most.");
      return;
    }
    if (trimmed === username) {
      setUsernameError(null);
      return;
    }
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const { data } = await supabase.from("profiles").select("username").eq("username", trimmed).single();
        setUsernameError(data ? "That username is taken." : null);
      } catch (error: any) {
        if (error?.code === "PGRST116") setUsernameError(null);
      } finally {
        setChecking(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [newUsername, username]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImageError(null);
    if (file.size > 2 * 1024 * 1024) {
      setImageError("Images must be under 2 MB.");
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      try {
        const { error } = await supabase.auth.updateUser({ data: { profile_image: base64 } });
        if (error) throw error;
        setLocalImage(base64);
      } catch (err) {
        console.error("Error uploading image:", err);
        setImageError("Could not update your photo. Please try again.");
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setUploading(false);
      setImageError("Could not read that file.");
    };
    reader.readAsDataURL(file);
  };

  const handleUsernameSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUsername.trim();
    if (!trimmed || usernameError || checking) return;
    if (trimmed === username) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const { data: existing } = await supabase.from("profiles").select("username").eq("username", trimmed).single();
      if (existing && existing.username !== username) {
        setUsernameError("That username is taken.");
        return;
      }
      const { error: profileError } = await supabase.from("profiles").update({ username: trimmed }).eq("id", user?.id);
      if (profileError) throw profileError;
      await supabase.auth.updateUser({ data: { username: trimmed, display_name: trimmed } });
      await refresh();
      setEditing(false);
      setNewUsername("");
      setNotice(`Username changed to ${trimmed}.`);
      setTimeout(() => setNotice(null), 3000);
    } catch (error: any) {
      console.error("Error updating username:", error);
      setUsernameError(error?.code === "23505" ? "That username is taken." : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/u/${encodeURIComponent(username)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const shownAvatar = localImage || avatarUrl;

  return (
    <AppShell>
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="label text-fg-3">Profile</p>
        {editing ? (
          <form onSubmit={handleUsernameSave} className="mt-4 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
            <Field
              label="Username"
              autoFocus
              value={newUsername}
              placeholder={username}
              onChange={(e) => setNewUsername(e.target.value)}
              error={usernameError}
              hint={
                checking ? (
                  <>
                    <DotLoader pattern="orbit" /> Checking availability
                  </>
                ) : newUsername && !usernameError ? (
                  <span className="text-pass-ink">Available</span>
                ) : (
                  "Letters, numbers and underscores."
                )
              }
              className="flex-1"
              maxLength={20}
            />
            <div className="flex gap-2 sm:mb-[26px]">
              <Button type="submit" loading={saving} disabled={!newUsername.trim() || !!usernameError || checking}>
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setNewUsername("");
                  setUsernameError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <NameTitle name={username} count={profile?.total_matches ?? undefined} className="mt-3" />
        )}

        <div className="mt-10 grid gap-8 border-t border-rule pt-5 md:grid-cols-12 md:gap-6">
          <div className="flex items-center gap-4 md:col-span-7">
            <div className="relative shrink-0">
              <Avatar src={shownAvatar} name={username} size={72} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                aria-label="Change photo"
                className="absolute -bottom-2 -right-2 flex size-7 items-center justify-center rounded-[3px] bg-fg text-bg transition-colors hover:bg-accent hover:text-on-accent disabled:opacity-60"
              >
                <Camera className="size-3.5" weight="bold" />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            </div>
            <div className="label min-w-0 space-y-1.5 text-fg-2">
              <p className="truncate normal-case">{user?.email}</p>
              {profile?.created_at && <p>Joined {formatDate(profile.created_at)}</p>}
              {(notice || imageError) && (
                <p role="status" className={imageError ? "text-accent-ink" : "text-pass-ink"}>
                  {imageError || notice}
                </p>
              )}
            </div>
          </div>

          {!editing && (
            <div className="flex flex-wrap items-center gap-2 md:col-span-5 md:justify-end">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <PencilSimple className="size-3.5" /> Rename
              </Button>
              <Button variant="outline" size="sm" onClick={copyLink}>
                <Swap on={copied} off={<Copy className="size-3.5" />} onNode={<Check weight="bold" className="size-3.5" />} />
                <Swap on={copied} off="Copy link" onNode="Copied" />
              </Button>
              <ButtonLink to={`/u/${encodeURIComponent(username)}`} variant="ghost" size="sm">
                Public view
              </ButtonLink>
            </div>
          )}
        </div>
      </motion.header>

      <RankPanel rating={profile?.rating} loading={loading} className="mt-14 max-w-xl" />
      <StatGrid profile={profile} loading={loading} wide className="mt-12" />

      <HistorySection
        subjectKey={user?.id ?? "me"}
        loadRecent={() => getRecentMatches(5)}
        loadAll={getAllMatches}
        emptyTitle="No matches yet"
        emptyBody="Play your first duel and it will show up here."
      />
    </AppShell>
  );
};

export default ProfilePage;
