import React from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { Chip } from "./Chrome";
import { useTheme } from "../../lib/theme";

/** [T] theme toggle chip. The page registers the T shortcut itself. */
const ThemeChip: React.FC = () => {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={(e) => toggle(e.detail > 0 ? { x: e.clientX, y: e.clientY } : undefined)}
      className="rounded-[3px]"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      <Chip k="T">
        <span className="relative size-3.5">
          <Moon
            weight="bold"
            className={`absolute inset-0 size-3.5 transition-[transform,opacity] duration-500 ease-[var(--ease-out-expo)] ${
              dark ? "-rotate-90 scale-50 opacity-0" : ""
            }`}
          />
          <Sun
            weight="bold"
            className={`absolute inset-0 size-3.5 transition-[transform,opacity] duration-500 ease-[var(--ease-out-expo)] ${
              dark ? "" : "rotate-90 scale-50 opacity-0"
            }`}
          />
        </span>
        <span className="hidden lg:inline">{dark ? "Light" : "Dark"}</span>
      </Chip>
    </button>
  );
};

export default ThemeChip;
