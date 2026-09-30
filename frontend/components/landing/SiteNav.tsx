import React from "react";
import { Link } from "react-router-dom";
import Wordmark from "../ui/Wordmark";
import { ButtonLink } from "../ui/Button";
import { features } from "../../lib/features";

interface SiteNavProps {
  onAnchor: (id: string) => void;
}

const SiteNav: React.FC<SiteNavProps> = ({ onAnchor }) => {
  const anchor = (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onAnchor(id);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <nav
        aria-label="Primary"
        className="glass mx-auto mt-3 flex h-14 w-[calc(100%-1.5rem)] max-w-[1200px] items-center justify-between rounded-[var(--radius-panel)] pl-4 pr-2 sm:pl-5"
      >
        <Link to="/" className="text-[17px] text-fg" aria-label="Deadlock home">
          <Wordmark />
        </Link>

        <div className="hidden items-center gap-1 text-sm text-fg-2 md:flex">
          <a
            href="#how-it-works"
            onClick={anchor("how-it-works")}
            className="rounded-[var(--radius-control)] px-3 py-2 transition-colors hover:bg-white/[0.05] hover:text-fg"
          >
            How it works
          </a>
          {features.rankLadder && (
            <a
              href="#ranks"
              onClick={anchor("ranks")}
              className="rounded-[var(--radius-control)] px-3 py-2 transition-colors hover:bg-white/[0.05] hover:text-fg"
            >
              Ranks
            </a>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <ButtonLink to="/auth" variant="ghost" size="sm">
            Log in
          </ButtonLink>
          <ButtonLink to="/auth?mode=signup" size="sm">
            Play now
          </ButtonLink>
        </div>
      </nav>
    </header>
  );
};

export default SiteNav;
