import { useLayoutEffect, useRef } from "react";
import { ensureGsap } from "../../lib/motion";

/**
 * Scroll reveal for a section: [data-reveal-line] slides up out of its
 * overflow-hidden parent (the mask),
 * [data-reveal] items fade up in sequence. Runs once, skipped for reduced motion.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const { gsap } = ensureGsap();
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const lines = root.querySelectorAll("[data-reveal-line]");
      gsap.from(lines, {
        yPercent: 105,
        duration: 1.1,
        ease: "expo.out",
        stagger: 0.08,
        clearProps: "transform",
        scrollTrigger: { trigger: root, start: "top 78%", once: true },
      });
      root.querySelectorAll("[data-reveal]").forEach((el) => {
        gsap.from(el, {
          opacity: 0,
          y: 28,
          duration: 1,
          ease: "expo.out",
          clearProps: "opacity,transform",
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        });
      });
    });
    return () => mm.revert();
  }, []);
  return ref;
}
