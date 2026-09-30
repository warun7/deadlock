import { useEffect, useRef } from "react";

const isTyping = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable || !!node.closest?.(".cm-editor");
};

/**
 * Briefly mark every element hinting this key ([data-kbd="k"]) and the control
 * around it as pressed, so a shortcut visibly "clicks" the thing it stands for.
 */
export function echoKey(key: string) {
  document.querySelectorAll<HTMLElement>(`[data-kbd="${CSS.escape(key)}"]`).forEach((el) => {
    const targets = new Set([el, el.closest<HTMLElement>("a, button") ?? el]);
    targets.forEach((t) => {
      t.dataset.pressed = "";
      window.setTimeout(() => delete t.dataset.pressed, 170);
    });
  });
}

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
      const key = e.key.toLowerCase();
      const fn = mapRef.current[key];
      if (!fn) return;
      e.preventDefault();
      echoKey(key);
      // Let the press register before the page moves on
      window.setTimeout(fn, 90);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
