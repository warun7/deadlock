import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "deadlock:theme";
const META = { light: "#e8e8e6", dark: "#050505" } as const;
const listeners = new Set<() => void>();

function read(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(theme: Theme) {
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

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Paper (light) or terminal (dark). The initial value is set before paint by index.html. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, read, () => "light" as Theme);
  const toggle = useCallback(() => setTheme(read() === "dark" ? "light" : "dark"), []);
  return { theme, toggle };
}
