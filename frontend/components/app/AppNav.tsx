import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CaretDown, Check, Copy, SignOut, UserCircle } from "@phosphor-icons/react";
import Avatar from "../ui/Avatar";
import { Chip, ChipLink } from "../ui/Chrome";
import { Mark } from "../ui/Wordmark";
import ThemeChip from "../ui/ThemeChip";
import { useAuth } from "../../contexts/AuthContext";
import { useCurrentProfile, invalidateCurrentProfile } from "../../lib/useCurrentProfile";
import { useTheme } from "../../lib/theme";
import { useShortcuts } from "../../lib/useShortcuts";

const AccountMenu: React.FC = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { username, avatarUrl } = useCurrentProfile();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const profileUrl = `${window.location.origin}/u/${encodeURIComponent(username)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable: the public profile item still works */
    }
  };

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    invalidateCurrentProfile();
    navigate("/", { replace: true });
  };

  const item =
    "label flex w-full items-center gap-2.5 border-b border-line px-3 py-2.5 text-left text-fg transition-colors last:border-b-0 hover:bg-bg-2 focus-visible:bg-bg-2 focus-visible:outline-none";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${username}`}
        className="rounded-[3px]"
      >
        <Chip active={open} className="pl-1">
          <Avatar src={avatarUrl} name={username} size={20} className="rounded-[2px] bg-bg!" />
          <span className="hidden max-w-[10rem] truncate normal-case sm:block">{username}</span>
          <CaretDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} weight="bold" />
        </Chip>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Account"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 border border-fg bg-bg"
          >
            <div className="border-b border-rule px-3 pb-2.5 pt-3">
              <div className="truncate text-[15px] font-medium tracking-[-0.01em] text-fg">{username}</div>
              <div className="label mt-1 truncate normal-case text-fg-3">/u/{username}</div>
            </div>
            <Link role="menuitem" to={`/u/${encodeURIComponent(username)}`} className={item} onClick={() => setOpen(false)}>
              <UserCircle className="size-4" /> Public profile
              <ArrowRight className="ml-auto size-3.5" />
            </Link>
            <button role="menuitem" type="button" className={item} onClick={copyLink}>
              {copied ? <Check className="size-4 text-pass-ink" /> : <Copy className="size-4" />}
              {copied ? "Link copied" : "Copy profile link"}
            </button>
            <button role="menuitem" type="button" className={item} onClick={handleLogout}>
              <SignOut className="size-4" /> Log out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AppNav: React.FC = () => {
  const { isLoggedIn } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { toggle } = useTheme();

  useShortcuts(
    isLoggedIn
      ? { d: () => navigate("/dashboard"), u: () => navigate("/profile"), t: toggle }
      : { t: toggle, l: () => navigate("/auth"), p: () => navigate("/auth?mode=signup") }
  );

  return (
    <header className="sticky top-0 z-40 bg-bg">
      <nav aria-label="Primary" className="flex h-[52px] items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-[3px]">
          <Link to={isLoggedIn ? "/dashboard" : "/"} aria-label="Deadlock home" className="rounded-[3px]">
            <Chip className="px-2">
              <Mark className="size-3.5" />
              <span className="hidden sm:inline">Deadlock</span>
            </Chip>
          </Link>
          {isLoggedIn && (
            <>
              <ChipLink to="/dashboard" k="D" active={pathname === "/dashboard"} aria-current={pathname === "/dashboard" ? "page" : undefined}>
                Lobby
              </ChipLink>
              <ChipLink to="/profile" k="U" active={pathname === "/profile"} aria-current={pathname === "/profile" ? "page" : undefined}>
                Profile
              </ChipLink>
            </>
          )}
        </div>

        <div className="flex items-center gap-[3px]">
          <ThemeChip />
          {isLoggedIn ? (
            <AccountMenu />
          ) : (
            <>
              <ChipLink to="/auth" k="L">
                Log in
              </ChipLink>
              <ChipLink to="/auth?mode=signup" k="P" tone="accent">
                Play
              </ChipLink>
            </>
          )}
        </div>
      </nav>
    </header>
  );
};

export const AppShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <>
    <AppNav />
    <main id="main" className={`w-full px-4 pb-28 pt-8 md:pt-12 ${className}`}>
      {children}
    </main>
  </>
);

export default AppNav;
