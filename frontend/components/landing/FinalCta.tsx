import React, { useLayoutEffect, useRef } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { ButtonLink } from "../ui/Button";
import { ensureGsap } from "../../lib/motion";
import { useMagnetic } from "../../lib/useMagnetic";

const FinalCta: React.FC = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const ctaRef = useRef<HTMLAnchorElement>(null);
  useMagnetic(ctaRef, 0.25, 70);

  useLayoutEffect(() => {
    const { gsap, SplitText } = ensureGsap();
    const section = sectionRef.current;
    const headline = headlineRef.current;
    if (!section || !headline) return;

    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const split = SplitText.create(headline, { type: "words", mask: "words" });
      const tl = gsap.timeline({ scrollTrigger: { trigger: section, start: "top 70%", once: true } });
      tl.from(split.words, { yPercent: 110, duration: 1, ease: "expo.out", stagger: 0.07 }).from(
        section.querySelectorAll("[data-cta-fade]"),
        { opacity: 0, y: 16, duration: 0.8, ease: "expo.out", stagger: 0.08, clearProps: "opacity,transform" },
        "-=0.6"
      );
      return () => split.revert();
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative overflow-hidden py-32 md:py-44" aria-labelledby="cta-title">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[820px] max-w-[140vw] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgb(229_72_77/0.16),transparent)]"
      />
      <div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-5 text-center sm:px-8">
        <h2
          id="cta-title"
          ref={headlineRef}
          className="text-[clamp(2.5rem,6.5vw,5rem)] font-semibold leading-[1] tracking-[-0.045em] text-fg"
        >
          Find out who is faster.
        </h2>
        <p data-cta-fade className="mt-6 max-w-[34ch] text-base leading-relaxed text-fg-2 md:text-lg">
          Free to play. Sign in with Google or email and you are in the queue.
        </p>
        <div data-cta-fade className="mt-9">
          <ButtonLink ref={ctaRef} to="/auth?mode=signup" size="lg" className="group">
            Play now
            <ArrowRight
              weight="bold"
              className="size-4 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:translate-x-0.5"
            />
          </ButtonLink>
        </div>
      </div>
    </section>
  );
};

export default FinalCta;
