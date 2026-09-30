import React, { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { ROUNDS, type DuelPlayer, type DuelRound } from "./rounds";
import { renderPrefix, tokenize, type Token } from "./highlight";
import { prefersReducedMotion } from "../../../lib/motion";

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

/* ------------------------------------------------------------------ markup */

const PIP = "h-2 flex-1 rounded-[2px] transition-[background-color,box-shadow] duration-150";
const PIP_IDLE = `${PIP} bg-white/[0.07]`;
const PIP_PASS = `${PIP} bg-pass shadow-[0_0_10px_rgb(61_214_140/0.55)]`;
const PIP_FAIL = `${PIP} bg-accent shadow-[0_0_10px_rgb(229_72_77/0.6)]`;

const STATUS = "truncate text-[11px] @2xl:text-[12px] transition-colors";

interface PanelRefs {
  root: HTMLDivElement | null;
  inner: HTMLDivElement | null;
  scroll: HTMLDivElement | null;
  code: HTMLPreElement | null;
  pips: HTMLSpanElement[];
  status: HTMLDivElement | null;
  name: HTMLSpanElement | null;
  lang: HTMLSpanElement | null;
  initial: HTMLSpanElement | null;
}

const emptyPanel = (): PanelRefs => ({ root: null, inner: null, scroll: null, code: null, pips: [], status: null, name: null, lang: null, initial: null });

const Panel: React.FC<{ side: "you" | "them"; refs: PanelRefs; children?: React.ReactNode }> = ({ side, refs, children }) => {
  const you = side === "you";
  return (
    <div
      ref={(el) => {
        refs.root = el;
      }}
      className={`relative w-full [transform-style:preserve-3d] @2xl:w-[min(45%,440px)] ${
        you ? "@2xl:origin-right @2xl:[transform:rotateY(22deg)]" : "@2xl:origin-left @2xl:[transform:rotateY(-22deg)]"
      }`}
    >
      <div
        ref={(el) => {
          refs.inner = el;
        }}
        className={`relative flex h-[150px] flex-col overflow-hidden rounded-[14px] bg-[#0e0e11] shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)] @2xl:h-[clamp(230px,34vh,320px)] ${
          you ? "ring-1 ring-white/[0.12]" : "ring-1 ring-accent/30"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute inset-x-0 top-0 h-[2px] ${
            you
              ? "bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.85)_40%,rgb(61_214_140/0.9))]"
              : "bg-[linear-gradient(90deg,rgb(229_72_77/0.95),rgb(255_99_105/0.8)_60%,transparent)]"
          }`}
        />
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 @2xl:h-10">
          <span
            ref={(el) => {
              refs.initial = el;
            }}
            className={`flex size-5 items-center justify-center rounded-[6px] text-[10px] font-semibold ${
              you ? "bg-white/[0.12] text-fg" : "bg-accent/20 text-accent-text"
            }`}
          />
          <span
            ref={(el) => {
              refs.name = el;
            }}
            className="truncate text-[12px] font-medium text-fg @2xl:text-[13px]"
          />
          <span
            ref={(el) => {
              refs.lang = el;
            }}
            className="rounded-[5px] bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-fg-3 @2xl:text-[11px]"
          />
        </div>
        <div
          ref={(el) => {
            refs.scroll = el;
          }}
          className="min-h-0 flex-1 overflow-hidden px-3 py-2"
        >
          <pre
            ref={(el) => {
              refs.code = el;
            }}
            className="font-mono text-[10.5px] leading-[1.6] text-[#d4d4d4] @2xl:text-[12.5px]"
          />
        </div>
        <div className="shrink-0 px-3 pb-2.5 pt-1.5 @2xl:pb-3">
          <div className="flex gap-[3px]">
            {Array.from({ length: 10 }, (_, i) => (
              <span
                key={i}
                ref={(el) => {
                  if (el) refs.pips[i] = el;
                }}
                className={PIP_IDLE}
              />
            ))}
          </div>
          <div
            ref={(el) => {
              refs.status = el;
            }}
            className={`${STATUS} mt-1.5 text-fg-3`}
          />
        </div>
        {children}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ stage */

interface DuelStageProps {
  className?: string;
  /** Pointer tilts the arena. Off for small embeds. */
  interactive?: boolean;
}

/**
 * Live preview of a match: two editors type real solutions, the opponent's
 * submission fails, yours passes every test and gets stamped ACCEPTED.
 * Everything is driven by one GSAP timeline per round writing straight to the
 * DOM, so React never re-renders during playback.
 */
const DuelStage = React.forwardRef<HTMLDivElement, DuelStageProps>(({ className = "", interactive = true }, forwardedRef) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLDivElement>(null);
  const problemRef = useRef<HTMLSpanElement>(null);
  const ratingRef = useRef<HTMLSpanElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const stampRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const sparksRef = useRef<HTMLDivElement>(null);
  const you = useRef<PanelRefs>(emptyPanel()).current;
  const them = useRef<PanelRefs>(emptyPanel()).current;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = prefersReducedMotion();
    let current: gsap.core.Timeline | null = null;
    let roundIndex = 0;
    let visible = true;
    const cleanups: (() => void)[] = [];

    const setPanelMeta = (p: PanelRefs, player: DuelPlayer) => {
      if (p.name) p.name.textContent = player.name;
      if (p.lang) p.lang.textContent = player.langLabel;
      if (p.initial) p.initial.textContent = player.name[0].toUpperCase();
    };

    const setStatus = (p: PanelRefs, text: string, tone: string) => {
      if (!p.status) return;
      p.status.textContent = text;
      p.status.className = `${STATUS} mt-1.5 ${tone}`;
    };

    const caret = (side: "you" | "them") =>
      `<span class="inline-block h-[1.1em] w-[0.55em] translate-y-[0.15em] animate-[duel-caret_1s_steps(1)_infinite] ${
        side === "you" ? "bg-fg/80" : "bg-accent"
      }"></span>`;

    const renderCode = (p: PanelRefs, tokens: Token[], n: number, typo: string, side: "you" | "them" | null) => {
      if (!p.code || !p.scroll) return;
      p.code.innerHTML = renderPrefix(tokens, n, typo) + (side ? caret(side) : "");
      p.scroll.scrollTop = p.scroll.scrollHeight;
    };

    const resetPanel = (p: PanelRefs) => {
      p.pips.forEach((pip) => (pip.className = PIP_IDLE));
      if (p.inner) gsap.set(p.inner, { opacity: 1, filter: "none", clearProps: "x" });
    };

    const showFinal = (round: DuelRound) => {
      setPanelMeta(you, round.you);
      setPanelMeta(them, round.them);
      renderCode(you, tokenize(round.you.code, round.you.lang), Infinity, "", null);
      renderCode(them, tokenize(round.them.code, round.them.lang), Infinity, "", null);
      round.you.results.forEach((ok, i) => you.pips[i] && (you.pips[i].className = ok ? PIP_PASS : PIP_FAIL));
      round.them.results.forEach((ok, i) => them.pips[i] && (them.pips[i].className = ok ? PIP_PASS : PIP_FAIL));
      setStatus(you, `${round.you.verdict}  10/10`, "text-pass");
      setStatus(them, round.them.verdict, "text-accent-text");
      if (timerRef.current) timerRef.current.textContent = clock(round.finishClock);
      if (problemRef.current) problemRef.current.textContent = round.problem;
      if (ratingRef.current) ratingRef.current.textContent = String(round.rating);
      if (resultRef.current) resultRef.current.style.opacity = "1";
      if (stampRef.current) gsap.set(stampRef.current, { opacity: 1, scale: 1, rotation: -8 });
      if (them.inner) gsap.set(them.inner, { opacity: 0.5, filter: "grayscale(0.7)" });
    };

    if (reduced) {
      showFinal(ROUNDS[0]);
      return;
    }

    const sparks = (color: string) => {
      const host = sparksRef.current;
      if (!host) return;
      for (let i = 0; i < 26; i++) {
        const s = document.createElement("span");
        s.className = "absolute left-1/2 top-1/2 block size-1.5 rounded-full";
        s.style.background = i % 3 === 0 ? "#ffffff" : color;
        host.appendChild(s);
        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 130;
        gsap.fromTo(
          s,
          { x: 0, y: 0, opacity: 1, scale: 1 },
          {
            x: Math.cos(angle) * dist,
            y: Math.sin(angle) * dist * 0.7,
            opacity: 0,
            scale: 0.2,
            duration: 0.7 + Math.random() * 0.6,
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
      const end = stampAt + 3;

      setPanelMeta(you, round.you);
      setPanelMeta(them, round.them);
      resetPanel(you);
      resetPanel(them);
      setStatus(you, "Writing solution", "text-fg-3");
      setStatus(them, "Writing solution", "text-fg-3");
      if (problemRef.current) problemRef.current.textContent = round.problem;
      if (ratingRef.current) ratingRef.current.textContent = String(round.rating);
      if (resultRef.current) resultRef.current.style.opacity = "0";
      if (stampRef.current) gsap.set(stampRef.current, { opacity: 0 });

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

      tl.fromTo(
        [you.inner, them.inner, timerRef.current?.parentElement],
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, ease: "expo.out", stagger: 0.06 },
        0
      );

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
            if (timerRef.current) timerRef.current.textContent = clock((Math.min(t, stampAt) / stampAt) * round.finishClock);
          },
        },
        0
      );

      const judge = (p: PanelRefs, player: DuelPlayer, at: number, step: number, onDone: () => void) => {
        tl.call(() => setStatus(p, "Running tests", "text-fg-2"), undefined, at);
        player.results.forEach((ok, i) => {
          tl.call(() => p.pips[i] && (p.pips[i].className = ok ? PIP_PASS : PIP_FAIL), undefined, at + 0.25 + i * step);
        });
        tl.call(onDone, undefined, at + 0.25 + player.results.length * step);
      };

      // Opponent submits first and fails
      tl.call(() => (themCaret = false), undefined, themSubmit);
      judge(them, round.them, themSubmit, 0.07, () => {
        setStatus(them, round.them.verdict, "text-accent-text");
        if (them.inner) gsap.fromTo(them.inner, { x: -7 }, { x: 0, duration: 0.5, ease: "elastic.out(1, 0.3)" });
      });

      // You submit, pass everything, get stamped
      tl.call(() => (youCaret = false), undefined, youSubmit);
      judge(you, round.you, youSubmit, 0.06, () => {
        setStatus(you, `${round.you.verdict}  10/10`, "text-pass");
        if (stampRef.current)
          gsap.fromTo(
            stampRef.current,
            { opacity: 0, scale: 2.4, rotation: -18 },
            { opacity: 1, scale: 1, rotation: -8, duration: 0.5, ease: "back.out(2.2)" }
          );
        if (flashRef.current) gsap.fromTo(flashRef.current, { opacity: 0.55 }, { opacity: 0, duration: 0.7, ease: "expo.out" });
        if (tiltRef.current) gsap.fromTo(tiltRef.current, { scale: 1.035 }, { scale: 1, duration: 0.7, ease: "expo.out" });
        if (them.inner) gsap.to(them.inner, { opacity: 0.45, filter: "grayscale(0.75)", duration: 0.6 });
        if (resultRef.current) gsap.to(resultRef.current, { opacity: 1, duration: 0.4 });
        sparks("#3dd68c");
      });

      // Clear the stage before the next round
      tl.to([you.inner, them.inner], { opacity: 0, y: -10, duration: 0.45, ease: "power2.in" }, end - 0.45);
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

    // Pointer tilt with a springy lag
    if (interactive && tiltRef.current && !window.matchMedia("(pointer: coarse)").matches) {
      const rx = gsap.quickTo(tiltRef.current, "rotationX", { duration: 0.9, ease: "power3.out" });
      const ry = gsap.quickTo(tiltRef.current, "rotationY", { duration: 0.9, ease: "power3.out" });
      const onMove = (e: PointerEvent) => {
        const nx = e.clientX / window.innerWidth - 0.5;
        const ny = e.clientY / window.innerHeight - 0.5;
        ry(nx * 10);
        rx(-ny * 6);
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      cleanups.push(() => window.removeEventListener("pointermove", onMove));
    }

    return () => {
      current?.kill();
      gsap.killTweensOf([you.inner, them.inner, stampRef.current, flashRef.current, tiltRef.current, resultRef.current]);
      cleanups.forEach((fn) => fn());
    };
  }, [interactive, you, them]);

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        if (typeof forwardedRef === "function") forwardedRef(el);
        else if (forwardedRef) forwardedRef.current = el;
      }}
      className={`@container relative w-full [perspective:1600px] ${className}`}
      aria-hidden="true"
    >
      <div ref={tiltRef} className="relative [transform-style:preserve-3d]">
        {/* HUD */}
        <div className="relative mb-4 flex flex-col items-center gap-1 @2xl:mb-7">
          <div ref={timerRef} className="tabular font-mono text-2xl font-medium tracking-[-0.02em] text-fg @2xl:text-3xl">
            00:00
          </div>
          <div className="flex items-center gap-2 text-[12px] text-fg-3">
            <span ref={problemRef} className="text-fg-2" />
            <span className="tabular font-mono" ref={ratingRef} />
          </div>
          <div ref={resultRef} className="text-[12px] font-medium text-pass opacity-0">
            you win
          </div>
        </div>

        <div className="relative flex flex-col items-center gap-2.5 [transform-style:preserve-3d] @2xl:flex-row @2xl:items-stretch @2xl:justify-center @2xl:gap-0">
          <Panel side="you" refs={you}>
            <div ref={flashRef} className="pointer-events-none absolute inset-0 bg-pass/30 opacity-0" />
            <div
              ref={stampRef}
              className="pointer-events-none absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 rounded-[8px] border-2 border-pass/90 bg-[#0e0e11]/70 px-3 py-1 font-mono text-lg font-bold tracking-[0.12em] text-pass opacity-0 backdrop-blur-[2px] @2xl:px-4 @2xl:text-3xl"
            >
              ACCEPTED
            </div>
            <div ref={sparksRef} className="pointer-events-none absolute left-1/2 top-[44%] size-0" />
          </Panel>

          <div className="relative z-10 flex shrink-0 items-center justify-center @2xl:w-24">
            <span className="relative flex size-9 rotate-45 items-center justify-center rounded-[8px] bg-surface-2 shadow-[inset_0_0_0_1px_rgb(229_72_77/0.45),0_0_28px_-6px_rgb(229_72_77/0.4)] @2xl:size-14">
              <span className="-rotate-45 font-mono text-[12px] font-bold italic tracking-tight text-fg @2xl:text-base">VS</span>
            </span>
          </div>

          <Panel side="them" refs={them} />
        </div>
      </div>
    </div>
  );
});
DuelStage.displayName = "DuelStage";

export default DuelStage;
