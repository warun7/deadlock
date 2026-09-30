import React from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { ButtonLink } from "../ui/Button";
import { CrossRow, Label } from "../ui/Chrome";
import { useReveal } from "./useReveal";

const FinalCta: React.FC = () => {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} aria-labelledby="cta-title" className="px-4 pb-32 pt-36 md:pb-40 md:pt-52">
      <CrossRow at={[0, 62, 86, 100]} />
      <h2
        id="cta-title"
        className="mt-8 text-[clamp(3.4rem,10.4vw,10.5rem)] font-medium leading-[0.9] tracking-[-0.065em] text-fg"
      >
        <span className="block overflow-hidden pb-[0.04em]">
          <span data-reveal-line className="block">
            Find out who
          </span>
        </span>
        <span className="block overflow-hidden pb-[0.06em]">
          <span data-reveal-line className="block">
            is faster<span className="text-accent">.</span>
          </span>
        </span>
      </h2>
      <div className="mt-12 grid gap-10 md:grid-cols-12 md:gap-6">
        <p data-reveal className="max-w-[24ch] text-[clamp(1.5rem,2.55vw,2.25rem)] font-medium leading-[1.06] tracking-[-0.04em] text-fg md:col-span-7">
          Free to play. Sign up with Google or email and you are in the queue.
        </p>
        <div data-reveal className="flex flex-col gap-3 md:col-span-4 md:col-start-9 md:self-end">
          <Label>Play</Label>
          <ButtonLink to="/auth?mode=signup" variant="accent" size="lg" className="group mt-2 w-full justify-between">
            Create an account
            <ArrowRight weight="bold" className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
          </ButtonLink>
          <ButtonLink to="/auth" variant="outline" size="lg" className="w-full justify-between">
            I have an account
            <span className="label opacity-60">[L]</span>
          </ButtonLink>
        </div>
      </div>
      <CrossRow className="mt-14" at={[0, 62, 86, 100]} />
    </section>
  );
};

export default FinalCta;
