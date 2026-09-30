import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Chip, ChipLink } from "../ui/Chrome";
import ThemeChip from "../ui/ThemeChip";
import { Mark } from "../ui/Wordmark";
import { features } from "../../lib/features";
import { useTheme } from "../../lib/theme";
import { useShortcuts } from "../../lib/useShortcuts";

interface SiteNavProps {
  onAnchor: (id: string) => void;
}

const SECTIONS = [
  { id: "how-it-works", k: "H", label: "How it works" },
  ...(features.rankLadder ? [{ id: "ranks", k: "R", label: "Ranks" }] : []),
  { id: "faq", k: "Q", label: "FAQ" },
];

const SiteNav: React.FC<SiteNavProps> = ({ onAnchor }) => {
  const navigate = useNavigate();
  const { toggle } = useTheme();

  useShortcuts({
    ...Object.fromEntries(SECTIONS.map((s) => [s.k.toLowerCase(), () => onAnchor(s.id)])),
    t: toggle,
    l: () => navigate("/auth"),
    p: () => navigate("/auth?mode=signup"),
  });

  return (
    <header className="sticky top-0 z-40 bg-bg">
      <nav aria-label="Primary" className="flex h-[52px] items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-[3px]">
          <Link to="/" aria-label="Deadlock home" className="rounded-[3px]">
            <Chip className="px-2">
              <Mark className="size-3.5" />
              <span className="hidden min-[360px]:inline">Deadlock</span>
            </Chip>
          </Link>
          <div className="hidden items-center gap-[3px] md:flex">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  onAnchor(s.id);
                }}
                className="rounded-[3px]"
              >
                <Chip k={s.k}>{s.label}</Chip>
              </a>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-[3px]">
          <ThemeChip />
          <ChipLink to="/auth" k="L">
            Log in
          </ChipLink>
          <ChipLink to="/auth?mode=signup" k="P" tone="accent">
            Play
          </ChipLink>
        </div>
      </nav>
    </header>
  );
};

export default SiteNav;
