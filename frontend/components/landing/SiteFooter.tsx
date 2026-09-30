import React from "react";
import { Link } from "react-router-dom";
import Wordmark from "../ui/Wordmark";

const SiteFooter: React.FC = () => (
  <footer className="relative overflow-hidden border-t border-line">
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 py-10 text-sm text-fg-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <span>&copy; {new Date().getFullYear()} Deadlock</span>
      <nav aria-label="Footer" className="flex gap-5">
        <Link to="/auth" className="transition-colors hover:text-fg">
          Log in
        </Link>
      </nav>
    </div>
    <div aria-hidden="true" className="pointer-events-none select-none px-5 pb-2 sm:px-8">
      <Wordmark className="block text-center text-[18.5vw] leading-[0.78] text-white/[0.035] [&>span]:text-accent/[0.08]" />
    </div>
  </footer>
);

export default SiteFooter;
