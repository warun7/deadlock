import React from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { Chip } from "./Chrome";
import { useTheme } from "../../lib/theme";

/** [T] theme toggle chip. The page registers the T shortcut itself. */
const ThemeChip: React.FC = () => {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} className="rounded-[3px]" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
      <Chip k="T">
        {theme === "dark" ? <Sun className="size-3.5" weight="bold" /> : <Moon className="size-3.5" weight="bold" />}
        <span className="hidden lg:inline">{theme === "dark" ? "Light" : "Dark"}</span>
      </Chip>
    </button>
  );
};

export default ThemeChip;
