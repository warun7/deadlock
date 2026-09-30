import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CaretDown, Check, Copy, SignOut, UserCircle } from "@phosphor-icons/react";
import Wordmark from "../ui/Wordmark";
import Avatar from "../ui/Avatar";
import { ButtonLink } from "../ui/Button";
import { useAuth } from "../../contexts/AuthContext";
import { useCurrentProfile, invalidateCurrentProfile } from "../../lib/useCurrentProfile";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `relative rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors ${
    isActive ? "text-fg" : "text-fg-2 hover:bg-white/[0.05] hover:text-fg"
  }`;

const ActiveBar: React.FC<{ show: boolean }> = ({ show }) =>
  show ? (
    <motion.span
      layoutId="nav-active"
      className="absolute inset-x-3 -bottom-[9px] h-[2px] rounded-full bg-accent"
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
    />
  ) : null;

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
    "flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-sm text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:bg-white/[0.06] focus-visible:text-fg focus-visible:outline-none";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-[var(--radius-control)] py-1 pl-1 pr-2 transition-colors hover:bg-white/[0.05]"
      >
        <Avatar src={avatarUrl} name={username} size={30} />
        <span className="hidden max-w-[10rem] truncate text-sm text-fg sm:block">{username}</span>
        <CaretDown className={`size-3.5 text-fg-3 transition-transform ${open ? "rotate-180" : ""}`} weight="bold" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Account"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="glass absolute right-0 top-[calc(100%+10px)] z-50 w-60 origin-top-right rounded-[14px] p-1.5"
          >
            <div className="px-2.5 pb-2 pt-1.5">
              <div className="truncate text-sm font-medium text-fg">{username}</div>
              <div className="truncate text-[12px] text-fg-3">/u/{username}</div>
            </div>
            <div className="my-1 h-px bg-line" />
            <Link role="menuitem" to={`/u/${encodeURIComponent(username)}`} className={item} onClick={() => setOpen(false)}>
              <UserCircle className="size-4" /> Public profile
            </Link>
            <button role="menuitem" type="button" className={item} onClick={copyLink}>
              {copied ? <Check className="size-4 text-pass" /> : <Copy className="size-4" />}
              {copied ? "Link copied" : "Copy profile link"}
            </button>
            <div className="my-1 h-px bg-line" />
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

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <nav
        aria-label="Primary"
        className="glass mx-auto mt-3 flex h-14 w-[calc(100%-1.5rem)] max-w-[1200px] items-center justify-between rounded-[var(--radius-panel)] pl-4 pr-2 sm:pl-5"
      >
        <div className="flex items-center gap-2 sm:gap-6">
          <Link to={isLoggedIn ? "/dashboard" : "/"} className="text-[17px] text-fg" aria-label="Deadlock home">
            <Wordmark />
          </Link>
          {isLoggedIn && (
            <div className="flex items-center">
              <NavLink to="/dashboard" className={linkClass}>
                {({ isActive }) => (
                  <>
                    Play
                    <ActiveBar show={isActive} />
                  </>
                )}
              </NavLink>
              <NavLink to="/profile" className={linkClass}>
                {({ isActive }) => (
                  <>
                    Profile
                    <ActiveBar show={isActive} />
                  </>
                )}
              </NavLink>
            </div>
          )}
        </div>

        {isLoggedIn ? (
          <AccountMenu />
        ) : (
          <div className="flex items-center gap-1.5">
            <ButtonLink to="/auth" variant="ghost" size="sm">
              Log in
            </ButtonLink>
            <ButtonLink to="/auth?mode=signup" size="sm">
              Play now
            </ButtonLink>
          </div>
        )}
      </nav>
    </header>
  );
};

export const AppShell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <>
    <AppNav />
    <main id="main" className={`mx-auto w-full max-w-[1200px] px-5 pb-24 pt-28 sm:px-8 ${className}`}>
      {children}
    </main>
  </>
);

export default AppNav;
