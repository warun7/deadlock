import React, { useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ArrowDown } from "@phosphor-icons/react";
import DuelStage from "./duel/DuelStage";
import { ButtonLink } from "../ui/Button";
import { CrossRow, Detail, Figure, Label } from "../ui/Chrome";
import PixelText from "../ui/pixel/PixelText";
import { ensureGsap, prefersReducedMotion } from "../../lib/motion";
import { ROUNDS } from "./duel/rounds";

interface HeroProps {
  onAnchor: (id: string) => void;
}

const Hero: React.FC<HeroProps> = ({ onAnchor }) => {
  const sectionRef = useRef<HTMLElement>(null);
  const [round, setRound] = useState(ROUNDS[0]);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section || prefersReducedMotion()) return;
    const { gsap } = ensureGsap();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" }, delay: 0.05 });
      tl.from("[data-line]", { yPercent: 105, duration: 1.1, stagger: 0.08 })
        .from("[data-fade]", { opacity: 0, y: 14, duration: 0.8, stagger: 0.06, clearProps: "opacity,transform" }, 0.35)
        .from("[data-cross] svg", { scale: 0, rotation: 90, duration: 0.6, stagger: 0.03, clearProps: "transform" }, 0.2)
        .from("[data-fig]", { opacity: 0, y: 30, duration: 1.1, clearProps: "opacity,transform" }, 0.5);
    }, section);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} aria-labelledby="hero-title" className="px-4 pt-5 md:pt-8">
      <div data-cross>
        <CrossRow at={[0, 62, 86, 100]} />
      </div>

      <h1
        id="hero-title"
        className="mt-6 text-[clamp(3rem,15vw,3.4rem)] font-medium sm:text-[clamp(3.4rem,10.4vw,10.5rem)] leading-[0.9] tracking-[-0.065em] text-fg md:mt-8"
      >
        <span className="block overflow-hidden pb-[0.04em]">
          <span data-line className="block">
            Same problem.
          </span>
        </span>
        <span className="block overflow-hidden pb-[0.06em]">
          <span data-line className="block whitespace-nowrap">
            Solve it{" "}
            <PixelText text="FIRST" label="first" intro="mount" delay={0.55} ripple className="h-[0.7em] text-fg" />
            <span className="text-accent">.</span>
          </span>
        </span>
      </h1>

      <div className="mt-10 grid gap-10 md:mt-12 md:grid-cols-12 md:gap-6">
        <p
          data-fade
          className="max-w-[26ch] text-[clamp(1.5rem,2.55vw,2.25rem)] font-medium leading-[1.06] tracking-[-0.04em] text-fg md:col-span-7 md:max-w-none"
        >
          Real-time 1v1 duels on competitive programming problems. One clock for both of you, and the first submission to
          pass every test wins.
        </p>

        <div data-fade className="flex flex-col gap-3 md:col-span-4 md:col-start-9 md:self-end">
          <Label>Start</Label>
          <ButtonLink to="/auth?mode=signup" variant="accent" size="lg" className="group mt-2 w-full justify-between">
            Play now
            <ArrowRight weight="bold" className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
          </ButtonLink>
          <a
            href="#how-it-works"
            onClick={(e) => {
              e.preventDefault();
              onAnchor("how-it-works");
            }}
            className="label group inline-flex h-12 w-full items-center justify-between rounded-full px-6 text-fg shadow-[inset_0_0_0_1px_var(--fg)] transition-colors hover:bg-fg hover:text-bg"
          >
            How it works
            <ArrowDown weight="bold" className="size-4 transition-transform duration-300 group-hover:translate-y-0.5" />
          </a>
          <Detail label="Languages" className="mt-1">
            Python, JavaScript, C++
          </Detail>
        </div>
      </div>

      <div data-cross className="mt-12 md:mt-14">
        <CrossRow at={[0, 62, 86, 100]} />
      </div>

      <div data-fig className="mt-12 md:mt-14">
        <Label aside={<span className="hidden sm:inline">{`${round.problem} / rated ${round.rating}`}</span>}>Fig. 1 Sample match</Label>
        <Figure
          n={1}
          caption="A sample match: two players write solutions to the same problem side by side. The opponent's submission fails a test; yours passes every test and is marked Accepted."
          className="mt-5"
          bodyClassName="px-3 py-5 md:px-8 md:py-8"
        >
          <DuelStage onRound={setRound} />
        </Figure>
        <p className="label mt-3 text-fg-3">Scripted for illustration. Real matches use real problems and hidden tests.</p>
      </div>
    </section>
  );
};

export default Hero;
