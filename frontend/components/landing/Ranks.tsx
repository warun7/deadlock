import React, { useLayoutEffect, useRef } from "react";
import { RANK_TIERS } from "../../lib/features";
import { ensureGsap } from "../../lib/motion";
import { BigTitle, Label } from "../ui/Chrome";
import { useReveal } from "./useReveal";

/** Tier meter: one lit block per step up the ladder. */
const TierBlocks: React.FC<{ level: number; tone: string }> = ({ level, tone }) => (
  <span className="flex gap-[3px]" aria-hidden="true">
    {RANK_TIERS.map((_, i) => (
      <span
        key={i}
        data-block={i <= level ? "on" : "off"}
        className={`block size-3 sm:size-3.5 ${i <= level ? "" : "bg-fg/10"}`}
        style={i <= level ? { background: tone } : undefined}
      />
    ))}
  </span>
);

const Ranks: React.FC = () => {
  const ref = useReveal<HTMLElement>();
  const listRef = useRef<HTMLOListElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const { gsap } = ensureGsap();
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(list.querySelectorAll("[data-block='on']"), {
        scale: 0,
        duration: 0.4,
        ease: "back.out(3)",
        stagger: { each: 0.018, from: "start" },
        clearProps: "transform",
        scrollTrigger: { trigger: list, start: "top 75%", once: true },
      });
    });
    return () => mm.revert();
  }, []);

  return (
    <section id="ranks" ref={ref} aria-labelledby="ranks-title" className="scroll-mt-14 px-4 pt-32 md:pt-44">
      <BigTitle id="ranks-title" count={RANK_TIERS.length}>
        <span className="inline-block overflow-hidden pb-[0.08em] align-top">
          <span data-reveal-line className="inline-block">
            Ranks
          </span>
        </span>
      </BigTitle>

      <div className="mt-14 grid gap-12 md:mt-20 md:grid-cols-12 md:gap-6">
        <div data-reveal className="md:col-span-3">
          <Label>Info</Label>
          <p className="mt-4 max-w-[34ch] text-[17px] leading-snug tracking-[-0.01em] text-fg-2">
            Every duel moves your rating. Win to climb from {RANK_TIERS[0].name} to {RANK_TIERS[RANK_TIERS.length - 1].name}; lose
            and you slide back down.
          </p>
        </div>

        <div data-reveal className="md:col-span-9">
          <div className="label grid grid-cols-[64px_minmax(0,1fr)_auto] gap-4 pb-2 text-fg sm:grid-cols-[88px_minmax(0,1fr)_auto]">
            <span>/ Tier</span>
            <span>/ Name</span>
            <span>/ Ladder</span>
          </div>
          <ol ref={listRef} className="border-t border-rule">
            {RANK_TIERS.map((tier, i) => (
              <li
                key={tier.name}
                className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-2.5 sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:py-3"
              >
                <span className="label flex items-center gap-2 text-fg">
                  <span className="size-[7px] bg-fg" aria-hidden="true" />
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="truncate text-[clamp(1.375rem,2.4vw,2rem)] leading-none tracking-[-0.04em] text-fg">
                  {tier.name}
                </span>
                <TierBlocks level={i} tone={tier.tone} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
};

export default Ranks;
