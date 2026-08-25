import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CloudDownload,
  Loader2,
  Play,
  Square,
  Trash2,
  X,
  Wifi,
  WifiOff,
} from "lucide-react";
import { PREMIUM_VOICES, PremiumSpeaker } from "@/lib/premium-tts";
import { clipCache, deleteVoicePack, downloadVoicePack } from "@/lib/voice-packs";
import { fmtBytes } from "@/lib/storage";
import { toast } from "sonner";
import {
  EMPHASIS_LABELS,
  PREMIUM_PREFIX,
  buildInstructions,
  premiumId,
  type NarrationEmphasis,
  type TtsSettings,
} from "@/lib/tts-settings";
import { cn } from "@/lib/utils";

const PREVIEW_TEXT =
  "Where every page is treasured. The lamplight fell across the open book, and the evening settled in.";

/**
 * Bottom-sheet voice picker: browse lifelike streaming voices and the device's
 * offline voices, preview any of them, download a voice for offline reading, and
 * tune speed, pitch and emphasis.
 */
export function VoicePickerSheet({
  settings,
  onChange,
  onClose,
  deviceVoices,
  online,
  packs,
  onPacksChange,
}: {
  settings: TtsSettings;
  onChange: (next: TtsSettings) => void;
  onClose: () => void;
  deviceVoices: SpeechSynthesisVoice[];
  online: boolean;
  /** Downloaded narration bytes per lifelike voice id. */
  packs: Record<string, number>;
  onPacksChange: () => void;
}) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const speakerRef = useRef<PremiumSpeaker | null>(null);

  const stopPreview = useCallback(() => {
    speakerRef.current?.cancel();
    speakerRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
    setPreviewing(null);
    setLoading(null);
  }, []);

  useEffect(() => stopPreview, [stopPreview]);

  /** Pre-narrate this voice so it reads aloud with no connection. */
  const download = useCallback(
    async (voice: string) => {
      setError(null);
      setDownloading(voice);
      setProgress("Preparing…");
      try {
        const res = await downloadVoicePack(voice, settings, (done, total) =>
          setProgress(`${done}/${total}`),
        );

        onPacksChange();
        toast.success(
          res.added
            ? `Downloaded ${res.added} passage${res.added === 1 ? "" : "s"} · ${fmtBytes(res.bytes)}`
            : "This voice is already downloaded",
        );
      } catch {
        setError("Download failed — check your connection and try again.");
      }
      setDownloading(null);
      setProgress(null);
    },
    [onPacksChange, settings],
  );

  const removePack = useCallback(
    async (voice: string) => {
      await deleteVoicePack(voice);
      onPacksChange();
      toast.success("Offline narration removed");
    },
    [onPacksChange],
  );


  const preview = useCallback(
    async (voice: string) => {
      stopPreview();
      setError(null);
      const next: TtsSettings = { ...settings, voice };
      const premium = premiumId(voice);
      if (premium) {
        setLoading(voice);
        const speaker = new PremiumSpeaker();
        speakerRef.current = speaker;
        // Unlock in the tap's own task — no awaits before this.
        speaker.primeSync();
        try {
          await speaker.speak(
            PREVIEW_TEXT,
            premium,
            settings.rate,
            buildInstructions(next),
            clipCache(premium, settings.rate),
            () => {
              // First audio has started playing — drop the loading state.
              setLoading((v) => (v === voice ? null : v));
              setPreviewing((v) => (v === voice ? v : voice));
            },
          );



        } catch {
          setError("Couldn't reach the streaming narrator — device voices still work offline.");
        } finally {
          if (speakerRef.current === speaker) {
            speaker.cancel();
            speakerRef.current = null;
            setPreviewing(null);
            setLoading(null);
          }
        }
        return;
      }
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
    [deviceVoices, settings, stopPreview],
  );

  const rows: {
    id: string;
    label: string;
    premium: boolean;
    badge?: string;
    voiceId: string | null;
  }[] = [
    ...PREMIUM_VOICES.map((v) => ({
      id: `${PREMIUM_PREFIX}${v.id}`,
      label: v.label,
      premium: true,
      badge: v.engine === "studio" ? "Studio" : "Lifelike",
      voiceId: v.id,
    })),
    { id: "", label: "Default device voice", premium: false, voiceId: null },
    ...deviceVoices.map((v) => ({
      id: v.voiceURI,
      label: `${v.name} (${v.lang})`,
      premium: false,
      voiceId: null,
    })),
  ];



  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <button
        aria-label="Close voice picker"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
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

        <div className="flex items-center gap-1.5 px-4 pb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          {online ? <Wifi className="size-3 text-gold/70" /> : <WifiOff className="size-3" />}
          {online
            ? "Lifelike voices available · download one to read offline"
            : "Offline — downloaded and device voices only"}
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
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Emphasis
              </span>
              <select
                value={settings.emphasis}
                onChange={(e) =>
                  onChange({ ...settings, emphasis: e.target.value as NarrationEmphasis })
                }
                className="mt-1 w-full rounded-lg border border-gold/25 bg-background/60 px-2 py-2 text-xs text-foreground"
              >
                {Object.entries(EMPHASIS_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error ? <p className="text-[11px] text-muted-foreground">{error}</p> : null}

          <ul className="space-y-1.5">
            {rows.map((row) => {
              const selected = settings.voice === row.id;
              const busy = loading === row.id;
              const playing = previewing === row.id;
              const packBytes = row.voiceId ? (packs[row.voiceId] ?? 0) : 0;
              const disabled = row.premium && !online && !packBytes;
              const isDownloading = !!row.voiceId && downloading === row.voiceId;
              return (
                <li
                  key={row.id || "device-default"}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2",
                    selected ? "border-gold/60 bg-gold/10" : "border-gold/15",
                    disabled && "opacity-40",
                  )}
                >
                  <button
                    onClick={() => onChange({ ...settings, voice: row.id })}
                    disabled={disabled}
                    className="flex min-h-11 flex-1 items-center gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-foreground">{row.label}</span>
                      {packBytes ? (
                        <span className="block text-[9px] uppercase tracking-widest text-gold/70">
                          Offline · {fmtBytes(packBytes)}
                        </span>
                      ) : null}
                    </span>
                    {row.premium ? (
                      <span className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80">
                        {row.badge ?? "Lifelike"}
                      </span>
                    ) : null}

                    {selected ? <Check className="size-4 text-gold" /> : null}
                  </button>

                  {row.voiceId ? (
                    packBytes ? (
                      <button
                        onClick={() => void removePack(row.voiceId!)}
                        aria-label={`Remove offline narration for ${row.label}`}
                        className="flex size-11 items-center justify-center rounded-full border border-gold/20 text-destructive/80"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => void download(row.voiceId!)}
                        disabled={!online || !!downloading}
                        aria-label={`Download ${row.label} for offline reading`}
                        className="flex min-h-11 items-center justify-center gap-1 rounded-full border border-gold/30 px-3 text-[10px] uppercase tracking-widest text-gold disabled:opacity-40"
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            {progress}
                          </>
                        ) : (
                          <CloudDownload className="size-4" />
                        )}
                      </button>
                    )
                  ) : null}

                  <button
                    onClick={() => (playing || busy ? stopPreview() : void preview(row.id))}
                    disabled={disabled}
                    aria-label={playing ? `Stop preview of ${row.label}` : `Preview ${row.label}`}
                    className="flex size-11 items-center justify-center rounded-full border border-gold/30 text-gold"
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : playing ? (
                      <Square className="size-4" />
                    ) : (
                      <Play className="size-4" />
                    )}
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
