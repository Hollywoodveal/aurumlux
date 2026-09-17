/** Shared reader preferences, used by the EPUB, TXT and comic readers. */

import type { AppTheme } from "@/lib/theme";

/** The concrete page colours a reader can render. */
export type ReaderTheme = "light" | "dark" | "sepia";

/**
 * What the reader's theme control is set to. `"auto"` — the default — defers to
 * the app-wide theme, so choosing Light in Settings lightens the reader too; the
 * concrete values are an explicit override for one book's reading session.
 */
export type ReaderThemeChoice = ReaderTheme | "auto";

/** Which page colour each app theme implies. Neutral is the reader's sepia. */
const APP_THEME_TO_READER: Record<AppTheme, ReaderTheme> = {
  light: "light",
  neutral: "sepia",
  dark: "dark",
};

/** Collapse a possibly-`"auto"` choice into the page colour to actually paint. */
export function resolveReaderTheme(
  choice: ReaderThemeChoice,
  appTheme: AppTheme,
): ReaderTheme {
  return choice === "auto" ? APP_THEME_TO_READER[appTheme] : choice;
}

export type ReaderPrefs = {
  theme: ReaderThemeChoice;
  fontSize: number;
  lineHeight: number;
  margin: number;
  fontFamily: string;
  /** Screen dimming overlay, 0 = none, 60 = heavily dimmed. */
  brightness: number;
  /** Amber "warmth" overlay for night reading, 0 = none, 60 = very warm. */
  warmth: number;
  /** Page transition style for paginated reading. */
  pageAnim: "none" | "slide" | "fade";
  /** Dyslexia-friendly typeface + wider tracking, overrides fontFamily. */
  dyslexic: boolean;
  /** Text-to-speech rate multiplier. */
  speechRate: number;
  /** Glow the word being narrated (and tint its passage). */
  highlightWords: boolean;
  /** Strength of the follow-along glow, 10 = whisper-faint, 90 = bold. */
  highlightIntensity: number;
  /** Tap a word in the page to start narrating from exactly there. */
  tapToRead: boolean;
};

export const DEFAULT_PREFS: ReaderPrefs = {
  theme: "auto",
  fontSize: 105,
  lineHeight: 1.6,
  margin: 20,
  fontFamily: "Georgia, serif",
  brightness: 0,
  warmth: 0,
  pageAnim: "slide",
  dyslexic: false,
  speechRate: 1,
  highlightWords: true,
  highlightIntensity: 42,
  tapToRead: true,
};

/** Highlight colours for the spoken word and its passage at a given intensity. */
export function highlightAlphas(intensity: number) {
  const strength = Math.min(90, Math.max(10, intensity)) / 100;
  return { word: strength, passage: strength * 0.28 };
}

export const DYSLEXIC_FONT =
  '"Atkinson Hyperlegible", "Verdana", system-ui, sans-serif';

export const READER_FONTS = [
  { label: "Serif", value: "Georgia, serif" },
  { label: "Sans", value: "Jost, system-ui, sans-serif" },
  { label: "Garamond", value: '"Cormorant Garamond", Georgia, serif' },
  { label: "Mono", value: "ui-monospace, monospace" },
  { label: "Readable", value: DYSLEXIC_FONT },
];

export const THEME_COLORS: Record<ReaderTheme, { bg: string; fg: string }> = {
  light: { bg: "#faf8f4", fg: "#1b1b1b" },
  dark: { bg: "#0f0f0e", fg: "#e8e4dc" },
  sepia: { bg: "#f4ecd8", fg: "#4a3c2c" },
};

/** Resolve the typeface for a book, honouring accessibility + per-book override. */
export function resolveFont(prefs: ReaderPrefs, fontOverride?: string | null) {
  if (prefs.dyslexic) return DYSLEXIC_FONT;
  return fontOverride || prefs.fontFamily;
}

export function withPrefDefaults(
  p: Partial<ReaderPrefs> | undefined | null,
): ReaderPrefs {
  return { ...DEFAULT_PREFS, ...(p ?? {}) };
}
