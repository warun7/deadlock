import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import DuelStage from "../landing/duel/DuelStage";
import Wordmark from "../ui/Wordmark";

interface AuthLayoutProps {
  backTo: string;
  backLabel: string;
  children: React.ReactNode;
}

/** Split auth screen: brand panel with a live duel on large screens, form on the right. */
const AuthLayout: React.FC<AuthLayoutProps> = ({ backTo, backLabel, children }) => (
  <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <aside className="relative isolate hidden overflow-hidden border-r border-line lg:block" aria-hidden="true">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_50%_at_50%_45%,rgb(229_72_77/0.1),transparent)]" />
      <div className="flex h-full flex-col justify-between gap-8 p-10">
        <Wordmark className="text-lg text-fg" />
        <DuelStage interactive={false} className="mx-auto max-w-[520px]" />
        <p className="max-w-[18ch] text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-fg">
          Two coders. One problem.
        </p>
      </div>
    </aside>

    <div className="flex flex-col px-5 py-6 sm:px-10">
      <div className="flex items-center justify-between">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] py-1.5 pr-2 text-sm text-fg-2 transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-4" /> {backLabel}
        </Link>
        <Wordmark className="text-[15px] text-fg lg:hidden" />
      </div>
      <div className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-[380px]">{children}</div>
      </div>
    </div>
  </div>
);

export default AuthLayout;
