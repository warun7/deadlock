import React, { useLayoutEffect, useRef } from "react";
import { ensureGsap, prefersReducedMotion } from "../../lib/motion";
import { PixelDisplay, type PixelDisplayHandle } from "../ui/pixel/PixelText";

/*
  Small looping figures for "How it works". Each one is a GSAP timeline that
  only runs while it is on screen. Reduced motion shows the resting frame.
*/

type Build = (root: HTMLElement, gsap: typeof import("gsap").gsap) => gsap.core.Timeline;

function useLoop(ref: React.RefObject<HTMLElement | null>, build: Build, rest?: (root: HTMLElement) => void) {
  const buildRef = useRef(build);
  const restRef = useRef(rest);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (prefersReducedMotion()) {
      restRef.current?.(root);
      return;
    }
    const { gsap } = ensureGsap();
    let tl: gsap.core.Timeline | null = null;
    const ctx = gsap.context(() => {
      tl = buildRef.current(root, gsap);
      tl.pause();
    }, root);
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !document.hidden) tl?.play();
      else tl?.pause();
    });
    io.observe(root);
    return () => {
      io.disconnect();
      ctx.revert();
    };
  }, [ref]);
}

/* ------------------------------------------------------------ 01 queue */

const COLS = 21;
const ROWS = 7;
const CENTER = Math.floor(ROWS / 2) * COLS + Math.floor(COLS / 2);
const OPPONENT = 1 * COLS + 16;

export const QueueDemo: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  useLoop(
    ref,
    (root, gsap) => {
      const cells = gsap.utils.toArray<HTMLElement>("[data-cell]", root);
      const others = cells.filter((_, i) => i !== CENTER);
      const opp = root.querySelector("[data-opp]");
      const found = root.querySelector("[data-found]");
      const wave = { grid: [ROWS, COLS] as [number, number], from: CENTER, amount: 0.9 };
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.3 });
      gsap.set(others, { scale: 0.45, opacity: 0.18 });
      tl.to(others, { keyframes: { scale: [0.45, 1, 0.45], opacity: [0.18, 0.9, 0.18] }, duration: 0.7, ease: "none", stagger: wave })
        .to(others, { keyframes: { scale: [0.45, 1, 0.45], opacity: [0.18, 0.9, 0.18] }, duration: 0.7, ease: "none", stagger: wave }, 1.3)
        .fromTo(opp, { scale: 0, opacity: 1 }, { scale: 1, duration: 0.5, ease: "back.out(3)" }, 2.7)
        .fromTo(found, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4, ease: "expo.out" }, 2.8)
        .to([opp, found], { opacity: 0, duration: 0.3 }, 4.4);
      return tl;
    },
    (root) => {
      root.querySelectorAll<HTMLElement>("[data-cell]").forEach((c, i) => {
        if (i !== CENTER) Object.assign(c.style, { transform: "scale(0.45)", opacity: "0.18" });
      });
      const opp = root.querySelector<HTMLElement>("[data-opp]");
      if (opp) opp.style.scale = "1";
      const found = root.querySelector<HTMLElement>("[data-found]");
      if (found) found.style.opacity = "1";
    }
  );
  return (
    <div ref={ref} className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-6" aria-hidden="true">
      <div className="grid w-full max-w-[420px] gap-[6px]" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <span key={i} className="relative block aspect-square">
            <span data-cell className="absolute inset-0 bg-fg" />
            {i === OPPONENT && <span data-opp className="absolute inset-0 scale-0 bg-accent" />}
          </span>
        ))}
      </div>
      <span data-found className="label text-fg opacity-0">
        Opponent found
      </span>
    </div>
  );
};

/* ------------------------------------------------------------ 02 lock in */

