import { useCallback, useEffect, useRef } from "react";
import Lenis from "lenis";
import { ensureGsap, prefersReducedMotion } from "./motion";

/**
 * Inertia smooth scroll for marketing pages, synced to GSAP's ticker so
 * ScrollTrigger reads the same scroll position Lenis renders.
 * Disabled for reduced motion and touch-first devices (native scroll feels right there).
 */
export function useLenis() {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const { gsap, ScrollTrigger } = ensureGsap();
    if (prefersReducedMotion() || window.matchMedia("(pointer: coarse)").matches) return;

    const lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), wheelMultiplier: 1 });
    lenisRef.current = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  const scrollTo = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    if (lenisRef.current) {
      lenisRef.current.scrollTo(target, { offset: 0, duration: 1.4 });
    } else {
      target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    }
    history.replaceState(null, "", `#${id}`);
  }, []);

  return { scrollTo };
}
