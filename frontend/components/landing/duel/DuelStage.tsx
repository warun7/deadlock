import React, { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { ROUNDS, type DuelPlayer, type DuelRound } from "./rounds";
import { renderPrefix, tokenize, type Token } from "./highlight";
import { prefersReducedMotion } from "../../../lib/motion";
import PixelText, { PixelDisplay, cellStagger, type PixelDisplayHandle } from "../../ui/pixel/PixelText";

/* ------------------------------------------------------------------ typing */

type Keystroke = { t: number; n: number; typo: string };

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Human-ish typing: jittered key timing, pauses at line ends, the odd typo fixed with backspace. */
function schedule(code: string, cps: number, seed: number): { keys: Keystroke[]; duration: number } {
  const rand = mulberry32(seed);
  const keys: Keystroke[] = [{ t: 0, n: 0, typo: "" }];
  let t = 0;
  const base = 1 / cps;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (/[a-z]/i.test(ch) && rand() < 0.02) {
      const wrong = "etaoinsr"[Math.floor(rand() * 8)];
      t += base * (0.7 + rand() * 0.6);
      keys.push({ t, n: i, typo: wrong });
      t += 0.12 + rand() * 0.08;
      keys.push({ t, n: i, typo: "" });
    }
    t += base * (0.55 + rand() * 0.9);
    if (ch === "\n") t += 0.03 + rand() * 0.09;
    keys.push({ t, n: i + 1, typo: "" });
  }
  return { keys, duration: t };
}

function keyAt(keys: Keystroke[], t: number): Keystroke {
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return keys[lo];
}

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fileName = (p: DuelPlayer) => (p.lang === "python" ? "solution.py" : "main.cpp");

/* ------------------------------------------------------------------ markup */

const CELL = "block aspect-square flex-1 max-w-3.5 transition-colors duration-100";
const CELL_IDLE = `${CELL} bg-white/[0.09]`;
const CELL_PASS = `${CELL} bg-screen-pass`;
const CELL_FAIL = `${CELL} bg-screen-fail`;
const STATUS = "label truncate text-[10.5px] transition-colors";

interface ScreenRefs {
  root: HTMLDivElement | null;
  scroll: HTMLDivElement | null;
  code: HTMLPreElement | null;
  cells: HTMLSpanElement[];
  status: HTMLDivElement | null;
  file: HTMLSpanElement | null;
  name: HTMLSpanElement | null;
  lang: HTMLSpanElement | null;
}

const emptyScreen = (): ScreenRefs => ({ root: null, scroll: null, code: null, cells: [], status: null, file: null, name: null, lang: null });

const setRef =
  <K extends keyof ScreenRefs>(refs: ScreenRefs, key: K) =>
  (el: ScreenRefs[K] | null) => {
    (refs as any)[key] = el;
  };

