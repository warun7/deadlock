import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ensureGsap, prefersReducedMotion } from "../../lib/motion";

/*
  Small motion primitives. Each one is decorative on top of real text, so
  screen readers get the plain string and reduced motion gets a still frame.
*/

/**
 * Label that rolls up letter by letter when its hover group is hovered.
 * Put `group` on the button or link.
 */
export const RollText: React.FC<{ children: string; className?: string }> = ({ children, className = "" }) => {
  const chars = [...children];
  return (
    <span className={`relative inline-flex ${className}`}>
      <span className="sr-only">{children}</span>
      <span aria-hidden="true" className="inline-flex overflow-hidden">
        {chars.map((ch, i) => (
          <span key={i} className="relative inline-block">
            <span
              className="block transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:-translate-y-full motion-reduce:transition-none"
              style={{ transitionDelay: `${i * 14}ms` }}
            >
              {ch === " " ? " " : ch}
            </span>
            <span
              className="absolute inset-x-0 top-full block transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:-translate-y-full motion-reduce:transition-none"
              style={{ transitionDelay: `${i * 14}ms` }}
            >
              {ch === " " ? " " : ch}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
};

/**
 * Two states in one grid cell: the inactive one slides and blurs out, the
 * active one slides in. The cell keeps the width of the wider state, so
 * nothing around it shifts.
 */
export const Swap: React.FC<{
  on: boolean;
  off: React.ReactNode;
  onNode: React.ReactNode;
  align?: "start" | "center";
  className?: string;
}> = ({ on, off, onNode, align = "center", className = "" }) => {
  const base = `col-start-1 row-start-1 inline-flex items-center ${
    align === "start" ? "justify-start" : "justify-center"
  } transition-[transform,opacity,filter] duration-300 ease-[var(--ease-out-expo)] motion-reduce:transition-none`;
  return (
    <span className={`inline-grid ${className}`}>
      <span aria-hidden={on} className={`${base} ${on ? "-translate-y-2 opacity-0 blur-[2px]" : ""}`}>
        {off}
      </span>
      <span aria-hidden={!on} className={`${base} ${on ? "" : "translate-y-2 opacity-0 blur-[2px]"}`}>
        {onNode}
      </span>
    </span>
  );
};

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Odometer: each digit column rolls to its value, left to right. */
export const RollingNumber: React.FC<{ value: string; className?: string }> = ({ value, className = "" }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setArmed(true);
      return;
    }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setArmed(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  let digitIndex = 0;
  return (
    <span className={`relative inline-flex ${className}`}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="inline-flex">
        {[...value].map((ch, i) => {
          if (!/\d/.test(ch)) return <span key={i}>{ch}</span>;
          const delay = digitIndex++ * 70;
          return (
            <span key={i} className="relative inline-block h-[1em] overflow-hidden">
              <span
                className="flex flex-col transition-transform duration-[1100ms] ease-[var(--ease-out-expo)] motion-reduce:transition-none"
                style={{ transform: `translateY(-${(armed ? Number(ch) : 0) * 10}%)`, transitionDelay: `${delay}ms` }}
              >
                {DIGITS.map((d) => (
                  <span key={d} className="block h-[1em] leading-none">
                    {d}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
};

/**
 * Burst of square pixels from the centre of its box, once, on mount.
 * Absolute-positioned: place it inside a relative parent.
 */
export const PixelBurst: React.FC<{ colors: string[]; count?: number; spread?: number; delay?: number; className?: string }> = ({
  colors,
  count = 24,
  spread = 150,
  delay = 0,
  className = "",
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || prefersReducedMotion()) return;
    const { gsap } = ensureGsap();
    const bits: HTMLSpanElement[] = [];
    for (let i = 0; i < count; i++) {
      const s = document.createElement("span");
      const size = 4 + Math.round(Math.random() * 5);
      s.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;background:${colors[i % colors.length]};opacity:0`;
      host.appendChild(s);
      bits.push(s);
      const angle = Math.random() * Math.PI * 2;
      const dist = spread * (0.45 + Math.random() * 0.55);
      gsap.fromTo(
        s,
        { x: 0, y: 0, rotation: 0, opacity: 1 },
        {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist * 0.7 + 30,
          rotation: (Math.random() - 0.5) * 300,
          opacity: 0,
          duration: 0.9 + Math.random() * 0.6,
          delay,
          ease: "expo.out",
        }
      );
    }
    return () => {
      gsap.killTweensOf(bits);
      bits.forEach((b) => b.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors.join(","), count, spread, delay]);
  return <span ref={ref} aria-hidden="true" className={`pointer-events-none absolute left-1/2 top-1/2 size-0 ${className}`} />;
};
