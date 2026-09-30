import React, { useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { grid, layout, ROWS } from "./font";
import { ensureGsap, prefersReducedMotion } from "../../../lib/motion";

interface PixelTextProps {
  text: string;
  /** Size it with a height, e.g. "h-[0.72em]" to sit on a text baseline at cap height. */
  className?: string;
  /** Gap between pixels as a fraction of one pixel. 0 is solid type, ~0.2 reads as an LED panel. */
  gap?: number;
  /** Draw unlit cells faintly, like a scoreboard. */
  led?: boolean;
  /** Pixels assemble from the centre out, on mount or when scrolled into view. */
  intro?: "mount" | "view" | false;
  delay?: number;
  /** Pixels ripple out from the pointer on hover. */
  ripple?: boolean;
  /** Accessible name. Defaults to the text; pass decorative to hide it. */
  label?: string;
  decorative?: boolean;
}

const rectProps = (x: number, y: number, gap: number) => {
  // Solid type overlaps by a hair so antialiasing never shows seams between pixels
  const size = gap === 0 ? 1.04 : 1 - gap;
  const inset = gap === 0 ? -0.02 : gap / 2;
  return { x: x + inset, y: y + inset, width: size, height: size };
};

/** Distance-from-origin stagger for SVG pixel cells. */
export function cellStagger(originX: number, originY: number, perUnit: number, jitter = 0) {
  return (_i: number, el: Element) => {
    const x = Number((el as SVGRectElement).dataset.x);
    const y = Number((el as SVGRectElement).dataset.y);
    return Math.hypot(x - originX, y - originY) * perUnit + (jitter ? Math.random() * jitter : 0);
  };
}

/** Pixel display type drawn as SVG cells so each pixel can be animated. */
const PixelText = React.forwardRef<SVGSVGElement, PixelTextProps>(
  ({ text, className = "", gap = 0, led = false, intro = false, delay = 0, ripple = false, label, decorative }, ref) => {
    const svgRef = useRef<SVGSVGElement>(null);
    useImperativeHandle(ref, () => svgRef.current as SVGSVGElement);
    const shape = useMemo(() => (led ? grid(text) : layout(text)), [text, led]);

    useLayoutEffect(() => {
      const svg = svgRef.current;
      if (!svg || (!intro && !ripple) || prefersReducedMotion()) return;
      const { gsap } = ensureGsap();
      const lit = Array.from(svg.querySelectorAll<SVGRectElement>("rect[data-on='1']"));
      const cx = shape.width / 2;
      const cy = ROWS / 2;
      const cleanups: (() => void)[] = [];

      if (intro) {
        const maxD = Math.hypot(cx, cy) || 1;
        gsap.set(lit, { scale: 0, transformOrigin: "50% 50%" });
        const tween = gsap.to(lit, {
          scale: 1,
          duration: 0.55,
          ease: "back.out(2.4)",
          delay,
          stagger: cellStagger(cx, cy, 0.55 / maxD, 0.12),
          paused: intro === "view",
        });
        if (intro === "view") {
          const io = new IntersectionObserver(
            ([entry]) => {
              if (entry?.isIntersecting) {
                tween.play();
                io.disconnect();
              }
            },
            { rootMargin: "0px 0px -12% 0px" }
          );
          io.observe(svg);
          cleanups.push(() => io.disconnect());
        }
        cleanups.push(() => tween.kill());
      }

      if (ripple && !window.matchMedia("(pointer: coarse)").matches) {
        let last = 0;
        const onEnter = (e: PointerEvent) => {
          const now = performance.now();
          if (now - last < 650) return;
          last = now;
          const r = svg.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * shape.width;
          const py = ((e.clientY - r.top) / r.height) * ROWS;
          gsap.to(lit, {
            keyframes: { scale: [1, 0.2, 1], easeEach: "power2.inOut" },
            duration: 0.55,
            transformOrigin: "50% 50%",
            stagger: cellStagger(px, py, 0.022),
            overwrite: "auto",
          });
        };
        svg.addEventListener("pointerenter", onEnter);
        cleanups.push(() => svg.removeEventListener("pointerenter", onEnter));
      }

      return () => {
        cleanups.forEach((fn) => fn());
        gsap.set(lit, { clearProps: "transform" });
      };
    }, [shape, intro, delay, ripple]);

    return (
      <svg
        ref={svgRef}
        viewBox={`0 0 ${shape.width} ${ROWS}`}
        className={`inline-block overflow-visible align-baseline ${className}`}
        style={{ aspectRatio: `${shape.width} / ${ROWS}` }}
        fill="currentColor"
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : label ?? text}
        aria-hidden={decorative || undefined}
      >
        {shape.cells.map((c) => (
          <rect
            key={`${c.x}-${c.y}`}
            data-x={c.x}
            data-y={c.y}
            data-on={c.on ? "1" : "0"}
            opacity={c.on ? 1 : 0.1}
            {...rectProps(c.x, c.y, gap)}
          />
        ))}
      </svg>
    );
  }
);
PixelText.displayName = "PixelText";

export interface PixelDisplayHandle {
  /** Light the cells for a string with the same glyph widths as the template. */
  set: (text: string) => void;
}

/**
 * LED panel for values that change every frame (match clocks). Draws the
 * template's full grid once, then flips cells imperatively without React.
 */
export const PixelDisplay = React.forwardRef<
  PixelDisplayHandle,
  { template: string; initial?: string; className?: string; gap?: number; off?: number }
>(({ template, initial, className = "", gap = 0.18, off = 0.1 }, ref) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const shape = useMemo(() => grid(template), [template]);
  const lastRef = useRef<string>("");

  const set = (text: string) => {
    const svg = svgRef.current;
    if (!svg || text === lastRef.current) return;
    lastRef.current = text;
    const lit = new Set(layout(text).cells.map((c) => `${c.x},${c.y}`));
    svg.querySelectorAll<SVGRectElement>("rect").forEach((r) => {
      r.setAttribute("opacity", lit.has(`${r.dataset.x},${r.dataset.y}`) ? "1" : String(off));
    });
  };

  useImperativeHandle(ref, () => ({ set }));
  useLayoutEffect(() => {
    set(initial ?? template);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${shape.width} ${ROWS}`}
      className={`inline-block align-baseline ${className}`}
      style={{ aspectRatio: `${shape.width} / ${ROWS}` }}
      fill="currentColor"
      aria-hidden="true"
    >
      {shape.cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} data-x={c.x} data-y={c.y} opacity={off} {...rectProps(c.x, c.y, gap)} />
      ))}
    </svg>
  );
});
PixelDisplay.displayName = "PixelDisplay";

export default PixelText;
