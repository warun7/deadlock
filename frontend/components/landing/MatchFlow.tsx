import React, { useLayoutEffect, useRef, useState } from "react";
import MatchPreview from "./MatchPreview";
import { ensureGsap } from "../../lib/motion";

const BEATS = [
  {
    title: "Queue up",
    body: "Press Find match and you are paired with the next player waiting.",
  },
  {
    title: "Read the same problem",
    body: "You both get the same problem at the same moment. Write in Python, JavaScript or C++.",
  },
  {
    title: "Watch the race",
    body: "Each submission reports tests passed to both players, so you always know where you stand.",
  },
  {
    title: "Pass every test first",
    body: "The first submission to clear all of the hidden tests ends the match.",
  },
];

const MatchFlow: React.FC = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLSpanElement>(null);
  const beatRef = useRef(0);
  const [beat, setBeat] = useState(0);
  const [pinned, setPinned] = useState(true);

  useLayoutEffect(() => {
    const { gsap, ScrollTrigger } = ensureGsap();
    const section = sectionRef.current;
    if (!section) return;

    const mm = gsap.matchMedia();
    mm.add(
      { motion: "(prefers-reduced-motion: no-preference)", reduce: "(prefers-reduced-motion: reduce)" },
      (context) => {
        const { reduce } = context.conditions as { reduce: boolean };
        if (reduce) {
          // Static: every beat readable, preview in its final state
          setPinned(false);
          setBeat(BEATS.length - 1);
          return;
        }
        setPinned(true);

        const st = ScrollTrigger.create({
          trigger: section,
          start: "top top",
          end: () => `+=${window.innerHeight * 2.6}`,
          pin: pinRef.current,
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const next = Math.min(BEATS.length - 1, Math.floor(self.progress * BEATS.length * 0.999));
            if (next !== beatRef.current) {
              beatRef.current = next;
              setBeat(next);
            }
            if (railRef.current) railRef.current.style.transform = `scaleY(${self.progress})`;
          },
        });

        gsap.from(section.querySelectorAll("[data-flow-reveal]"), {
          opacity: 0,
          y: 28,
          duration: 1,
          ease: "expo.out",
          stagger: 0.08,
          clearProps: "opacity,transform",
          scrollTrigger: { trigger: section, start: "top 75%", once: true },
        });

        return () => st.kill();
      }
    );

    return () => mm.revert();
  }, []);

  return (
    <section id="how-it-works" ref={sectionRef} className="relative" aria-labelledby="how-it-works-title">
      <div ref={pinRef} className="flex min-h-[100dvh] items-center py-20 md:py-0">
        <div className="mx-auto grid w-full max-w-[1200px] items-center gap-10 px-5 sm:px-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-16">
          <div>
            <h2
              id="how-it-works-title"
              data-flow-reveal
              className="text-[clamp(2rem,4.2vw,3.25rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-fg"
            >
              How a match works
            </h2>

            <div data-flow-reveal className="relative mt-8 md:mt-10">
              {pinned && (
                <span className="absolute bottom-1 left-0 top-1 w-px bg-line" aria-hidden="true">
                  <span
                    ref={railRef}
                    className="block h-full w-full origin-top bg-accent"
                    style={{ transform: "scaleY(0)" }}
                  />
                </span>
              )}
              <ol className={pinned ? "space-y-1 pl-6" : "space-y-6"}>
                {BEATS.map((b, i) => {
                  const active = !pinned || i === beat;
                  return (
                    <li
                      key={b.title}
                      aria-current={pinned && i === beat ? "step" : undefined}
                      className={`transition-opacity duration-500 ease-[var(--ease-out-expo)] ${
                        active ? "opacity-100" : "opacity-35 max-md:hidden"
                      }`}
                    >
                      <h3 className="py-1.5 text-lg font-medium tracking-[-0.01em] text-fg md:text-xl">{b.title}</h3>
                      <div
                        className={`grid transition-[grid-template-rows] duration-500 ease-[var(--ease-out-expo)] ${
                          active ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                        }`}
                      >
                        <p className="overflow-hidden text-[15px] leading-relaxed text-fg-2 md:text-base">
                          <span className="block max-w-[40ch] pb-3">{b.body}</span>
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>

          <div data-flow-reveal>
            <MatchPreview beat={beat} />
          </div>
        </div>
      </div>
    </section>
  );
};

export default MatchFlow;
