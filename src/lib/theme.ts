/**
 * App-wide colour theme.
 *
 * Three modes, all sharing the same gold: the original near-black "dark", a
 * warm sepia "neutral" paper tone in the middle, and a cream "light". The
 * choice lives in localStorage rather than the database because it has to be
 * readable synchronously by the inline boot script in the document head —
 * anything async would let the wrong palette paint first.
 *
 * The palettes themselves are token overrides in styles.css, keyed on the
 * `data-theme` attribute this module writes onto <html>.
 */

export const APP_THEMES = ["light", "neutral", "dark"] as const;

export type AppTheme = (typeof APP_THEMES)[number];

export const DEFAULT_THEME: AppTheme = "dark";

export const STORAGE_KEY = "aurum.theme";

export const THEME_LABELS: Record<AppTheme, string> = {
  light: "Light",
  neutral: "Neutral",
  dark: "Dark",
};

/** Browser UI colour per theme — keep in step with `--background` in styles.css. */
export const THEME_META_COLORS: Record<AppTheme, string> = {
  light: "#f7f3ea",
  neutral: "#e8dfc8",
  dark: "#0b0b0a",
};

export function isAppTheme(value: unknown): value is AppTheme {
  return (
    typeof value === "string" &&
    (APP_THEMES as readonly string[]).includes(value)
  );
}

export function loadTheme(): AppTheme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isAppTheme(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Point the document at a palette. Also toggles the `dark` class, so Tailwind's
 * `dark:` variant keeps working for the handful of shadcn components that use
 * it, and retargets the theme-color meta so the phone's status bar matches.
 */
export function applyTheme(theme: AppTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset["theme"] = theme;
  root.classList.toggle("dark", theme === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_META_COLORS[theme]);
}

/** Fired on the window whenever the theme changes in this tab. */
export const THEME_EVENT = "aurum:themechange";

export function saveTheme(theme: AppTheme): void {
  applyTheme(theme);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing can refuse writes; the theme still applies for this visit.
  }
  window.dispatchEvent(
    new CustomEvent<AppTheme>(THEME_EVENT, { detail: theme }),
  );
}

/**
 * Watch the active theme. Covers this tab (custom event) and other tabs or
 * windows on the same device (`storage`), so a reader open on a second tab
 * repaints when the theme is switched in Settings.
 */
export function subscribeTheme(
  onChange: (theme: AppTheme) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleLocal = (event: Event) => {
    const next = (event as CustomEvent<AppTheme>).detail;
    if (isAppTheme(next)) onChange(next);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    const next = isAppTheme(event.newValue) ? event.newValue : DEFAULT_THEME;
    applyTheme(next);
    onChange(next);
  };

  window.addEventListener(THEME_EVENT, handleLocal);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, handleLocal);
    window.removeEventListener("storage", handleStorage);
  };
}

/**
 * Runs in the document head before first paint, so the saved palette is on
 * <html> before any pixels land and there's no flash of the wrong theme.
 * Stringified into the page, so it must stay dependency-free ES5.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(t!=="light"&&t!=="neutral"&&t!=="dark"){t=${JSON.stringify(
  DEFAULT_THEME,
)};}document.documentElement.setAttribute("data-theme",t);if(t==="dark"){document.documentElement.classList.add("dark");}}catch(e){document.documentElement.setAttribute("data-theme",${JSON.stringify(
  DEFAULT_THEME,
)});}})();`;
