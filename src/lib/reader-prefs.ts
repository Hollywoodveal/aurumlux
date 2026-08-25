/** Shared reader preferences, used by the EPUB, TXT and comic readers. */

export type ReaderTheme = "light" | "dark" | "sepia";

export type ReaderPrefs = {
  theme: ReaderTheme;
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
  /** Global timing nudge in ms: negative = highlight earlier, positive = later. */
  highlightLead: number;
  /** Tap a word in the page to start narrating from exactly there. */
  tapToRead: boolean;
};

export const DEFAULT_PREFS: ReaderPrefs = {
  theme: "dark",
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
  highlightLead: 0,
  tapToRead: true,
};

/** Highlight colours for the spoken word and its passage at a given intensity. */
export function highlightAlphas(intensity: number) {
  const strength = Math.min(90, Math.max(10, intensity)) / 100;
  return { word: strength, passage: strength * 0.28 };
}


export const DYSLEXIC_FONT = '"Atkinson Hyperlegible", "Verdana", system-ui, sans-serif';

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

export function withPrefDefaults(p: Partial<ReaderPrefs> | undefined | null): ReaderPrefs {
  return { ...DEFAULT_PREFS, ...(p ?? {}) };
}
