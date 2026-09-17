import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Moon, Pause, Play, Settings2, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { VoicePickerSheet } from "@/components/reader/VoicePickerSheet";
import {
  DEFAULT_TTS_SETTINGS,
  loadTtsSettings,
  saveTtsSettings,
  type TtsSettings,
} from "@/lib/tts-settings";

/** Imperative handle so the reader can start narration from a tapped word. */
export type ReadAloudControls = {
  /** Begin narrating the current section from a character offset. Call inside a tap handler. */
  startFrom: (offsetChars: number) => void;
};

export const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;

/** Split plain text into speakable sentence chunks. */
function toSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Read-aloud control for the readers. Narration uses the device's built-in
 * speech voices, so it works fully offline.
 */
export function ReadAloudBar({
  getSectionText,
  onSectionEnd,
  rate,
  onPassage,
  onWord,
  mediaTitle,
  mediaArtist,
  controls,
}: {
  /** Returns the plain text of the currently visible section, or null. */
  getSectionText: () => Promise<string | null>;
  /** Called when the current section has finished speaking; should advance and return whether it succeeded. */
  onSectionEnd: () => Promise<boolean>;
  /** Reader-level speech rate, used until the listener picks their own. */
  rate: number;
  /** Fires with each passage as it begins (null when narration stops). */
  onPassage?: ((passage: string | null) => void) | undefined;
  /** Fires with the character range of the word being spoken inside the passage. */
  onWord?: ((span: { start: number; end: number } | null) => void) | undefined;
  /** Shown on the lock screen / notification while narrating. */
  mediaTitle?: string;
  mediaArtist?: string;
  /** Filled with narration controls so the reader can start from a tapped word. */
  controls?: React.MutableRefObject<ReadAloudControls | null>;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [picker, setPicker] = useState(false);
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [settings, setSettings] = useState<TtsSettings>({ ...DEFAULT_TTS_SETTINGS, rate });
  const [notice, setNotice] = useState<string | null>(null);

  /** Sleep timer: minutes chosen (0 = off) and seconds left before narration stops. */
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [sleepLeft, setSleepLeft] = useState(0);
  const [sleepOpen, setSleepOpen] = useState(false);

  const sentencesRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const settingsRef = useRef(settings);
  const activeRef = useRef(false);
  const onWordRef = useRef(onWord);
  const onPassageRef = useRef(onPassage);

  onWordRef.current = onWord;
  onPassageRef.current = onPassage;
  settingsRef.current = settings;

  useEffect(() => {
    setSettings(loadTtsSettings());
  }, []);

  useEffect(() => {
    if (!speechSupported) return;
    const load = () => setDeviceVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const applySettings = useCallback((next: TtsSettings) => {
    setSettings(next);
    saveTtsSettings(next);
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (speechSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
    sentencesRef.current = [];
    indexRef.current = 0;
    setSleepMinutes(0);
    setSleepLeft(0);
    onWordRef.current?.(null);
    onPassageRef.current?.(null);
  }, []);

  // Sleep timer countdown: stops narration when it runs out.
  useEffect(() => {
    if (!speaking || sleepLeft <= 0) return;
    const id = window.setInterval(() => {
      setSleepLeft((left) => {
        if (left <= 1) {
          stop();
          setNotice("Sleep timer finished — narration stopped.");
          return 0;
        }
        return left - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [speaking, sleepLeft, stop]);

  const setSleep = useCallback((minutes: number) => {
    setSleepMinutes(minutes);
    setSleepLeft(minutes * 60);
    setSleepOpen(false);
  }, []);

  /** Re-chunk the next section, returning false when narration should end. */
  const loadNextSection = useCallback(async () => {
    const advanced = await onSectionEnd();
    if (!advanced || !activeRef.current) return false;
    const text = await getSectionText();
    sentencesRef.current = text ? toSentences(text) : [];
    indexRef.current = 0;
    return sentencesRef.current.length > 0;
  }, [getSectionText, onSectionEnd]);

  /** Device-voice narration loop (works fully offline). */
  const speakNext = useCallback(() => {
    if (!activeRef.current || !speechSupported) return;
    if (indexRef.current >= sentencesRef.current.length) {
      void (async () => {
        const ok = await loadNextSection();
        if (!ok || !activeRef.current) {
          stop();
          return;
        }
        speakNext();
      })();
      return;
    }
    const sentence = sentencesRef.current[indexRef.current] ?? "";
    indexRef.current += 1;
    if (!sentence.trim()) {
      speakNext();
      return;
    }
    const utter = new SpeechSynthesisUtterance(sentence);
    const s = settingsRef.current;
    utter.rate = Math.min(2, Math.max(0.5, s.rate));
    utter.pitch = Math.min(2, Math.max(0, s.pitch));
    const voice = deviceVoices.find((v) => v.voiceURI === s.voice);
    if (voice) utter.voice = voice;
    onPassageRef.current?.(sentence);
    utter.onboundary = (e) => {
      if (!onWordRef.current || e.name === "sentence") return;
      const rest = sentence.slice(e.charIndex);
      const len = e.charLength || (rest.match(/^\S+/)?.[0].length ?? 0);
      if (len > 0) onWordRef.current({ start: e.charIndex, end: e.charIndex + len });
    };
    utter.onend = () => {
      if (activeRef.current) speakNext();
    };
    utter.onerror = () => {
      if (activeRef.current) speakNext();
    };
    window.speechSynthesis.speak(utter);
  }, [deviceVoices, loadNextSection, stop]);

  const start = useCallback(
    async (offsetChars = 0) => {
      setNotice(null);
      activeRef.current = true;
      setSpeaking(true);
      setPaused(false);
      const full = await getSectionText();
      const text = full && offsetChars > 0 ? full.slice(offsetChars) : full;
      sentencesRef.current = text ? toSentences(text) : [];
      indexRef.current = 0;
      speakNext();
    },
    [getSectionText, speakNext],
  );

  /**
   * Expose narration controls: tapping a word in the page stops any current
   * narration and reads from there.
   */
  useEffect(() => {
    if (!controls) return;
    controls.current = {
      startFrom: (offsetChars: number) => {
        stop();
        void start(Math.max(0, offsetChars));
      },
    };
    return () => {
      controls.current = null;
    };
  }, [controls, start, stop]);

  const togglePause = useCallback(() => {
    if (!speechSupported) return;
    if (paused) {
      window.speechSynthesis.resume();
      setPaused(false);
    } else {
      window.speechSynthesis.pause();
      setPaused(true);
    }
  }, [paused]);

  /**
   * Lock-screen / notification controls, so listening continues (and stays
   * controllable) while Aurum is in the background or the phone is asleep.
   */
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms) return;
    if (!speaking) {
      ms.playbackState = "none";
      return;
    }
    try {
      ms.metadata = new MediaMetadata({
        title: mediaTitle || "Reading aloud",
        artist: mediaArtist || "Aurum",
        album: "Aurum",
      });
    } catch {
      /* metadata unsupported */
    }
    ms.playbackState = paused ? "paused" : "playing";
    const safe = (action: MediaSessionAction, handler: () => void) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action unsupported on this platform */
      }
    };
    safe("play", () => {
      if (paused) togglePause();
    });
    safe("pause", () => {
      if (!paused) togglePause();
    });
    safe("stop", stop);
    return () => {
      for (const a of ["play", "pause", "stop"] as MediaSessionAction[]) safe(a, () => {});
    };
  }, [speaking, paused, togglePause, stop, mediaTitle, mediaArtist]);

  useEffect(() => {
    const teardown = () => {
      activeRef.current = false;
      if (speechSupported) window.speechSynthesis.cancel();
    };
    window.addEventListener("pagehide", teardown);
    return () => {
      window.removeEventListener("pagehide", teardown);
      teardown();
    };
  }, []);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => {
          if (speaking) stop();
          setPicker(true);
        }}
        aria-label="Choose narration voice"
        className="flex min-h-11 items-center gap-1.5 rounded-full border border-gold/25 bg-secondary/50 px-3 text-[10px] uppercase tracking-widest text-gold/80"
      >
        <Settings2 className="size-3" />
        Voice
      </button>

      {!speaking ? (
        <button
          onClick={() => void start()}
          aria-label="Start read-aloud"
          className="flex size-11 items-center justify-center rounded-full border border-gold/30 text-gold"
        >
          <Play className="size-4" />
        </button>
      ) : (
        <>
          <button
            onClick={togglePause}
            aria-label={paused ? "Resume read-aloud" : "Pause read-aloud"}
            className="flex size-11 items-center justify-center rounded-full border border-gold/30 text-gold"
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </button>
          <button
            onClick={stop}
            aria-label="Stop read-aloud"
            className={cn(
              "flex size-11 items-center justify-center rounded-full border border-gold/30 text-gold",
            )}
          >
            <Square className="size-4" />
          </button>
        </>
      )}

      <div className="relative">
        <button
          onClick={() => setSleepOpen((v) => !v)}
          aria-label={
            sleepMinutes ? `Sleep timer, ${Math.ceil(sleepLeft / 60)} minutes left` : "Set sleep timer"
          }
          className={cn(
            "flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[10px] uppercase tracking-widest",
            sleepMinutes ? "border-gold/60 bg-gold/12 text-gold" : "border-gold/25 text-gold/70",
          )}
        >
          <Moon className="size-3" />
          {sleepMinutes && sleepLeft > 0 ? `${Math.ceil(sleepLeft / 60)}m` : "Sleep"}
        </button>
        {sleepOpen ? (
          <div className="absolute bottom-12 right-0 z-50 w-40 overflow-hidden rounded-xl border border-gold/25 bg-popover shadow-lux">
            {[0, 10, 15, 30, 45, 60].map((m) => (
              <button
                key={m}
                onClick={() => setSleep(m)}
                className={cn(
                  "block w-full px-4 py-2.5 text-left text-sm",
                  sleepMinutes === m ? "bg-gold/10 text-gold" : "text-foreground",
                )}
              >
                {m === 0 ? "Off" : `${m} minutes`}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {notice ? (
        <span role="status" className="max-w-[150px] text-[10px] leading-tight text-muted-foreground">
          {notice}
        </span>
      ) : null}

      {picker ? (
        <VoicePickerSheet
          settings={settings}
          onChange={applySettings}
          onClose={() => setPicker(false)}
          deviceVoices={deviceVoices}
        />
      ) : null}
    </div>
  );
}
