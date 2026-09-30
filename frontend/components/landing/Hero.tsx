import React, { useLayoutEffect, useRef } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import CrtScreen from "../threeui/CrtScreen";
import { ButtonLink } from "../ui/Button";
import { ensureGsap, prefersReducedMotion } from "../../lib/motion";
import { useMagnetic } from "../../lib/useMagnetic";

interface HeroProps {
  onAnchor: (id: string) => void;
}

const Hero: React.FC<HeroProps> = ({ onAnchor }) => {
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const ctaRef = useRef<HTMLAnchorElement>(null);

  useMagnetic(ctaRef, 0.25, 70);

  useLayoutEffect(() => {
    const { gsap, SplitText } = ensureGsap();
    const section = sectionRef.current;
    const headline = headlineRef.current;
    if (!section || !headline) return;

    const reduced = prefersReducedMotion();
    const ctx = gsap.context(() => {
      if (!reduced) {
        const split = SplitText.create(headline, { type: "lines,words", mask: "lines" });
        const tl = gsap.timeline({ defaults: { ease: "expo.out" }, delay: 0.25 });
        tl.from(split.words, { yPercent: 110, duration: 1.1, stagger: 0.06 })
          .from("[data-hero-fade]", { opacity: 0, y: 18, duration: 0.9, stagger: 0.08 }, "-=0.75");

        gsap.to(contentRef.current, {
          yPercent: -18,
          opacity: 0,
          ease: "none",
          scrollTrigger: { trigger: section, start: "top top", end: "bottom 20%", scrub: true },
        });
      }
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative isolate flex min-h-[100dvh] items-end overflow-hidden md:items-center"
    >
      <div className="absolute inset-0 -z-10">
        <div className="shader-frame absolute inset-0" aria-hidden="true">
          <CrtScreen
            variant="blue-screen"
            speed={1.0}
            motion={1.0}
            hue={0}
            saturation={1.0}
            brightness={1.0}
            opacity={1.0}
          />
        </div>
        {/* Readability: shade the side the copy sits on (left on desktop, bottom on
            phones) so the fault-report text behind reads as texture, not competing copy */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(11_11_13/0.95)_0%,rgb(11_11_13/0.88)_38%,rgb(11_11_13/0.3)_62%,transparent_80%)] max-md:bg-[linear-gradient(0deg,rgb(11_11_13/0.97)_32%,rgb(11_11_13/0.7)_52%,rgb(11_11_13/0.15)_75%)]" />
        {/* Section seam into the dark page below */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink to-transparent" />
      </div>

      <div
        ref={contentRef}
        className="mx-auto w-full max-w-[1200px] px-5 pb-16 pt-24 sm:px-8 md:pb-0"
      >
        <div className="max-w-[34rem]">
          <h1
            ref={headlineRef}
            className="text-[clamp(2.75rem,7vw,5.25rem)] font-semibold leading-[0.95] tracking-[-0.045em] text-fg"
          >
            Two coders.
            <br />
            One problem.
          </h1>

          <p data-hero-fade className="mt-6 max-w-[30rem] text-[17px] leading-relaxed text-fg-2 md:text-lg">
            Real-time 1v1 duels on competitive programming problems. The first submission to pass every test wins.
          </p>

          <div data-hero-fade className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink ref={ctaRef} to="/auth?mode=signup" size="lg" className="group">
              Play now
              <ArrowRight
                weight="bold"
                className="size-4 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:translate-x-0.5"
              />
            </ButtonLink>
            <a
              href="#how-it-works"
              onClick={(e) => {
                e.preventDefault();
                onAnchor("how-it-works");
              }}
              className="inline-flex h-12 items-center rounded-[var(--radius-control)] px-4 text-[15px] font-medium text-fg-2 transition-colors hover:text-fg"
            >
              How it works
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
