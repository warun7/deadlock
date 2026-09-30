import React from "react";
import { CheckCircle, Timer } from "@phosphor-icons/react";
import Avatar from "../ui/Avatar";
import TestPips from "../arena/TestPips";

/*
  Landing-page preview of a match, built from the same pieces as the arena.
  All values here are sample data for illustration.
*/
const SAMPLE = {
  opponent: "kestrel_dp",
  problem: "Balanced Brackets",
  rating: 1100,
  total: 10,
  clocks: ["0:07", "00:00", "04:16", "08:42"],
  you: [0, 0, 4, 10],
  them: [0, 0, 6, 7],
};

const LANGS = ["Python", "JavaScript", "C++"];

interface MatchPreviewProps {
  beat: number;
}

const layer = (active: boolean) =>
  `absolute inset-0 transition-[opacity,transform,filter] duration-700 ease-[var(--ease-out-expo)] ${
    active ? "opacity-100 translate-y-0 blur-0" : "pointer-events-none opacity-0 translate-y-3 blur-[2px]"
  }`;

const MatchPreview: React.FC<MatchPreviewProps> = ({ beat }) => {
  const matched = beat > 0;
  const won = beat >= 3;

  return (
    <div className="panel relative w-full overflow-hidden p-5 sm:p-6" aria-label="Sample match preview">
      <div className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative flex items-center justify-between text-[13px] text-fg-3">
        <span>Sample match</span>
        <span className="tabular inline-flex items-center gap-1.5 font-mono text-fg-2">
          <Timer className="size-3.5" aria-hidden="true" />
          {SAMPLE.clocks[beat]}
        </span>
      </div>

      {/* Players */}
      <div className="relative mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name="You" size={40} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium text-fg">You</div>
            <div className="text-[13px] text-fg-3">Python</div>
          </div>
        </div>
        <span className="font-mono text-xs uppercase tracking-[0.12em] text-fg-3">vs</span>
        <div className="flex min-w-0 items-center justify-end gap-3 text-right">
          <div className="min-w-0">
            <div
              className={`truncate text-[15px] font-medium transition-colors duration-500 ${
                matched ? "text-fg" : "text-fg-3"
              }`}
            >
              {matched ? SAMPLE.opponent : "Searching"}
            </div>
            <div className="text-[13px] text-fg-3">{matched ? "C++" : "Queue open"}</div>
          </div>
          <span className={`transition-opacity duration-500 ${matched ? "opacity-100" : "opacity-40"}`}>
            <Avatar name={matched ? SAMPLE.opponent : "?"} size={40} />
          </span>
        </div>
      </div>

      {/* Stage */}
      <div className="relative mt-6 h-[188px]">
        {/* Queue */}
        <div className={layer(beat === 0)}>
          <div className="flex h-full flex-col items-center justify-center gap-4 rounded-[var(--radius-control)] bg-surface-2/60">
            <span className="relative flex size-12 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/25 motion-reduce:animate-none" />
              <span className="size-3 rounded-full bg-accent" />
            </span>
            <span className="text-sm text-fg-2">Finding an opponent</span>
          </div>
        </div>

        {/* Problem */}
        <div className={layer(beat === 1)}>
          <div className="flex h-full flex-col justify-between rounded-[var(--radius-control)] bg-surface-2/60 p-4">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[17px] font-medium text-fg">{SAMPLE.problem}</span>
                <span className="tabular font-mono text-[13px] text-fg-3">{SAMPLE.rating}</span>
              </div>
              <p className="mt-2 max-w-[42ch] text-[13px] leading-relaxed text-fg-3">
                Given a string of brackets, find the fewest insertions that make it balanced.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LANGS.map((l) => (
                <span key={l} className="rounded-[6px] bg-white/[0.06] px-2 py-1 text-[12px] text-fg-2">
                  {l}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Race + result share one layer so the pips animate between beats 2 and 3 */}
        <div className={layer(beat >= 2)}>
          <div className="flex h-full flex-col justify-between gap-4 rounded-[var(--radius-control)] bg-surface-2/60 p-4">
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-[13px]">
                  <span className="text-fg-2">You</span>
                  <span className={`tabular font-mono ${won ? "text-pass" : "text-fg-2"}`}>
                    {SAMPLE.you[beat]}/{SAMPLE.total}
                  </span>
                </div>
                <TestPips passed={SAMPLE.you[beat]} total={SAMPLE.total} tone={won ? "pass" : "you"} stagger />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-[13px]">
                  <span className="text-fg-2">{SAMPLE.opponent}</span>
                  <span className="tabular font-mono text-fg-2">
                    {SAMPLE.them[beat]}/{SAMPLE.total}
                  </span>
                </div>
                <TestPips passed={SAMPLE.them[beat]} total={SAMPLE.total} tone="opponent" stagger />
              </div>
            </div>
            <div
              className={`flex items-center gap-2 text-sm transition-[opacity,transform] duration-500 ease-[var(--ease-out-expo)] ${
                won ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
              }`}
              aria-hidden={!won}
            >
              <CheckCircle weight="fill" className="size-4 text-pass" aria-hidden="true" />
              <span className="text-fg">Accepted. You win in {SAMPLE.clocks[3]}.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MatchPreview;
