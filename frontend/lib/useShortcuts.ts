import { useEffect, useRef } from "react";

const isTyping = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable || !!node.closest?.(".cm-editor");
};

/**
 * Single-key shortcuts shown as [K] on nav chips. Ignored while typing,
 * with modifier keys held, or when something else already handled the key.
 */
export function useShortcuts(map: Record<string, () => void>, enabled = true) {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTyping(e.target) || document.querySelector("[aria-modal='true']")) return;
      const fn = mapRef.current[e.key.toLowerCase()];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