export const LockDemo: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const clockRef = useRef<PixelDisplayHandle>(null);
  useLoop(
    ref,
    (root, gsap) => {
      const left = root.querySelector("[data-left]");
      const right = root.querySelector("[data-right]");
      const bar = root.querySelector("[data-bar]");
      const t = { s: 0 };
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.2 });
      tl.set(t, { s: 0 })
        .call(() => clockRef.current?.set("00:00"))
        .fromTo(left, { xPercent: -78 }, { xPercent: 0, duration: 0.9, ease: "power4.in" }, 0)
        .fromTo(right, { xPercent: 78 }, { xPercent: 0, duration: 0.9, ease: "power4.in" }, 0)
        .to(left, { keyframes: { xPercent: [0, -5, 0, -2, 0] }, duration: 0.5, ease: "none" }, 0.9)
        .to(right, { keyframes: { xPercent: [0, 5, 0, 2, 0] }, duration: 0.5, ease: "none" }, 0.9)
        .fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 3, ease: "none" }, 1.1)
        .to(t, { s: 12, duration: 3, ease: "none", onUpdate: () => clockRef.current?.set(`00:${String(Math.floor(t.s)).padStart(2, "0")}`) }, 1.1)
        .to([left, right], { opacity: 0, duration: 0.3 }, 4.3)
        .to(bar, { opacity: 0, duration: 0.3 }, 4.3)
        .set([left, right, bar], { opacity: 1 });
      return tl;
    },
    () => clockRef.current?.set("00:12")
  );
  return (
    <div ref={ref} className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-6" aria-hidden="true">
      <div className="relative h-[clamp(56px,9vw,88px)] w-full max-w-[460px]">
        <div data-left className="absolute inset-y-0 left-0 flex w-1/2 justify-end">
          <span className="aspect-square h-full bg-fg" />
        </div>
        <div data-right className="absolute inset-y-0 right-0 flex w-1/2 justify-start">
          <span className="aspect-square h-full bg-accent" />
        </div>
      </div>
      <div className="flex w-full max-w-[460px] items-center gap-3">
        <PixelDisplay ref={clockRef} template="00:00" className="h-4 text-fg" />
        <span className="h-px flex-1 bg-line">
          <span data-bar className="block h-px origin-left bg-fg" />
        </span>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------ 03 solve */

// Syntax-coloured bars: [indent, ...segment widths as % with a colour]
const LINES: { indent: number; segs: [number, string][] }[] = [
  { indent: 0, segs: [[10, "#c586c0"], [8, "#9cdcfe"]] },
  { indent: 0, segs: [] },
  { indent: 0, segs: [[6, "#9cdcfe"], [4, "#d4d4d4"], [22, "#dcdcaa"]] },
  { indent: 0, segs: [[8, "#c586c0"], [5, "#9cdcfe"], [5, "#c586c0"], [12, "#dcdcaa"]] },
  { indent: 1, segs: [[7, "#9cdcfe"], [5, "#d4d4d4"], [9, "#b5cea8"], [14, "#ce9178"]] },
  { indent: 1, segs: [[5, "#c586c0"], [16, "#9cdcfe"]] },
  { indent: 2, segs: [[18, "#9cdcfe"], [10, "#b5cea8"]] },
  { indent: 0, segs: [[12, "#dcdcaa"], [16, "#9cdcfe"]] },
];

export const SolveDemo: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  useLoop(ref, (root, gsap) => {
    const lines = gsap.utils.toArray<HTMLElement>("[data-line]", root);
    const carets = gsap.utils.toArray<HTMLElement>("[data-caret]", root);
    const flash = root.querySelector("[data-flash]");
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.4 });
    tl.set(carets, { opacity: 0 });
    tl.set(root.querySelectorAll("[data-seg]"), { scaleX: 0 });
    let at = 0.2;
    lines.forEach((line, i) => {
      const segs = line.querySelectorAll("[data-seg]");
      tl.set(carets, { opacity: 0 }, at).set(carets[i], { opacity: 1 }, at);
      if (segs.length) {
        tl.to(segs, { scaleX: 1, duration: 0.28, ease: "steps(6)", stagger: 0.24 }, at);
        at += segs.length * 0.24 + 0.12;
      } else at += 0.2;
    });
    tl.set(carets, { opacity: 0 }, at + 0.2)
      .fromTo(flash, { opacity: 0 }, { opacity: 1, duration: 0.12 }, at + 0.3)
      .to(flash, { opacity: 0, duration: 0.6 }, at + 1.3)
      .to(root.querySelectorAll("[data-seg]"), { opacity: 0, duration: 0.3 }, at + 1.6)
      .set(root.querySelectorAll("[data-seg]"), { opacity: 1 }, at + 1.95);
    return tl;
  });
  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center p-5 sm:p-7" aria-hidden="true">
      <div className="relative flex h-full max-h-[240px] w-full max-w-[460px] flex-col bg-screen">
        <div className="flex h-6 shrink-0 items-center border-b border-screen-line px-3 font-mono text-[10px] text-screen-fg-2">
          solution.py
        </div>
        <div className="flex flex-1 flex-col justify-center gap-[7px] px-3 py-3">
          {LINES.map((l, i) => (
            <div key={i} data-line className="flex h-[7px] items-center gap-[5px]">
              <span className="w-3 shrink-0 font-mono text-[8px] leading-none text-white/25">{i + 1}</span>
              <span style={{ width: `${l.indent * 6}%` }} className="shrink-0" />
              {l.segs.map(([w, c], j) => (
                <span key={j} data-seg className="block h-full origin-left" style={{ width: `${w}%`, background: c, opacity: 0.85 }} />
              ))}
              <span data-caret className="block h-[9px] w-[5px] bg-screen-fg opacity-0" />
            </div>
          ))}
        </div>
        <div data-flash className="label absolute bottom-2 right-3 text-[10px] text-screen-fg opacity-0">
          Submitted
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------ 04 judge */

