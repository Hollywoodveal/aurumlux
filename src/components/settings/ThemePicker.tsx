import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  APP_THEMES,
  DEFAULT_THEME,
  THEME_LABELS,
  loadTheme,
  saveTheme,
  type AppTheme,
} from "@/lib/theme";

/**
 * Literal swatch colours, mirroring the palettes in styles.css. They have to be
 * hard-coded: each tile previews a theme other than the active one, so it can't
 * read the live CSS tokens.
 */
const PREVIEW: Record<
  AppTheme,
  { page: string; ink: string; gold: string; card: string }
> = {
  light: { page: "#f7f3ea", ink: "#3a3530", gold: "#8a6a1f", card: "#fdfbf6" },
  neutral: {
    page: "#e8dfc8",
    ink: "#4a4238",
    gold: "#84651d",
    card: "#f0e9d8",
  },
  dark: { page: "#0f0f0e", ink: "#e8e4dc", gold: "#e0b955", card: "#1f1e1c" },
};

const DESCRIPTION: Record<AppTheme, string> = {
  light: "Cream paper",
  neutral: "Warm sepia",
  dark: "Black & gold",
};

export function ThemePicker() {
  // Starts at the default and corrects itself on mount: the real choice lives in
  // localStorage, which the server can't see.
  const [theme, setTheme] = useState<AppTheme>(DEFAULT_THEME);

  useEffect(() => {
    setTheme(loadTheme());
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="mt-3 grid grid-cols-3 gap-2 sm:gap-3"
    >
      {APP_THEMES.map((option) => {
        const active = theme === option;
        const swatch = PREVIEW[option];
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setTheme(option);
              saveTheme(option);
            }}
            className={cn(
              "group relative flex flex-col items-center gap-2 rounded-xl border p-2 text-center transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50",
              active
                ? "border-gold/70 bg-gold/10"
                : "border-gold/20 hover:border-gold/40",
            )}
          >
            {/* Miniature of the theme: page, gold rule, two text lines. */}
            <span
              aria-hidden
              className="flex h-14 w-full flex-col justify-center gap-1.5 rounded-lg border border-border/60 px-2"
              style={{ background: swatch.page }}
            >
              <span
                className="h-1.5 w-8 rounded-full"
                style={{ background: swatch.gold }}
              />
              <span
                className="h-1 w-full rounded-full opacity-70"
                style={{ background: swatch.ink }}
              />
              <span
                className="h-1 w-2/3 rounded-full opacity-40"
                style={{ background: swatch.ink }}
              />
            </span>

            <span className="flex flex-col leading-tight">
              <span
                className={cn(
                  "flex items-center justify-center gap-1 text-xs font-medium",
                  active ? "text-gold" : "text-ivory",
                )}
              >
                {active ? <Check className="size-3" aria-hidden /> : null}
                {THEME_LABELS[option]}
              </span>
              <span className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {DESCRIPTION[option]}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
