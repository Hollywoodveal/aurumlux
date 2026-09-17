/**
 * Read-aloud voice settings: which of the device's voices narrates, and how it
 * sounds. Stored in localStorage so the choice follows the reader across books.
 */

export type TtsSettings = {
  /** A device voiceURI, or "" for the device default. */
  voice: string;
  /** Speaking rate multiplier, 0.6 – 1.6. */
  rate: number;
  /** Voice pitch, 0.6 – 1.4. */
  pitch: number;
};

/** Prefix used by the removed cloud voices; kept only to migrate old choices. */
const LEGACY_PREMIUM_PREFIX = "premium:";

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  voice: "",
  rate: 1,
  pitch: 1,
};

const KEY = "aurum.tts.settings";

function isLegacyCloudVoice(voice: string) {
  return voice.startsWith(LEGACY_PREMIUM_PREFIX);
}

export function loadTtsSettings(): TtsSettings {
  if (typeof window === "undefined") return DEFAULT_TTS_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      // Migrate the earlier voice-only key.
      const legacy = window.localStorage.getItem("aurum.readAloudVoice");
      const voice = legacy && !isLegacyCloudVoice(legacy) ? legacy : "";
      return { ...DEFAULT_TTS_SETTINGS, voice };
    }
    const saved = { ...DEFAULT_TTS_SETTINGS, ...(JSON.parse(raw) as Partial<TtsSettings>) };
    // Cloud voices were removed — fall back to the device voice.
    if (isLegacyCloudVoice(saved.voice)) saved.voice = "";
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
