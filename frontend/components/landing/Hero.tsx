import React, { useLayoutEffect, useRef } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import DuelStage from "./duel/DuelStage";
import { ButtonLink } from "../ui/Button";
import { ensureGsap, prefersReducedMotion } from "../../lib/motion";
import { useMagnetic } from "../../lib/useMagnetic";

interface HeroProps {
  onAnchor: (id: string) => void;
}

const Hero: React.FC<HeroProps> = ({ onAnchor }) => {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const ctaRef = useRef<HTMLAnchorElement>(null);

  useMagnetic(ctaRef, 0.25, 70);

  useLayoutEffect(() => {
    const { gsap, SplitText } = ensureGsap();
    const section = sectionRef.current;
    const headline = headlineRef.current;
    if (!section || !headline || prefersReducedMotion()) return;

    const ctx = gsap.context(() => {
      const split = SplitText.create(headline, { type: "words", mask: "words" });
      const tl = gsap.timeline({ defaults: { ease: "expo.out" }, delay: 0.15 });
      tl.from(stageRef.current, { opacity: 0, y: 40, rotationX: 24, transformPerspective: 1400, duration: 1.4 })
        .from(split.words, { yPercent: 110, duration: 1, stagger: 0.05 }, "-=1.1")
        .from("[data-hero-fade]", { opacity: 0, y: 16, duration: 0.8, stagger: 0.08, clearProps: "opacity,transform" }, "-=0.7");

      // The arena tips back and dims as you scroll past it
      gsap.to(stageRef.current, {
        rotationX: 18,
        y: -30,
        opacity: 0.25,
        transformPerspective: 1400,
        ease: "none",
        scrollTrigger: { trigger: section, start: "top top", end: "bottom top", scrub: true },
      });
      gsap.to(contentRef.current, {
        y: -40,
        opacity: 0,
        ease: "none",
        scrollTrigger: { trigger: section, start: "20% top", end: "bottom 10%", scrub: true },
      });
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative isolate flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden px-5 pb-14 pt-24 sm:px-8"
    >
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute left-1/2 top-[34%] h-[520px] w-[1100px] max-w-[160vw] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgb(229_72_77/0.13),transparent)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink to-transparent" />
      </div>

      <div ref={stageRef} className="w-full max-w-[1040px]">
        <DuelStage />
        <p className="sr-only">
          Preview of a match: two players write solutions to the same problem side by side. The opponent&apos;s
          submission fails a test, and yours passes every test and is marked Accepted.
        </p>
      </div>

      <div ref={contentRef} className="mt-10 flex flex-col items-center text-center md:mt-12">
        <h1
          ref={headlineRef}
          className="text-[clamp(2.25rem,4.8vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-fg"
        >
          Two coders. One problem.
        </h1>

        <p data-hero-fade className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-fg-2 md:text-lg">
          Real-time 1v1 duels on competitive programming problems. The first submission to pass every test wins.
        </p>

        <div data-hero-fade className="mt-8 flex flex-wrap items-center justify-center gap-3">
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
    </section>
  );
};

export default Hero;
