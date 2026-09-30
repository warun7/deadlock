import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import DuelStage from "../landing/duel/DuelStage";
import { Chip, CrossRow, Figure, Label } from "../ui/Chrome";
import { Mark } from "../ui/Wordmark";
import PixelText from "../ui/pixel/PixelText";
import ThemeChip from "../ui/ThemeChip";
import { useTheme } from "../../lib/theme";
import { useShortcuts } from "../../lib/useShortcuts";

interface AuthLayoutProps {
  backTo: string;
  backLabel: string;
  children: React.ReactNode;
}

/** Split auth screen: the sample match on large screens, form on the right. */
const AuthLayout: React.FC<AuthLayoutProps> = ({ backTo, backLabel, children }) => {
  const { toggle } = useTheme();
  useShortcuts({ t: toggle });
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-12">
      <aside
        className="relative hidden flex-col border-r border-rule px-4 pb-6 pt-4 lg:col-span-7 lg:flex"
        aria-hidden="true"
      >
        <Link to="/" tabIndex={-1} className="w-fit rounded-[3px]">
          <Chip className="px-2">
            <Mark /> Deadlock
          </Chip>
        </Link>
        <CrossRow className="mt-10" at={[0, 50, 100]} />
        <p className="mt-8 text-[clamp(3rem,6vw,6.5rem)] font-medium leading-[0.9] tracking-[-0.065em] text-fg">
          Same problem.
          <br />
          Solve it <PixelText text="FIRST" decorative className="h-[0.7em]" />
          <span className="text-accent">.</span>
        </p>
        <div className="mt-auto pt-12">
          <Label aside="Scripted">Fig. 1 Sample match</Label>
          <Figure n={1} className="mt-4" bodyClassName="px-4 py-5">
            <DuelStage compact />
          </Figure>
        </div>
      </aside>

      <div className="flex flex-col px-4 py-4 lg:col-span-5 lg:px-10">
        <div className="flex items-center justify-between gap-2">
          <Link to={backTo} className="rounded-[3px]">
            <Chip>
              <ArrowLeft className="size-3.5" weight="bold" /> {backLabel}
            </Chip>
          </Link>
          <div className="flex items-center gap-[3px]">
            <Link to="/" className="rounded-[3px] lg:hidden" aria-label="Deadlock home">
              <Chip className="px-2">
                <Mark /> Deadlock
              </Chip>
            </Link>
            <ThemeChip />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
