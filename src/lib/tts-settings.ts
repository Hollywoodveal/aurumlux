/**
 * Read-aloud voice settings: which voice narrates, and how it sounds.
 * Stored in localStorage so the choice follows the reader across books.
 */

export type NarrationEmphasis = "flat" | "natural" | "expressive" | "dramatic";

export type TtsSettings = {
  /** "premium:<id>" for streamed AI voices, "" for the device default, or a device voiceURI. */
  voice: string;
  /** Speaking rate multiplier, 0.6 – 1.6. */
  rate: number;
  /** Voice pitch, 0.6 – 1.4 (device voices only; nudges AI tone via instructions). */
  pitch: number;
  emphasis: NarrationEmphasis;
};

export const PREMIUM_PREFIX = "premium:";

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  voice: "",
  rate: 1,
  pitch: 1,
  emphasis: "natural",
};

const KEY = "aurum.tts.settings";

export const EMPHASIS_LABELS: Record<NarrationEmphasis, string> = {
  flat: "Flat — even and neutral",
  natural: "Natural — gentle audiobook",
  expressive: "Expressive — lively",
  dramatic: "Dramatic — theatrical",
};

const EMPHASIS_DIRECTION: Record<NarrationEmphasis, string> = {
  flat: "Read evenly and calmly with minimal inflection and steady pacing.",
  natural:
    "Read as a warm audiobook narrator: relaxed pacing, gentle expression, clear diction, natural pauses at punctuation.",
  expressive:
    "Read with lively expression: vary your intonation, lean into key words, and let emotion colour the sentences.",
  dramatic:
    "Read theatrically: strong dynamics, dramatic pauses, vivid character in the voice, as a stage performance.",
};

/** Natural-language steering sent to the streaming narrator. */
export function buildInstructions(s: TtsSettings): string {
  const pitch =
    s.pitch > 1.08
      ? " Use a slightly higher, brighter pitch."
      : s.pitch < 0.92
        ? " Use a slightly lower, deeper pitch."
        : "";
  return `${EMPHASIS_DIRECTION[s.emphasis]}${pitch} This is a passage from a book being read aloud.`;
}

export function isPremium(voice: string) {
  return voice.startsWith(PREMIUM_PREFIX);
}

export function premiumId(voice: string) {
  return isPremium(voice) ? voice.slice(PREMIUM_PREFIX.length) : null;
}

export function loadTtsSettings(): TtsSettings {
  if (typeof window === "undefined") return DEFAULT_TTS_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      // Migrate the earlier voice-only key.
      const legacy = window.localStorage.getItem("aurum.readAloudVoice");
      const voice = legacy && !isPremium(legacy) ? legacy : "";
      return { ...DEFAULT_TTS_SETTINGS, voice };
    }
    const saved = { ...DEFAULT_TTS_SETTINGS, ...(JSON.parse(raw) as Partial<TtsSettings>) };
    // Lifelike/studio voices were removed — fall back to the device voice.
    if (isPremium(saved.voice)) saved.voice = "";
    return saved;
  } catch {
    return DEFAULT_TTS_SETTINGS;
  }
}

export function saveTtsSettings(s: TtsSettings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
