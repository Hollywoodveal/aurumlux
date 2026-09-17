import { useCallback, useEffect, useState } from "react";
import { Check, Play, Square, X } from "lucide-react";
import { type TtsSettings } from "@/lib/tts-settings";
import { cn } from "@/lib/utils";

const PREVIEW_TEXT =
  "Where every page is treasured. The lamplight fell across the open book, and the evening settled in.";

/**
 * Bottom-sheet voice picker: browse the device's built-in narration voices,
 * preview any of them, and tune speed and pitch. Works fully offline.
 */
export function VoicePickerSheet({
  settings,
  onChange,
  onClose,
  deviceVoices,
}: {
  settings: TtsSettings;
  onChange: (next: TtsSettings) => void;
  onClose: () => void;
  deviceVoices: SpeechSynthesisVoice[];
}) {
  const [previewing, setPreviewing] = useState<string | null>(null);

  const stopPreview = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
    setPreviewing(null);
  }, []);

  useEffect(() => stopPreview, [stopPreview]);

  const preview = useCallback(
    (voice: string) => {
      stopPreview();
      if (!("speechSynthesis" in window)) return;
      const utter = new SpeechSynthesisUtterance(PREVIEW_TEXT);
      utter.rate = settings.rate;
      utter.pitch = settings.pitch;
      const v = deviceVoices.find((d) => d.voiceURI === voice);
      if (v) utter.voice = v;
      utter.onend = () => setPreviewing(null);
      utter.onerror = () => setPreviewing(null);
      setPreviewing(voice);
      window.speechSynthesis.speak(utter);
    },
    [deviceVoices, settings.pitch, settings.rate, stopPreview],
  );

  const rows: { id: string; label: string }[] = [
    { id: "", label: "Default device voice" },
    ...deviceVoices.map((v) => ({ id: v.voiceURI, label: `${v.name} (${v.lang})` })),
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <button
        aria-label="Close voice picker"
        onClick={onClose}
        className="absolute inset-0 bg-scrim"
      />
      <div className="pb-safe px-safe relative w-full max-h-[88svh] overflow-y-auto rounded-t-2xl border-t border-gold/25 bg-card">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-display text-lg text-gradient-gold">Narration voice</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 items-center justify-center text-gold/80"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-4 pb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          Your device's voices · available offline
        </div>

        <div className="space-y-4 px-4 pb-6">
          <div className="space-y-3 rounded-xl border border-gold/15 bg-secondary/30 p-3">
            <Slider
              label="Speed"
              value={settings.rate}
              min={0.6}
              max={1.6}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(rate) => onChange({ ...settings, rate })}
            />
            <Slider
              label="Pitch"
              value={settings.pitch}
              min={0.6}
              max={1.4}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(pitch) => onChange({ ...settings, pitch })}
            />
          </div>

          <ul className="space-y-1.5">
            {rows.map((row) => {
              const selected = settings.voice === row.id;
              const playing = previewing === row.id;
              return (
                <li
                  key={row.id || "device-default"}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2",
                    selected ? "border-gold/60 bg-gold/10" : "border-gold/15",
                  )}
                >
                  <button
                    onClick={() => onChange({ ...settings, voice: row.id })}
                    className="flex min-h-11 flex-1 items-center gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-foreground">{row.label}</span>
                    </span>
                    {selected ? <Check className="size-4 text-gold" /> : null}
                  </button>

                  <button
                    onClick={() => (playing ? stopPreview() : preview(row.id))}
                    aria-label={playing ? `Stop preview of ${row.label}` : `Preview ${row.label}`}
                    className="flex size-11 items-center justify-center rounded-full border border-gold/30 text-gold"
                  >
                    {playing ? <Square className="size-4" /> : <Play className="size-4" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
        <span className="text-gold/80">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="mt-1 h-6 w-full accent-[color:var(--gold,#c9a227)]"
      />
    </label>
  );
}
