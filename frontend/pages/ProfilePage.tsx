import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Camera, Check, Copy, PencilSimple } from "@phosphor-icons/react";
import { AppShell } from "../components/app/AppNav";
import StatGrid from "../components/app/StatGrid";
import HistorySection from "../components/app/HistorySection";
import Avatar from "../components/ui/Avatar";
import Field from "../components/ui/Field";
import { Button } from "../components/ui/Button";
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
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-center"
      >
        <div className="relative w-fit">
          <Avatar src={shownAvatar} name={username} size={88} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="Change photo"
            className="absolute -bottom-1.5 -right-1.5 flex size-8 items-center justify-center rounded-[10px] bg-surface-3 text-fg-2 shadow-[inset_0_0_0_1px_var(--color-line-strong),0_4px_12px_rgb(0_0_0/0.4)] transition-colors hover:text-fg disabled:opacity-60"
          >
            <Camera className="size-4" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={handleUsernameSave} className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end">
              <Field
                label="Username"
                autoFocus
                value={newUsername}
                placeholder={username}
                onChange={(e) => setNewUsername(e.target.value)}
                error={usernameError}
                hint={checking ? "Checking availability" : newUsername && !usernameError ? "Available" : "Letters, numbers and underscores."}
                className="flex-1"
                maxLength={20}
              />
              <div className="flex gap-2 sm:mb-[26px]">
                <Button type="submit" loading={saving} disabled={!newUsername.trim() || !!usernameError || checking}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="secondary"
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
            <>
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold tracking-[-0.035em] text-fg">{username}</h1>
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label="Edit username">
                  <PencilSimple className="size-4" />
                </Button>
              </div>
              <p className="mt-1 text-sm text-fg-3">
                {user?.email}
                {profile?.created_at && <> &middot; Joined {formatDate(profile.created_at)}</>}
              </p>
            </>
          )}
          {(notice || imageError) && (
            <p role="status" className={`mt-3 text-[13px] ${imageError ? "text-accent-text" : "text-pass"}`}>
              {imageError || notice}
            </p>
          )}
        </div>

        {!editing && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={copyLink}>
              {copied ? <Check className="size-4 text-pass" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Link
              to={`/u/${encodeURIComponent(username)}`}
              className="inline-flex h-8 items-center rounded-[var(--radius-control)] px-3 text-[13px] text-fg-2 transition-colors hover:bg-white/[0.05] hover:text-fg"
            >
              Public view
            </Link>
          </div>
        )}
      </motion.header>

      <StatGrid profile={profile} loading={loading} className="mt-8 md:grid-cols-4" />

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
