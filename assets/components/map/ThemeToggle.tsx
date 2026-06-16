import { useEffect, useState } from "react";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

/**
 * App-wide light/dark switch: a single Sun/Moon icon button. Defaults to the OS
 * theme on first load (see next-themes' `defaultTheme="system"` in App.tsx) and
 * persists explicit choices to localStorage. Styled to match the map legend card
 * so it reads as part of the top-left overlay stack.
 *
 * Flipping the theme also swaps the basemap light↔dark — that sync lives in
 * MapView (driven by `resolvedTheme`), since the basemap state is owned there.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // `resolvedTheme` is undefined until mounted; gate rendering so the icon
  // doesn't flash the wrong glyph before the theme is known.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      disabled={!mounted}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="bg-background/95 rounded-md border shadow-sm backdrop-blur-sm"
    >
      {mounted && isDark ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
