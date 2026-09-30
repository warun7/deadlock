import { useEffect } from "react";
import { gsap } from "gsap";
import { prefersReducedMotion } from "./motion";

/**
 * Pulls an element toward the pointer while it is near, springing back on leave.
 * Driven by gsap.quickTo so it never touches React state.
 */
export function useMagnetic<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  strength = 0.3,
  radius = 90
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || window.matchMedia("(pointer: coarse)").matches) return;

    const xTo = gsap.quickTo(el, "x", { duration: 0.6, ease: "elastic.out(1, 0.45)" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.6, ease: "elastic.out(1, 0.45)" });

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const reach = Math.max(rect.width, rect.height) / 2 + radius;
      if (Math.hypot(dx, dy) < reach) {
        xTo(dx * strength);
        yTo(dy * strength);
      } else {
        xTo(0);
        yTo(0);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      gsap.set(el, { x: 0, y: 0 });
    };
  }, [ref, strength, radius]);
}
