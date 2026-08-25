/**
 * Playback for the lifelike (AI) read-aloud voices.
 *
 * Audio arrives from /api/tts as SSE-wrapped 24kHz PCM. Each passage is
 * assembled into a WAV blob and played through a single long-lived
 * <audio> element, which is what lets narration keep going when the
 * screen locks or the reader switches apps (Web Audio is suspended in the
 * background, media elements are not). The next passage is fetched while
 * the current one plays, so the hand-off stays seamless.
 */

export type PremiumEngine = "studio" | "stream";

export type PremiumVoice = { id: string; label: string; engine: PremiumEngine };

/**
 * Lifelike/studio AI voices have been removed — narration uses the device's
 * built-in voices only. Kept as an empty catalog so the picker and storage
 * screens simply render nothing for them.
 */
export const PREMIUM_VOICES: PremiumVoice[] = [];

export function voiceEngine(id: string): PremiumEngine {
  return id.startsWith("g-") ? "studio" : "stream";
}

const SAMPLE_RATE = 24000;

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Reads the SSE narration stream, handing each PCM chunk to `onChunk`. */
async function readPcmStream(res: Response, onChunk: (bytes: Uint8Array) => void) {
  if (!res.body) throw new Error("No narration stream");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let payload: { type?: string; audio?: string };
      try {
        payload = JSON.parse(raw);
      } catch {
        continue;
      }
      if (payload.type !== "speech.audio.delta" || !payload.audio) continue;
      onChunk(b64ToBytes(payload.audio));
    }
  }
}

/** A narration request that failed, carrying the HTTP status when there was one. */
export class TtsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TtsError";
    this.status = status;
  }
  /** Worth trying again: transient network, rate limit or upstream hiccup. */
  get retriable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** Fetches a whole passage as raw PCM bytes. */
export async function fetchPassagePcm(
  text: string,
  voice: string,
  speed: number,
  instructions?: string,
  signal?: AbortSignal,
): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, speed, instructions }),
      signal: signal ?? null,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new TtsError(0, "Could not reach the narrator");
  }
  if (!res.ok) throw new TtsError(res.status, `TTS failed: ${res.status}`);
  const parts: BlobPart[] = [];
  await readPcmStream(res, (bytes) => parts.push(bytes.slice().buffer as ArrayBuffer));
  if (parts.length === 0) throw new TtsError(502, "Narrator returned no audio");
  return new Blob(parts, { type: "audio/pcm" });
}

/**
 * Drop near-silent audio from the end (and start) of a passage. Studio voices
 * pad each passage with up to a second of room tone, which otherwise turns
 * every sentence boundary into a long pause.
 */
function trimSilence(data: Uint8Array): Uint8Array {
  const samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  const threshold = 380; // ~1% of full scale
  const keep = Math.round(SAMPLE_RATE * 0.06); // leave a short natural breath
  let end = samples.length;
  while (end > 0 && Math.abs(samples[end - 1]!) < threshold) end--;
  let start = 0;
  while (start < end && Math.abs(samples[start]!) < threshold) start++;
  if (end <= start) return data;
  const from = Math.max(0, start - keep) * 2;
  const to = Math.min(samples.length, end + keep) * 2;
  return data.subarray(from, to);
}

/** Wrap raw 24kHz mono PCM in a WAV container so an <audio> element can play it. */
export async function pcmToWav(pcm: Blob): Promise<Blob> {
  if (pcm.type === "audio/wav") return pcm;
  const trimmed = trimSilence(new Uint8Array(await pcm.arrayBuffer()));
  const data = new Uint8Array(trimmed.slice());
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + data.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, data.byteLength, true);
  return new Blob([header, data], { type: "audio/wav" });
}

/** Word boundaries within a passage, weighted by length for timing estimates. */
export type WordSpan = { start: number; end: number; weight: number };

export function wordSpans(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = m[0];
    // Punctuation-heavy tokens carry a little extra time (pauses).
    const pause = /[.,;:!?—]$/.test(word) ? 1.6 : 0;
    spans.push({ start: m.index, end: m.index + word.length, weight: word.length + 1 + pause });
  }
  return spans;
}

/** Callback fired as narration moves word by word through a passage. */
export type WordTicker = (span: WordSpan | null) => void;

type ClipCache = {
  lookup: (text: string) => Promise<Blob | undefined>;
  store: (text: string, blob: Blob) => Promise<void>;
};

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

export class PremiumSpeaker {
  private el: HTMLAudioElement | null = null;
  private url: string | null = null;
  private controller: AbortController | null = null;
  private stopped = false;
  private prefetches = new Map<string, Promise<Blob>>();
  private raf = 0;
  /** Calibration nudge in seconds applied when picking the spoken word. */
  private lead = 0;

