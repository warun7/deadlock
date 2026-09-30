import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "@phosphor-icons/react";
import { Label } from "../ui/Chrome";
import PixelText from "../ui/pixel/PixelText";
import { features } from "../../lib/features";

interface SiteFooterProps {
  onAnchor?: (id: string) => void;
}

const linkRow =
  "label group flex items-center justify-between gap-3 border-b border-line py-2.5 text-fg transition-colors hover:text-accent-ink";

const Bullet = () => <span className="size-[7px] shrink-0 bg-current" aria-hidden="true" />;

const SiteFooter: React.FC<SiteFooterProps> = ({ onAnchor }) => {
  const anchors = [
    { id: "how-it-works", label: "How it works" },
    ...(features.rankLadder ? [{ id: "ranks", label: "Ranks" }] : []),
    { id: "faq", label: "Questions" },
  ];

  return (
    <footer className="px-4 pb-5">
      <div className="grid gap-10 md:grid-cols-12 md:gap-6">
        <nav aria-label="Play" className="md:col-span-4">
          <Label>Play</Label>
          <ul className="mt-2">
            <li>
              <Link to="/auth?mode=signup" className={linkRow}>
                <span className="flex items-center gap-2.5">
                  <Bullet /> Create an account
                </span>
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
            <li>
              <Link to="/auth" className={linkRow}>
                <span className="flex items-center gap-2.5">
                  <Bullet /> Log in
                </span>
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="On this page" className="md:col-span-4 md:col-start-9">
          <Label>On this page</Label>
          <ul className="mt-2">
            {anchors.map((a) => (
              <li key={a.id}>
                <a
                  href={`#${a.id}`}
                  onClick={(e) => {
                    if (!onAnchor) return;
                    e.preventDefault();
                    onAnchor(a.id);
                  }}
                  className={linkRow}
                >
                  <span className="flex items-center gap-2.5">
                    <Bullet /> {a.label}
                  </span>
                  <ArrowRight className="size-3.5 -rotate-90 transition-transform group-hover:-translate-y-0.5" />
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="mt-24 md:mt-36">
        <PixelText text="DEADLOCK" intro="view" ripple gap={0.08} className="block w-full text-fg" label="Deadlock" />
      </div>

      <div className="label mt-4 flex flex-wrap items-center justify-between gap-3 text-fg-3">
        <span>&copy; {new Date().getFullYear()} Deadlock</span>
        <span>Two coders. One problem.</span>
      </div>
    </footer>
  );
};

export default SiteFooter;