const THEM = [true, true, true, true, true, true, true, false, true, true];

export const JudgeDemo: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  useLoop(
    ref,
    (root, gsap) => {
      const mine = gsap.utils.toArray<HTMLElement>("[data-you] [data-c]", root);
      const theirs = gsap.utils.toArray<HTMLElement>("[data-them] [data-c]", root);
      const themVerdict = root.querySelector("[data-them-v]");
      const youVerdict = root.querySelector("[data-you-v]");
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.3 });
      tl.set([...mine, ...theirs], { scale: 0 }).set([themVerdict, youVerdict], { opacity: 0 });
      tl.to(theirs, { scale: 1, duration: 0.3, ease: "back.out(3)", stagger: 0.09 }, 0.3)
        .to(themVerdict, { opacity: 1, duration: 0.2 }, 1.3)
        .to(mine, { scale: 1, duration: 0.3, ease: "back.out(3)", stagger: 0.07 }, 1.7)
        .to(youVerdict, { opacity: 1, duration: 0.2 }, 2.5)
        .to(mine, { keyframes: { y: [0, -6, 0] }, duration: 0.45, ease: "none", stagger: 0.04 }, 2.55)
        .to([...mine, ...theirs, themVerdict, youVerdict], { opacity: 0, duration: 0.3 }, 4.2)
        .set([...mine, ...theirs], { opacity: 1 });
      return tl;
    },
    (root) => root.querySelectorAll<HTMLElement>("[data-them-v], [data-you-v]").forEach((v) => (v.style.opacity = "1"))
  );
  const Row = ({ who, results, verdict, tone }: { who: string; results: boolean[]; verdict: string; tone: string }) => (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[60px_minmax(0,1fr)]">
      <span className="label text-fg">{who}</span>
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-[5px]" data-row>
          {results.map((ok, i) => (
            <span key={i} className="relative block aspect-square flex-1 bg-fg/10">
              <span data-c className={`absolute inset-0 ${ok ? "bg-pass" : "bg-accent"}`} />
            </span>
          ))}
        </div>
        <span className={`label text-[10.5px] opacity-0 ${tone}`} {...{ [who === "You" ? "data-you-v" : "data-them-v"]: true }}>
          {verdict}
        </span>
      </div>
    </div>
  );
  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center p-6" aria-hidden="true">
      <div className="flex w-full max-w-[460px] flex-col gap-4">
        <div data-them>
          <Row who="Rival" results={THEM} verdict="Wrong answer on test 8" tone="text-accent-ink" />
        </div>
        <div data-you>
          <Row who="You" results={THEM.map(() => true)} verdict="Accepted 10/10" tone="text-pass-ink" />
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------ live queue */

/** The queue grid for the real matchmaking screen: ripples while searching, lights the opponent when found. */
export const SearchGrid: React.FC<{ found: boolean; className?: string }> = ({ found, className = "" }) => {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const { gsap } = ensureGsap();
    const cells = gsap.utils.toArray<HTMLElement>("[data-cell]", root);
    const others = cells.filter((_, i) => i !== CENTER);
    const opp = root.querySelector("[data-opp]");
    const reduced = prefersReducedMotion();
    gsap.set(others, { scale: 0.45, opacity: 0.18 });

    if (found) {
      if (reduced) gsap.set(opp, { scale: 1 });
      else gsap.fromTo(opp, { scale: 0 }, { scale: 1, duration: 0.6, ease: "back.out(3)" });
      return () => gsap.killTweensOf(opp);
    }
    gsap.set(opp, { scale: 0 });
    if (reduced) return;
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.5 });
    tl.to(others, {
      keyframes: { scale: [0.45, 1, 0.45], opacity: [0.18, 0.9, 0.18] },
      duration: 0.7,
      ease: "none",
      stagger: { grid: [ROWS, COLS], from: CENTER, amount: 0.9 },
    });
    return () => {
      tl.kill();
    };
  }, [found]);

  return (
    <div
      ref={ref}
      className={`grid w-full gap-[6px] ${className}`}
      style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      aria-hidden="true"
    >
      {Array.from({ length: COLS * ROWS }, (_, i) => (
        <span key={i} className="relative block aspect-square">
          <span data-cell className="absolute inset-0 bg-fg" />
          {i === OPPONENT && <span data-opp className="absolute inset-0 scale-0 bg-accent" />}
        </span>
      ))}
    </div>
  );
};
