import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "deadlock:theme";
const META = { light: "#e8e8e6", dark: "#050505" } as const;
const listeners = new Set<() => void>();

function read(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function apply(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META[theme]);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  listeners.forEach((fn) => fn());
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

/**
 * Switch themes. With an origin (the toggle's position), the new theme grows
 * out of that point as a circle using the View Transitions API; browsers
 * without it, and reduced motion, switch instantly.
 */
export function setTheme(theme: Theme, origin?: { x: number; y: number }) {
  const doc = document as ViewTransitionDoc;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!origin || !doc.startViewTransition || reduced) {
    apply(theme);
    return;
  }
  const { x, y } = origin;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = doc.startViewTransition(() => apply(theme));
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(0.16, 1, 0.3, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    })
    .catch(() => {
      /* transition skipped: the theme is already applied */
    });
}

/** Centre of the [T] chip, so keyboard toggles grow from the same place as clicks. */
function toggleOrigin(): { x: number; y: number } | undefined {
  const chip = document.querySelector<HTMLElement>('[data-kbd="t"]');
  if (!chip) return undefined;
  const r = chip.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Paper (light) or terminal (dark). The initial value is set before paint by index.html. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, read, () => "light" as Theme);
  const toggle = useCallback(
    (origin?: { x: number; y: number }) => setTheme(read() === "dark" ? "light" : "dark", origin ?? toggleOrigin()),
    []
  );
  return { theme, toggle };
}