const Screen: React.FC<{ side: "you" | "them"; refs: ScreenRefs; compact?: boolean; children?: React.ReactNode }> = ({
  side,
  refs,
  compact,
  children,
}) => {
  const you = side === "you";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className={`label flex items-center gap-2 text-fg ${you ? "" : "@2xl:flex-row-reverse"}`}>
        <span className={`size-2 shrink-0 ${you ? "bg-fg" : "bg-accent"}`} aria-hidden="true" />
        <span ref={setRef(refs, "name")} className="truncate" />
        <span ref={setRef(refs, "lang")} className="text-fg-3" />
      </div>
      <div
        ref={setRef(refs, "root")}
        className={`relative flex flex-col overflow-hidden bg-screen text-screen-fg ring-1 ring-screen-line ${compact ? "h-[168px]" : "h-[190px] @2xl:h-[clamp(230px,30vh,300px)]"}`}
      >
        <div className="flex h-7 shrink-0 items-center justify-between border-b border-screen-line px-3">
          <span ref={setRef(refs, "file")} className="font-mono text-[10.5px] text-screen-fg-2" />
          <span className="flex gap-1" aria-hidden="true">
            <span className="size-1.5 bg-white/20" />
            <span className="size-1.5 bg-white/20" />
            <span className="size-1.5 bg-white/20" />
          </span>
        </div>
        <div ref={setRef(refs, "scroll")} className="min-h-0 flex-1 overflow-hidden px-3 py-2">
          <pre ref={setRef(refs, "code")} className="font-mono text-[10.5px] leading-[1.6] text-[#d4d4d4] @2xl:text-[12px]" />
        </div>
        <div className="shrink-0 border-t border-screen-line px-3 pb-2.5 pt-2">
          <div className="flex gap-[3px]">
            {Array.from({ length: 10 }, (_, i) => (
              <span
                key={i}
                ref={(el) => {
                  if (el) refs.cells[i] = el;
                }}
                className={CELL_IDLE}
              />
            ))}
          </div>
          <div ref={setRef(refs, "status")} className={`${STATUS} mt-2 text-screen-fg-2`} />
        </div>
        {children}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ stage */

interface DuelStageProps {
  className?: string;
  /** Shorter screens for small embeds (auth page) */
  compact?: boolean;
  /** Called with the problem name and rating when a round starts */
  onRound?: (round: DuelRound) => void;
}

/**
 * Live preview of a match: two editors type real solutions, the opponent's
 * submission fails, yours passes every test and gets stamped ACCEPTED.
 * One GSAP timeline per round writes straight to the DOM, so React never
 * re-renders during playback.
 */
const DuelStage: React.FC<DuelStageProps> = ({ className = "", compact = false, onRound }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<PixelDisplayHandle>(null);
  const problemRef = useRef<HTMLSpanElement>(null);
  const winnerRef = useRef<HTMLSpanElement>(null);
  const stampRef = useRef<SVGSVGElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const sparksRef = useRef<HTMLDivElement>(null);
  const onRoundRef = useRef(onRound);
  onRoundRef.current = onRound;
  const you = useRef<ScreenRefs>(emptyScreen()).current;
  const them = useRef<ScreenRefs>(emptyScreen()).current;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = prefersReducedMotion();
    let current: gsap.core.Timeline | null = null;
    let roundIndex = 0;
    let visible = true;
    const cleanups: (() => void)[] = [];
    const stampCells = () => Array.from(stampRef.current?.querySelectorAll<SVGRectElement>("rect") ?? []);

    const setMeta = (p: ScreenRefs, player: DuelPlayer) => {
      if (p.name) p.name.textContent = player.name;
      if (p.lang) p.lang.textContent = player.langLabel;
      if (p.file) p.file.textContent = fileName(player);
    };

    const setStatus = (p: ScreenRefs, text: string, tone: string) => {
      if (!p.status) return;
      p.status.textContent = text;
      p.status.className = `${STATUS} mt-2 ${tone}`;
    };

    const setRound = (round: DuelRound) => {
      if (problemRef.current) problemRef.current.textContent = `${round.problem} / ${round.rating}`;
      onRoundRef.current?.(round);
    };

    const caret = (side: "you" | "them") =>
      `<span class="inline-block h-[1.1em] w-[0.55em] translate-y-[0.15em] animate-[duel-caret_1s_steps(1)_infinite] ${
        side === "you" ? "bg-[#e6e6e6]" : "bg-screen-fail"
      }"></span>`;

    const renderCode = (p: ScreenRefs, tokens: Token[], n: number, typo: string, side: "you" | "them" | null) => {
      if (!p.code || !p.scroll) return;
      p.code.innerHTML = renderPrefix(tokens, n, typo) + (side ? caret(side) : "");
      p.scroll.scrollTop = p.scroll.scrollHeight;
    };

    const resetScreen = (p: ScreenRefs) => {
      p.cells.forEach((c) => (c.className = CELL_IDLE));
      if (p.root) gsap.set(p.root, { opacity: 1, filter: "none", clearProps: "x" });
    };

    const showWinner = (on: boolean) => {
      if (winnerRef.current) winnerRef.current.style.opacity = on ? "1" : "0";
    };

    const showFinal = (round: DuelRound) => {
      setMeta(you, round.you);
      setMeta(them, round.them);
      setRound(round);
      renderCode(you, tokenize(round.you.code, round.you.lang), Infinity, "", null);
      renderCode(them, tokenize(round.them.code, round.them.lang), Infinity, "", null);
      round.you.results.forEach((ok, i) => you.cells[i] && (you.cells[i].className = ok ? CELL_PASS : CELL_FAIL));
      round.them.results.forEach((ok, i) => them.cells[i] && (them.cells[i].className = ok ? CELL_PASS : CELL_FAIL));
      setStatus(you, `${round.you.verdict}  10/10`, "text-screen-pass");
      setStatus(them, round.them.verdict, "text-screen-fail");
      clockRef.current?.set(clock(round.finishClock));
      showWinner(true);
      if (veilRef.current) veilRef.current.style.opacity = "1";
      if (stampRef.current) stampRef.current.style.opacity = "1";
      if (them.root) gsap.set(them.root, { opacity: 0.55, filter: "grayscale(0.8)" });
    };

    if (reduced) {
      showFinal(ROUNDS[0]);
      return;
    }

    const sparks = () => {
      const host = sparksRef.current;
      if (!host) return;
      for (let i = 0; i < 22; i++) {
        const s = document.createElement("span");
        const size = 4 + Math.round(Math.random() * 4);
        s.className = "absolute left-0 top-0 block";
        s.style.width = s.style.height = `${size}px`;
        s.style.background = i % 4 === 0 ? "#ffffff" : "var(--screen-pass)";
        host.appendChild(s);
        const angle = Math.random() * Math.PI * 2;
        const dist = 70 + Math.random() * 140;
        gsap.fromTo(
          s,
          { x: 0, y: 0, rotation: 0, opacity: 1 },
          {
            x: Math.cos(angle) * dist,
            y: Math.sin(angle) * dist * 0.6,
            rotation: (Math.random() - 0.5) * 360,
            opacity: 0,
            duration: 0.8 + Math.random() * 0.5,
            ease: "expo.out",
            onComplete: () => s.remove(),
          }
        );
      }
    };

    const playRound = (round: DuelRound, seed: number) => {
      const youTokens = tokenize(round.you.code, round.you.lang);
      const themTokens = tokenize(round.them.code, round.them.lang);
      const youType = schedule(round.you.code, round.you.cps, seed);
      const themType = schedule(round.them.code, round.them.cps, seed + 7);

      const T0 = 0.45;
      const themDone = T0 + themType.duration;
      const youDone = T0 + youType.duration;
      const themSubmit = themDone + 0.25;
      const themJudged = themSubmit + 0.2 + 10 * 0.07;
      const youSubmit = Math.max(youDone + 0.3, themJudged + 0.35);
      const youJudged = youSubmit + 0.2 + 10 * 0.06;
      const stampAt = youJudged + 0.06;
      const end = stampAt + 3.2;

      setMeta(you, round.you);
      setMeta(them, round.them);
      setRound(round);
      resetScreen(you);
      resetScreen(them);
      showWinner(false);
      setStatus(you, "Writing solution", "text-screen-fg-2");
      setStatus(them, "Writing solution", "text-screen-fg-2");
      if (veilRef.current) veilRef.current.style.opacity = "0";
      if (stampRef.current) stampRef.current.style.opacity = "0";

      const state = { t: 0 };
      let youCaret = true;
      let themCaret = true;
      const tl = gsap.timeline({
        onComplete: () => {
          roundIndex = (roundIndex + 1) % ROUNDS.length;
          playRound(ROUNDS[roundIndex], seed + 31);
        },
      });
      current = tl;
      if (!visible) tl.pause();

      tl.fromTo([you.root, them.root], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: "expo.out", stagger: 0.06 }, 0);

      tl.to(
        state,
        {
          t: end,
          duration: end,
          ease: "none",
          onUpdate: () => {
            const t = state.t;
            const yk = keyAt(youType.keys, t - T0);
            const tk = keyAt(themType.keys, t - T0);
            renderCode(you, youTokens, t < T0 ? 0 : yk.n, t < T0 ? "" : yk.typo, youCaret ? "you" : null);
            renderCode(them, themTokens, t < T0 ? 0 : tk.n, t < T0 ? "" : tk.typo, themCaret ? "them" : null);
            clockRef.current?.set(clock((Math.min(t, stampAt) / stampAt) * round.finishClock));
          },
        },
        0
      );

      const judge = (p: ScreenRefs, player: DuelPlayer, at: number, step: number, onDone: () => void) => {
        tl.call(() => setStatus(p, "Running tests", "text-screen-fg"), undefined, at);
        player.results.forEach((ok, i) => {
          tl.call(
            () => {
              const cell = p.cells[i];
              if (!cell) return;
              cell.className = ok ? CELL_PASS : CELL_FAIL;
              gsap.fromTo(cell, { scale: 0.3 }, { scale: 1, duration: 0.35, ease: "back.out(3)" });
            },
            undefined,
            at + 0.25 + i * step
          );
        });
        tl.call(onDone, undefined, at + 0.25 + player.results.length * step);
      };

      // Opponent submits first and fails
      tl.call(() => (themCaret = false), undefined, themSubmit);
      judge(them, round.them, themSubmit, 0.07, () => {
        setStatus(them, round.them.verdict, "text-screen-fail");
        if (them.root) gsap.fromTo(them.root, { x: -8 }, { x: 0, duration: 0.55, ease: "elastic.out(1, 0.3)" });
      });

      // You submit, pass everything, get stamped
      tl.call(() => (youCaret = false), undefined, youSubmit);
      judge(you, round.you, youSubmit, 0.06, () => {
        setStatus(you, `${round.you.verdict}  10/10`, "text-screen-pass");
        const cells = stampCells();
        if (stampRef.current) stampRef.current.style.opacity = "1";
        if (veilRef.current) gsap.fromTo(veilRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 });
        const w = Number(stampRef.current?.viewBox.baseVal.width ?? 40);
        gsap.fromTo(
          cells,
          { scale: 0, transformOrigin: "50% 50%" },
          { scale: 1, duration: 0.4, ease: "back.out(3)", stagger: cellStagger(w / 2, 3.5, 0.018, 0.05) }
        );
        if (bodyRef.current) gsap.fromTo(bodyRef.current, { scale: 1.015 }, { scale: 1, duration: 0.7, ease: "expo.out" });
        if (them.root) gsap.to(them.root, { opacity: 0.55, filter: "grayscale(0.8)", duration: 0.6 });
        showWinner(true);
        sparks();
      });

      // Clear the stage before the next round
      tl.to([you.root, them.root], { opacity: 0, y: -8, duration: 0.45, ease: "power2.in" }, end - 0.45);
      tl.to(stampRef.current, { opacity: 0, duration: 0.3 }, end - 0.45);
    };

    playRound(ROUNDS[0], 11);

    // Pause off screen and in background tabs
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (!current) return;
      if (visible && !document.hidden) current.resume();
      else current.pause();
    });
    io.observe(root);
    const onVis = () => {
      if (!current) return;
      if (document.hidden) current.pause();
      else if (visible) current.resume();
    };
    document.addEventListener("visibilitychange", onVis);
    cleanups.push(() => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    });

    return () => {
      current?.kill();
      gsap.killTweensOf([you.root, them.root, stampRef.current, veilRef.current, bodyRef.current, ...stampCells()]);
      cleanups.forEach((fn) => fn());
    };
  }, [you, them]);

  return (
    <div ref={rootRef} className={`@container relative w-full ${className}`} aria-hidden="true">
      <div ref={bodyRef}>
        {/* Scoreboard */}
        <div className="flex flex-col items-center gap-2 pb-4 @2xl:pb-5">
          <PixelDisplay ref={clockRef} template="00:00" className={`text-fg ${compact ? "h-6" : "h-7 @2xl:h-11"}`} />
          <div className="label flex items-center gap-2 text-fg-2">
            <span ref={problemRef} />
            <span ref={winnerRef} className="bg-pass px-1 text-[10px] text-[#04130b] opacity-0 transition-opacity">
              You win
            </span>
          </div>
        </div>

        <div className="grid gap-3 @2xl:grid-cols-2 @2xl:gap-5">
          <Screen side="you" refs={you} compact={compact}>
            <div ref={veilRef} className="pointer-events-none absolute inset-0 bg-screen/75 opacity-0" />
            <div className="pointer-events-none absolute inset-x-0 top-[42%] flex -translate-y-1/2 justify-center">
              <PixelText
                ref={stampRef}
                text="ACCEPTED"
                gap={0.14}
                decorative
                className={`text-screen-pass opacity-0 ${compact ? "h-6" : "h-7 @2xl:h-10"}`}
              />
              <div ref={sparksRef} className="absolute left-1/2 top-1/2 size-0" />
            </div>
          </Screen>
          <Screen side="them" refs={them} compact={compact} />
        </div>
      </div>
    </div>
  );
};

export default React.memo(DuelStage);
