import React, { useLayoutEffect, useRef } from "react";
import { RANK_TIERS } from "../../lib/features";
import { ensureGsap } from "../../lib/motion";

/** Hexagonal tier emblem: CSS clip-path and gradients only. */
export const TierEmblem: React.FC<{ tone: string; size?: number; className?: string }> = ({
  tone,
  size = 40,
  className = "",
}) => (
  <span
    aria-hidden="true"
    className={`relative inline-block shrink-0 ${className}`}
    style={{ width: size, height: size * 1.1 }}
  >
    <span
      className="absolute inset-0 [clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]"
      style={{
        background: `linear-gradient(155deg, color-mix(in oklab, ${tone} 55%, white) 0%, ${tone} 45%, color-mix(in oklab, ${tone} 55%, black) 100%)`,
      }}
    />
    <span
      className="absolute inset-[18%] [clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]"
      style={{
        background: `linear-gradient(335deg, color-mix(in oklab, ${tone} 70%, white) 0%, color-mix(in oklab, ${tone} 60%, black) 100%)`,
      }}
    />
  </span>
);

const RankLadder: React.FC = () => {
  const sectionRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const { gsap } = ensureGsap();
    const section = sectionRef.current;
    if (!section) return;

    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(section.querySelectorAll("[data-step]"), {
        scaleY: 0,
        transformOrigin: "50% 100%",
        duration: 1.2,
        ease: "expo.out",
        stagger: 0.07,
        clearProps: "transform",
        scrollTrigger: { trigger: section, start: "top 70%", once: true },
      });
      gsap.from(section.querySelectorAll("[data-step-x]"), {
        scaleX: 0,
        transformOrigin: "0% 50%",
        duration: 1.1,
        ease: "expo.out",
        stagger: 0.06,
        clearProps: "transform",
        scrollTrigger: { trigger: section, start: "top 70%", once: true },
      });
      gsap.from(section.querySelectorAll("[data-step-label]"), {
        opacity: 0,
        y: 10,
        duration: 0.8,
        ease: "expo.out",
        stagger: 0.07,
        delay: 0.3,
        clearProps: "opacity,transform",
        scrollTrigger: { trigger: section, start: "top 70%", once: true },
      });
      gsap.from(section.querySelectorAll("[data-ladder-copy]"), {
        opacity: 0,
        y: 24,
        duration: 1,
        ease: "expo.out",
        stagger: 0.08,
        clearProps: "opacity,transform",
        scrollTrigger: { trigger: section, start: "top 78%", once: true },
      });
    });
    return () => mm.revert();
  }, []);

  const count = RANK_TIERS.length;

  return (
    <section
      id="ranks"
      ref={sectionRef}
      aria-labelledby="ranks-title"
      className="relative py-28 md:py-40"
    >
      <div className="mx-auto w-full max-w-[1200px] px-5 sm:px-8">
        <div className="max-w-[36rem]">
          <h2
            id="ranks-title"
            data-ladder-copy
            className="text-[clamp(2rem,4.2vw,3.25rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-fg"
          >
            Climb the ladder
          </h2>
          <p data-ladder-copy className="mt-5 max-w-[46ch] text-base leading-relaxed text-fg-2 md:text-lg">
            Ranked wins raise your rating and move you up through seven tiers, from Iron to Deadlock.
          </p>
        </div>

        {/* Desktop: ascending staircase */}
        <ol className="mt-16 hidden h-[340px] grid-cols-7 items-end gap-3 md:grid" aria-label="Rank tiers, lowest to highest">
          {RANK_TIERS.map((tier, i) => {
            const top = i === count - 1;
            return (
              <li key={tier.name} className="flex h-full flex-col justify-end">
                <div data-step-label className="mb-4 flex flex-col items-center gap-2.5">
                  <TierEmblem tone={tier.tone} size={top ? 46 : 36} />
                  <span className={`text-sm ${top ? "font-medium text-fg" : "text-fg-2"}`}>{tier.name}</span>
                </div>
                <div
                  data-step
                  className="rounded-t-[10px]"
                  style={{
                    height: `${16 + (i / (count - 1)) * 68}%`,
                    background: `linear-gradient(180deg, color-mix(in oklab, ${tier.tone} ${top ? 38 : 16}%, transparent) 0%, transparent 100%)`,
                    boxShadow: `inset 0 1px 0 color-mix(in oklab, ${tier.tone} 60%, transparent)`,
                  }}
                />
              </li>
            );
          })}
        </ol>

        {/* Mobile: stacked, highest first */}
        <ol className="mt-12 space-y-2 md:hidden" aria-label="Rank tiers, highest to lowest">
          {[...RANK_TIERS].reverse().map((tier, idx) => {
            const i = count - 1 - idx;
            return (
              <li key={tier.name} className="flex items-center gap-3">
                <TierEmblem tone={tier.tone} size={26} />
                <span className={`w-20 shrink-0 text-sm ${i === count - 1 ? "font-medium text-fg" : "text-fg-2"}`}>{tier.name}</span>
                <span className="min-w-0 flex-1">
                  <span
                    data-step-x
                    className="block h-2 origin-left rounded-full"
                    style={{
                      width: `${22 + (i / (count - 1)) * 78}%`,
                      background: `linear-gradient(90deg, color-mix(in oklab, ${tier.tone} 70%, transparent), color-mix(in oklab, ${tier.tone} 15%, transparent))`,
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
};

export default RankLadder;
