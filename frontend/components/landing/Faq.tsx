import React, { useId, useState } from "react";
import { BigTitle, Label } from "../ui/Chrome";
import { useReveal } from "./useReveal";

const QUESTIONS = [
  {
    q: "Which languages can I use?",
    a: "Python, JavaScript and C++. You can switch mid-match; each language keeps its own draft, and your next match starts in the one you used last.",
  },
  {
    q: "What kind of problems are they?",
    a: "Classic competitive programming problems rated 800 to 2400. Ranked picks one near both players' ratings; in friend duels the host picks the level. Each one has sample tests you can see and hidden tests you cannot.",
  },
  {
    q: "How is the winner decided?",
    a: "The first submission that passes every test wins on the spot. Wrong submissions cost nothing but time, so submit whenever you think you have it.",
  },
  {
    q: "Can I test my code before submitting?",
    a: "Yes. Run checks your code against the sample tests, or input you type, and your opponent is not told. Only a submission can win. After a match against a person you can compare solutions: each player sees the other's last submission.",
  },
  {
    q: "What if nobody solves it?",
    a: "After 30 minutes the match ends in a draw. You can also forfeit at any time, which hands your opponent the win.",
  },
  {
    q: "What if nobody else is online?",
    a: "Race a ghost: a replay of a real player's ranked win, their submissions landing when they did. Beat their time and you gain rating; ghost duels count half as much as live ranked. You can also send a friend a duel link, practice against a bot, or turn on alerts to hear when someone is waiting. Every day there is a ranked hour when everyone queues at once.",
  },
  {
    q: "Is my solve used as a ghost?",
    a: "Yes: when you win a ranked match (or beat a ghost), that solve can be raced by other players, who see your username, your rating at the time and, after the race, your code. Only the racer's rating moves.",
  },
  {
    q: "Is there a leaderboard?",
    a: "Yes, for each season, ordered by rating. Players under fair-play review are left out until a person has checked. When a season ends its standings are kept, and every rating moves halfway back to 1000 for a fresh start.",
  },
  {
    q: "Can I play against a friend?",
    a: "Yes. Open a duel room from the lobby, pick a level, and send the link. Your friend signs in, you both press ready, and the room keeps score across rematches. Friend duels are unrated.",
  },
  {
    q: "What about AI and cheating?",
    a: "Solutions have to come from you, not an AI or anyone else. In matches against people the problem cannot be copied, the editor only pastes what you copied inside it, and your opponent sees when you leave the tab. Ranked matches also log how the code was entered, and you can report an opponent from the result screen. A person reviews flagged matches and reports.",
  },
  {
    q: "Do I need an account?",
    a: "Yes, so your record follows you. Sign up with Google or with an email and password; it takes under a minute.",
  },
];

const Row: React.FC<{ q: string; a: string; index: number }> = ({ q, a, index }) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="border-b border-line">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="group grid w-full grid-cols-[40px_minmax(0,1fr)_24px] items-center gap-4 py-3 text-left sm:grid-cols-[88px_minmax(0,1fr)_24px]"
        >
          <span className="label flex items-center gap-2 text-fg">
            <span
              className={`size-[7px] transition-[background-color,transform] duration-300 ease-[var(--ease-out-expo)] group-hover:rotate-45 group-hover:bg-accent ${
                open ? "rotate-45 bg-accent" : "bg-fg"
              }`}
              aria-hidden="true"
            />
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-[clamp(1.25rem,2.2vw,1.875rem)] leading-[1.1] tracking-[-0.035em] text-fg transition-colors group-hover:text-accent-ink">
            {q}
          </span>
          <span
            aria-hidden="true"
            className={`justify-self-end font-mono text-xl leading-none text-fg transition-transform duration-300 ease-[var(--ease-out-expo)] ${open ? "rotate-45" : ""}`}
          >
            +
          </span>
        </button>
      </h3>
      <div
        id={id}
        role="region"
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[var(--ease-out-expo)] ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <p className="max-w-[56ch] pb-5 pl-[56px] text-[17px] leading-snug text-fg-2 sm:pl-[104px]">{a}</p>
        </div>
      </div>
    </li>
  );
};

const Faq: React.FC = () => {
  const ref = useReveal<HTMLElement>();
  return (
    <section id="faq" ref={ref} aria-labelledby="faq-title" className="scroll-mt-14 px-4 pt-32 md:pt-44">
      <BigTitle id="faq-title" count={QUESTIONS.length}>
        <span className="inline-block overflow-hidden pb-[0.08em] align-top">
          <span data-reveal-line className="inline-block">
            Questions
          </span>
        </span>
      </BigTitle>
      <div className="mt-14 grid gap-12 md:mt-20 md:grid-cols-12 md:gap-6">
        <div data-reveal className="md:col-span-3">
          <Label>Rules</Label>
          <p className="mt-4 max-w-[34ch] text-[17px] leading-snug tracking-[-0.01em] text-fg-2">
            One problem, one clock, two players. Everything else follows from that.
          </p>
        </div>
        <div data-reveal className="md:col-span-9">
          <div className="label grid grid-cols-[40px_minmax(0,1fr)] gap-4 pb-2 text-fg sm:grid-cols-[88px_minmax(0,1fr)]">
            <span>/ No.</span>
            <span>/ Question</span>
          </div>
          <ol className="border-t border-rule">
            {QUESTIONS.map((item, i) => (
              <Row key={item.q} {...item} index={i} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
};

export default Faq;
