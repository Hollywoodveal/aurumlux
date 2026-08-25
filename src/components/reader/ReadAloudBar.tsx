import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Moon, Pause, Play, Settings2, Square, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { PremiumSpeaker, TtsError, voiceEngine } from "@/lib/premium-tts";
import { clipCache, listVoicePacks } from "@/lib/voice-packs";
import { VoicePickerSheet } from "@/components/reader/VoicePickerSheet";
import {
  DEFAULT_TTS_SETTINGS,
  buildInstructions,
  loadTtsSettings,
  premiumId,
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
 * Group sentences into passages so streamed narration keeps natural prosody.
 * Studio voices synthesise a whole passage before it can play, so they get
 * shorter chunks — narration then starts in a few seconds instead of ~15.
 */
function toPassages(text: string, maxChars = 420): string[] {
  const passages: string[] = [];
  let current = "";
  for (const s of toSentences(text)) {
    if (current && current.length + s.length + 1 > maxChars) {
      passages.push(current);
      current = "";
    }
    current = current ? `${current} ${s}` : s;
    while (current.length > maxChars) {
      passages.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current) passages.push(current);
  return passages;
}

/** Passage length for a lifelike voice: studio voices buffer, so keep them short. */
function passageSize(voiceId: string) {
  return voiceEngine(voiceId) === "studio" ? 300 : 420;
}

/**
 * Set once the lifelike narrator is unavailable for good (credits used up, or
 * turned off), so later sections start on the device voice instead of stalling
 * on a request that cannot succeed.
 */
let premiumUnavailable = false;

/** Plain-language reason narration handed back to the device voice. */
function failureReason(err: unknown): string {
  const status = err instanceof TtsError ? err.status : 0;
  if (!navigator.onLine)
    return "Offline and past your downloaded narration — continuing with your device voice.";
  if (status === 402)
    return "Lifelike narration credits are used up — continuing with your device voice.";
  if (status === 429) return "The narrator is busy — continuing with your device voice.";
  if (status === 403 || status === 404)
    return "Lifelike narration isn't available — continuing with your device voice.";
  return "Streaming narrator unavailable — continuing with your device voice.";
}



/**
 * Read-aloud control for the readers. Narrates with lifelike streaming voices
 * and falls back to the device's offline voices automatically if the stream
 * fails or the connection drops mid-chapter.
 */
export function ReadAloudBar({
  getSectionText,
  onSectionEnd,
  rate,
  onPassage,
  onWord,
  lead = 0,
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
  /** Follow-along timing offset in ms from reader prefs + book calibration. */
  lead?: number;
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
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  /** True while narration has been demoted to device voices for this session. */
  const [fellBack, setFellBack] = useState(false);
  /** True while a lifelike passage is still being synthesised (no audio yet). */
  const [preparing, setPreparing] = useState(false);

  /** Sleep timer: minutes chosen (0 = off) and seconds left before narration stops. */
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [sleepLeft, setSleepLeft] = useState(0);
  const [sleepOpen, setSleepOpen] = useState(false);

  /** Bytes of downloaded narration per voice, so offline playback is possible. */
  const [packs, setPacks] = useState<Record<string, number>>({});


  const sentencesRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const settingsRef = useRef(settings);
  const activeRef = useRef(false);
  const premiumRef = useRef<PremiumSpeaker | null>(null);
  const fallbackRef = useRef(false);
  const packsRef = useRef(packs);
  const onWordRef = useRef(onWord);
  const onPassageRef = useRef(onPassage);
  const leadRef = useRef(lead);

  onWordRef.current = onWord;
  onPassageRef.current = onPassage;
  leadRef.current = lead;
  settingsRef.current = settings;
  packsRef.current = packs;



  const refreshPacks = useCallback(() => {
    void listVoicePacks()
      .then((list) => setPacks(Object.fromEntries(list.map((p) => [p.voice, p.bytes]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSettings(loadTtsSettings());
    setOnline(navigator.onLine);
    refreshPacks();
  }, [refreshPacks]);


  useEffect(() => {
    if (!speechSupported) return;
    const load = () => setDeviceVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // Keep live narration in step when the calibration offset changes.
  useEffect(() => {
    premiumRef.current?.setLead(lead);
  }, [lead]);

  const applySettings = useCallback((next: TtsSettings) => {
    setSettings(next);
    saveTtsSettings(next);
  }, []);


  const stop = useCallback(() => {
    activeRef.current = false;
    if (speechSupported) window.speechSynthesis.cancel();
    premiumRef.current?.cancel();
    premiumRef.current = null;
    setSpeaking(false);
    setPaused(false);
    setPreparing(false);
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



  /** Whether a lifelike voice should be used right now (streamed, or downloaded). */
  const streamingVoice = useCallback(() => {
    if (fallbackRef.current) return null;
    const id = premiumId(settingsRef.current.voice);
    if (!id) return null;
    // Once the lifelike narrator is out of reach, don't keep trying it.
    if (premiumUnavailable && !packsRef.current[id]) return null;
    // Offline is fine as long as this voice has downloaded narration to fall back on.
    if (!online && !packsRef.current[id]) return null;
    return id;
  }, [online]);


  /** Re-chunk the next section, returning false when narration should end. */
  const loadNextSection = useCallback(
    async (voice: string | null) => {
      const advanced = await onSectionEnd();
      if (!advanced || !activeRef.current) return false;
      const text = await getSectionText();
      sentencesRef.current = text
        ? voice
          ? toPassages(text, passageSize(voice))
          : toSentences(text)
        : [];
      indexRef.current = 0;
      return sentencesRef.current.length > 0;
    },
    [getSectionText, onSectionEnd],
  );


  /** Device-voice narration loop (works fully offline). */
  const speakNextLocal = useCallback(() => {
    if (!activeRef.current || !speechSupported) return;
    if (indexRef.current >= sentencesRef.current.length) {
      void (async () => {
        const ok = await loadNextSection(null);
        if (!ok || !activeRef.current) {
          stop();
          return;
        }
        speakNextLocal();
      })();
      return;
    }
    const sentence = sentencesRef.current[indexRef.current] ?? "";
    indexRef.current += 1;
    if (!sentence.trim()) {
      speakNextLocal();
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
      if (activeRef.current) speakNextLocal();
    };
    utter.onerror = () => {
      if (activeRef.current) speakNextLocal();
    };
    window.speechSynthesis.speak(utter);

  }, [deviceVoices, loadNextSection, stop]);

  /** Switch to offline voices mid-narration and keep reading from here. */
  const fallBackToDevice = useCallback(
    (reason: string) => {
      fallbackRef.current = true;
      setFellBack(true);
      setNotice(reason);
      premiumRef.current?.cancel();
      premiumRef.current = null;
      if (!speechSupported || !activeRef.current) {
        stop();
        return;
      }
      // Re-split the remaining passages into sentences for the device voice.
      const remaining = sentencesRef.current.slice(Math.max(0, indexRef.current - 1)).join(" ");
      sentencesRef.current = toSentences(remaining);
      indexRef.current = 0;
      speakNextLocal();
    },
    [speakNextLocal, stop],
  );

  /** Streaming narration loop: one passage at a time. */
  const runStreaming = useCallback(
    async (voice: string) => {
      const speaker = premiumRef.current;
      if (!speaker) return;
      while (activeRef.current) {
        if (indexRef.current >= sentencesRef.current.length) {
          const ok = await loadNextSection(voice);
          if (!ok) break;
        }
        const passage = sentencesRef.current[indexRef.current] ?? "";
        indexRef.current += 1;
        if (!passage.trim()) continue;
        const speed = Math.min(4, Math.max(0.25, settingsRef.current.rate));
        const instructions = buildInstructions(settingsRef.current);
        // Warm the following passage so playback hands over without a gap.
        const next = sentencesRef.current[indexRef.current];
        if (next?.trim())
          speaker.prefetch(next, voice, speed, instructions, clipCache(voice, speed));
        onPassageRef.current?.(passage);
        let failure: unknown = null;
        // One quiet retry for transient failures (a dropped stream, a busy
        // narrator) before giving up on the lifelike voice for this session.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            setPreparing(true);
            await speaker.speak(
              passage,
              voice,
              speed,
              instructions,
              clipCache(voice, speed),
              (span) => {
                setPreparing(false);
                onWordRef.current?.(span);
              },
            );
            setPreparing(false);
            failure = null;
            break;
          } catch (err) {
            setPreparing(false);
            failure = err;
            if (!activeRef.current) return;
            const retriable = !(err instanceof TtsError) || err.retriable;
            if (!retriable || attempt === 1) break;
            await new Promise((r) => setTimeout(r, 700));
            if (!activeRef.current) return;
          }
        }
        if (failure) {
          const status = failure instanceof TtsError ? failure.status : 0;
          if (status === 402 || status === 403 || status === 404) premiumUnavailable = true;
          if (!activeRef.current) return;
          fallBackToDevice(failureReason(failure));
          return;
        }




      }
      if (activeRef.current) stop();
    },
    [fallBackToDevice, loadNextSection, stop],
  );

  const start = useCallback(async (offsetChars = 0) => {
    setNotice(null);
    fallbackRef.current = false;
    setFellBack(false);
    activeRef.current = true;
    setSpeaking(true);
    setPaused(false);
    const voice = streamingVoice();
    const full = await getSectionText();
    const text = full && offsetChars > 0 ? full.slice(offsetChars) : full;
    sentencesRef.current = text
      ? voice
        ? toPassages(text, passageSize(voice))
        : toSentences(text)
      : [];
    indexRef.current = 0;
    if (voice) {
      // The speaker was already created and unlocked in the tap handler; reuse
      // it so Safari keeps letting us play audio.
      const speaker = premiumRef.current ?? new PremiumSpeaker();
      speaker.setLead(leadRef.current);
      premiumRef.current = speaker;
      speaker.primeSync();
      void runStreaming(voice);
      return;
    }

    if (premiumId(settingsRef.current.voice) && !navigator.onLine) {
      fallbackRef.current = true;
      setFellBack(true);
      setNotice("Offline — reading with your device voice.");
    }
    speakNextLocal();
  }, [getSectionText, runStreaming, speakNextLocal, streamingVoice]);

  /**
   * Expose narration controls: tapping a word in the page stops any current
   * narration, unlocks audio inside the same gesture, and reads from there.
   */
  useEffect(() => {
    if (!controls) return;
    controls.current = {
      startFrom: (offsetChars: number) => {
        stop();
        if (premiumId(settingsRef.current.voice) && navigator.onLine) {
          const speaker = new PremiumSpeaker();
          premiumRef.current = speaker;
          speaker.setLead(leadRef.current);
          speaker.primeSync();
        }
        void start(Math.max(0, offsetChars));
      },
    };
    return () => {
      controls.current = null;
    };
  }, [controls, start, stop]);

  const togglePause = useCallback(() => {
    if (premiumRef.current && !fallbackRef.current) {
      if (paused) void premiumRef.current.unpause();
      else void premiumRef.current.pause();
      setPaused(!paused);
      return;
    }
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
      premiumRef.current?.cancel();
      if (speechSupported) window.speechSynthesis.cancel();
    };
    window.addEventListener("pagehide", teardown);
    return () => {
      window.removeEventListener("pagehide", teardown);
      teardown();
    };
  }, []);

  const usingStreaming = !!premiumId(settings.voice) && !fellBack && online;

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
        {usingStreaming ? <Sparkles className="size-3" /> : <Settings2 className="size-3" />}
        Voice
      </button>

      {!speaking ? (
        <button
          onClick={() => {
            // Unlock audio synchronously inside the tap: Safari/iOS refuse to
            // start playback if play() happens after an await.
            if (premiumId(settings.voice) && online && !fellBack) {
              const speaker = premiumRef.current ?? new PremiumSpeaker();
              premiumRef.current = speaker;
              speaker.primeSync();
            }
            void start();
          }}
          aria-label="Start read-aloud"
          className="flex size-11 items-center justify-center rounded-full border border-gold/30 text-gold"
        >
          <Play className="size-4" />
        </button>
      ) : (
        <>
          {preparing ? (
            <span
              role="status"
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 text-[10px] uppercase tracking-widest text-gold/80"
            >
              <Loader2 className="size-3 animate-spin" />
              Preparing
            </span>
          ) : null}

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
          aria-label={sleepMinutes ? `Sleep timer, ${Math.ceil(sleepLeft / 60)} minutes left` : "Set sleep timer"}
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
        <span
          role="status"
          className="max-w-[150px] text-[10px] leading-tight text-muted-foreground"
        >
          {notice}
        </span>
      ) : null}

      {picker ? (
        <VoicePickerSheet
          settings={settings}
          onChange={applySettings}
          onClose={() => {
            setPicker(false);
            refreshPacks();
          }}
          deviceVoices={deviceVoices}
          online={online}
          packs={packs}
          onPacksChange={refreshPacks}
        />
      ) : null}

    </div>
  );
}