  /** The media element driving narration, so callers can wire Media Session UI. */
  get element() {
    return this.el;
  }

  /** Shift word highlighting earlier (negative ms) or later (positive ms). */
  setLead(ms: number) {
    this.lead = (Number.isFinite(ms) ? ms : 0) / 1000;
  }

  /** Playback position and length of the current passage, in seconds. */
  get position() {
    const el = this.el;
    const duration = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    return { time: el?.currentTime ?? 0, duration };
  }


  /**
   * Unlock playback from inside a tap handler. Safari and iOS only allow a
   * media element to start playing if `play()` is called in the same task as
   * the gesture, so this must run synchronously — no awaits before it.
   */
  primeSync() {
    this.stopped = false;
    if (!this.el) {
      const el = document.createElement("audio");
      el.preload = "auto";
      el.setAttribute("playsinline", "");
      el.crossOrigin = "anonymous";
      this.el = el;
    }
    if (!this.el.src) {
      this.el.src = SILENT_WAV;
      void this.el.play().catch(() => {});
    }
  }

  /** Prepare (and unlock) the audio element inside a user gesture. */
  async prime() {
    this.primeSync();
  }


  async pause() {
    this.el?.pause();
  }

  async unpause() {
    await this.el?.play().catch(() => {});
  }

  cancel() {
    this.stopped = true;
    this.controller?.abort();
    this.controller = null;
    this.prefetches.clear();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const el = this.el;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  /** Warm the next passage while the current one is still playing. */
  prefetch(text: string, voice: string, speed: number, instructions?: string, cache?: ClipCache) {
    const key = `${voice}|${speed}|${text}`;
    if (this.prefetches.has(key)) return;
    const p = this.load(text, voice, speed, instructions, cache).catch(() => {
      this.prefetches.delete(key);
      throw new Error("prefetch failed");
    });
    // Swallow rejections so an early failure never becomes an unhandled error.
    void p.catch(() => {});
    this.prefetches.set(key, p);
  }

  private async load(
    text: string,
    voice: string,
    speed: number,
    instructions?: string,
    cache?: ClipCache,
  ): Promise<Blob> {
    if (cache) {
      const hit = await cache.lookup(text).catch(() => undefined);
      if (hit) return pcmToWav(hit);
    }
    this.controller = new AbortController();
    const pcm = await fetchPassagePcm(text, voice, speed, instructions, this.controller.signal);
    if (cache) await cache.store(text, pcm).catch(() => {});
    return pcmToWav(pcm);
  }

  /** Play already-downloaded audio, resolving when it has finished. */
  async playPcm(blob: Blob): Promise<void> {
    await this.prime();
    await this.play(await pcmToWav(blob));
  }

  /**
   * Speak one passage, resolving once its audio has finished playing. When a
   * `cache` is supplied, downloaded audio is reused (so it works offline) and
   * freshly fetched audio is stored for next time. `onWord` fires as narration
   * advances so the reader can follow along.
   */
  async speak(
    text: string,
    voice: string,
    speed: number,
    instructions?: string,
    cache?: ClipCache,
    onWord?: WordTicker,
  ): Promise<void> {
    await this.prime();
    const key = `${voice}|${speed}|${text}`;
    const pending = this.prefetches.get(key);
    this.prefetches.delete(key);
    const blob = pending
      ? await pending.catch(() => this.load(text, voice, speed, instructions, cache))
      : await this.load(text, voice, speed, instructions, cache);
    if (this.stopped) return;
    await this.play(blob, text, onWord);
  }

  private play(blob: Blob, text?: string, onWord?: WordTicker): Promise<void> {
    const el = this.el;
    if (!el || this.stopped) return Promise.resolve();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    el.src = this.url;

    const spans = text && onWord ? wordSpans(text) : [];
    const total = spans.reduce((sum, s) => sum + s.weight, 0) || 1;

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        el.removeEventListener("ended", finish);
        el.removeEventListener("error", finish);
        onWord?.(null);
        resolve();
      };
      el.addEventListener("ended", finish);
      el.addEventListener("error", finish);

      if (spans.length && onWord) {
        let last = -1;
        const tick = () => {
          if (settled || this.stopped) return;
          const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
          if (dur) {
            const frac = Math.min(1, Math.max(0, (el.currentTime + this.lead) / dur));
            let acc = 0;
            let index = spans.length - 1;
            for (let i = 0; i < spans.length; i++) {
              acc += spans[i]!.weight;
              if (frac <= acc / total) {
                index = i;
                break;
              }
            }
            if (index !== last) {
              last = index;
              onWord(spans[index] ?? null);
            }
          }
          this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
      }

      void el.play().catch(() => finish());
    });
  }
}
