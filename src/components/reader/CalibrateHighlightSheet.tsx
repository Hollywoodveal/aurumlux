/**
 * Quick follow-along calibration.
 *
 * Lifelike voices give no word timings, so Aurum estimates them from passage
 * length. That estimate drifts a little from book to book (dense punctuation,
 * dialogue, short paragraphs). This sheet narrates a sample from the page you
 * are on and asks you to tap the word you actually hear; the gap between that
 * word and the one Aurum highlighted becomes the book's timing offset, so
 * highlights — and taps on them — land on the right word from then on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { PremiumSpeaker, wordSpans, type WordSpan } from "@/lib/premium-tts";
import { clipCache } from "@/lib/voice-packs";
import { buildInstructions, loadTtsSettings, premiumId } from "@/lib/tts-settings";

const MAX_CHARS = 240;

/** Trim the sample to a few whole sentences so it starts quickly. */
function toSample(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_CHARS) return clean;
  const cut = clean.slice(0, MAX_CHARS);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (stop > 60 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(" "))).trim();
}

export function CalibrateHighlightSheet({
  text,
  lead,
  onSave,
  onClose,
}: {
  /** Plain text of the page being read; the sample is taken from its start. */
  text: string;
  /** Current offset in ms for this book. */
  lead: number;
  onSave: (lead: number) => void;
  onClose: () => void;
}) {
  const sample = useMemo(() => toSample(text), [text]);
  const spans = useMemo(() => wordSpans(sample), [sample]);
  const totalWeight = useMemo(
    () => spans.reduce((sum, s) => sum + s.weight, 0) || 1,
    [spans],
  );

  const [draft, setDraft] = useState(lead);
  const [playing, setPlaying] = useState(false);
  const [spoken, setSpoken] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const speakerRef = useRef<PremiumSpeaker | null>(null);

  const settings = useMemo(() => loadTtsSettings(), []);
  const voice = premiumId(settings.voice);

  const indexOfSpan = useCallback(
    (span: WordSpan | null) =>
      span ? spans.findIndex((s) => s.start === span.start && s.end === span.end) : -1,
    [spans],
  );

  const stop = useCallback(() => {
    speakerRef.current?.cancel();
    speakerRef.current = null;
    setPlaying(false);
    setSpoken(null);
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(async () => {
    if (!voice) {
      setNote("Your device voice reports its own word timings — no calibration needed.");
      return;
    }
    stop();
    setNote(null);
    const speaker = new PremiumSpeaker();
    speakerRef.current = speaker;
    speaker.setLead(draft);
    setPlaying(true);
    const speed = Math.min(4, Math.max(0.25, settings.rate));
    try {
      await speaker.speak(
        sample,
        voice,
        speed,
        buildInstructions(settings),
        clipCache(voice, speed),
        (span) => setSpoken(indexOfSpan(span)),
      );
      setNote("Sample finished. Play it again to check the highlight now follows along.");
    } catch {
      setNote("Could not fetch the sample — check your connection and try again.");
    } finally {
      if (speakerRef.current === speaker) {
        speakerRef.current = null;
        setPlaying(false);
        setSpoken(null);
      }
    }
  }, [draft, indexOfSpan, sample, settings, stop, voice]);

  /** Tap the word you hear: the drift from the highlighted word is the offset. */
  const calibrateTo = useCallback(
    (index: number) => {
      const speaker = speakerRef.current;
      if (!speaker || !playing) {
        setNote("Play the sample first, then tap the word you hear.");
        return;
      }
      const { time, duration } = speaker.position;
      if (!duration) return;
      let before = 0;
      for (let i = 0; i < index; i++) before += spans[i]?.weight ?? 0;
      const expected = (before / totalWeight) * duration;
      const next = Math.round(Math.min(1500, Math.max(-1500, (expected - time) * 1000)));
      setDraft(next);
      speaker.setLead(next);
      setNote(
        next === 0
          ? "Already in step — the highlight matches the narration."
          : `Highlight was ${Math.abs(next)}ms ${next > 0 ? "ahead" : "behind"}. Adjusted.`,
      );
    },
    [playing, spans, totalWeight],
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <button aria-label="Close calibration" onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div className="animate-rise pb-safe px-safe relative max-h-[88svh] w-full overflow-y-auto rounded-t-3xl border-t border-gold/25 bg-card py-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-xl text-gold">Calibrate follow-along</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Play the sample, then tap the word you actually hear.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-11 items-center justify-center">
            <X className="size-5 text-muted-foreground" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {!playing ? (
            <button
              onClick={() => void play()}
              aria-label="Play calibration sample"
              className="flex min-h-11 items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-4 text-xs uppercase tracking-widest text-gold"
            >
              <Play className="size-3.5" /> Play sample
            </button>
          ) : (
            <button
              onClick={stop}
              aria-label="Stop calibration sample"
              className="flex min-h-11 items-center gap-2 rounded-full border border-gold/40 px-4 text-xs uppercase tracking-widest text-gold"
            >
              <Square className="size-3.5" /> Stop
            </button>
          )}
          <span className="text-xs text-muted-foreground">
            Offset <span className="text-gold">{draft > 0 ? `+${draft}` : draft}ms</span>
          </span>
        </div>

        <div
          className="mt-4 rounded-2xl border border-border/70 bg-background/60 p-3 text-[15px] leading-relaxed"
          aria-label="Calibration sample text"
        >
          {spans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Open a page with some text to calibrate against.
            </p>
          ) : (
            spans.map((s, i) => (
              <button
                key={`${s.start}-${i}`}
                onClick={() => calibrateTo(i)}
                aria-label={`Heard ${sample.slice(s.start, s.end)}`}
                className={cn(
                  "mr-1 rounded px-0.5 py-0.5 text-left transition-colors",
                  spoken === i ? "bg-gold/40 text-foreground" : "text-foreground/85",
                )}
              >
                {sample.slice(s.start, s.end)}
              </button>
            ))
          )}
        </div>

        <div className="mt-5">
          <div className="flex justify-between text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <span>Fine tune</span>
            <span className="text-gold">{draft > 0 ? `+${draft}` : draft}ms</span>
          </div>
          <input
            type="range"
            aria-label="Highlight timing offset"
            min={-1500}
            max={1500}
            step={25}
            value={draft}
            onChange={(e) => {
              const next = Number(e.target.value);
              setDraft(next);
              speakerRef.current?.setLead(next);
            }}
            className="mt-2 w-full accent-[oklch(0.82_0.132_87)]"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Negative highlights earlier, positive later.
          </p>
        </div>

        {note ? <p className="mt-4 text-xs text-gold/80">{note}</p> : null}

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => {
              setDraft(0);
              speakerRef.current?.setLead(0);
            }}
            className="min-h-11 flex-1 rounded-xl border border-border text-sm text-muted-foreground"
          >
            Reset
          </button>
          <button
            onClick={() => {
              stop();
              onSave(draft);
            }}
            className="min-h-11 flex-1 rounded-xl border border-gold/50 bg-gold/12 text-sm text-gold"
          >
            Save for this book
          </button>
        </div>
      </div>
    </div>
  );
}
