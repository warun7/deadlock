import React from "react";
import { BigTitle, Detail, Figure, Label } from "../ui/Chrome";
import { JudgeDemo, LockDemo, QueueDemo, SolveDemo } from "./StepDemos";
import { useReveal } from "./useReveal";

const STEPS = [
  {
    key: "Queue",
    lead: "Queue up.",
    body: "Press Find match and you are paired with the next player who is waiting.",
    detail: ["Shortcut", "Esc leaves the queue"],
    Demo: QueueDemo,
  },
  {
    key: "Lock in",
    lead: "Lock in.",
    body: "You both get the same problem at the same moment, and one clock starts for both of you.",
    detail: ["Problems", "Rated up to 1200"],
    Demo: LockDemo,
  },
  {
    key: "Solve",
    lead: "Write your solution",
    body: "in Python, JavaScript or C++. Read from stdin, print to stdout, submit as often as you like.",
    detail: ["Submit", "Ctrl or Cmd + Enter"],
    Demo: SolveDemo,
  },
  {
    key: "Judge",
    lead: "Pass every test first.",
    body: "Each submission runs against sample and hidden tests, and both players see how many passed.",
    detail: ["Time limit", "30 minutes, then it is a draw"],
    Demo: JudgeDemo,
  },
] as const;

const HowItWorks: React.FC = () => {
  const ref = useReveal<HTMLElement>();

  return (
    <section id="how-it-works" ref={ref} aria-labelledby="how-title" className="scroll-mt-14 px-4 pt-32 md:pt-44">
      <BigTitle id="how-title" count={STEPS.length}>
        <span className="inline-block overflow-hidden pb-[0.08em] align-top">
          <span data-reveal-line className="inline-block">
            How it works
          </span>
        </span>
      </BigTitle>

      <ol className="mt-14 grid gap-x-12 gap-y-20 md:mt-20 md:grid-cols-2 md:gap-y-24">
        {STEPS.map(({ key, lead, body, detail, Demo }, i) => (
          <li key={key} data-reveal className="flex min-w-0 flex-col">
            <Label as="h3" aside={`Fig. ${i + 2}`}>
              {String(i + 1).padStart(2, "0")} {key}
            </Label>
            <Figure n={i + 2} className="mt-5 aspect-[16/9] sm:aspect-[16/8]">
              <Demo />
            </Figure>
            <p className="mt-6 max-w-[30ch] text-[clamp(1.375rem,2vw,1.75rem)] leading-[1.1] tracking-[-0.035em] text-fg-2">
              <strong className="font-medium text-fg">{lead}</strong> {body}
            </p>
            <Detail label={detail[0]} className="mt-5">
              {detail[1]}
            </Detail>
          </li>
        ))}
      </ol>
    </section>
  );
};

export default HowItWorks;
