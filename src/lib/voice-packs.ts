/**
 * Offline voice packs.
 *
 * The lifelike narrators are generated in the cloud, so Aurum keeps their audio
 * on the device once it has been heard or downloaded. Downloading a voice
 * narrates the opening of the books you are reading ahead of time and stores the
 * raw audio in IndexedDB, so that narration plays with no connection at all.
 * Anything narrated later while online is added to the same pack automatically.
 */

import { fetchPassagePcm } from "./premium-tts";
import {
  allTextIndexes,
  deleteVoiceClipKeys,
  deleteVoiceClips,
  getVoiceClip,
  listBooks,
  listVoiceClips,
  putVoiceClip,
} from "./db";
import { buildInstructions, type TtsSettings } from "./tts-settings";

/** 24kHz mono 16-bit PCM: 48000 bytes per second of narration. */
const BYTES_PER_SECOND = 48000;
/** How many passages a download covers per book. */
const PASSAGES_PER_BOOK = 12;
/** Upper bound on a single download, to stay friendly to device storage. */
const MAX_PASSAGES = 36;
/** Ceiling for automatically cached narration (~120 minutes of audio). */
export const CACHE_CAP_BYTES = 350 * 1024 * 1024;

export const SAMPLE_PASSAGE =
  "Where every page is treasured. The lamplight fell across the open book, and the evening settled in.";

export type VoicePack = { voice: string; clips: number; bytes: number; seconds: number };

function hash(input: string) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Stable cache key for one passage in one voice at one speed. */
export function clipKey(voice: string, text: string, speed: number) {
  return `${voice}:${speed.toFixed(2)}:${hash(text.trim())}`;
}

let pruning: Promise<void> | null = null;

/**
 * Keeps stored narration under the cap by dropping the oldest clips first, so
 * a long listening session can never quietly fill up the device.
 */
export async function pruneClipCache(cap = CACHE_CAP_BYTES): Promise<number> {
  const clips = await listVoiceClips();
  let total = clips.reduce((n, c) => n + c.bytes.size, 0);
  if (total <= cap) return 0;
  const oldestFirst = [...clips].sort((a, b) => a.createdAt - b.createdAt);
  const doomed: string[] = [];
  let freed = 0;
  for (const clip of oldestFirst) {
    if (total <= cap * 0.9) break;
    doomed.push(clip.key);
    total -= clip.bytes.size;
    freed += clip.bytes.size;
  }
  await deleteVoiceClipKeys(doomed);
  return freed;
}

function schedulePrune() {
  if (pruning) return;
  pruning = pruneClipCache()
    .catch(() => 0)
    .then(() => {
      pruning = null;
    });
}

/** Cache accessors handed to PremiumSpeaker so narration reuses stored audio. */
export function clipCache(voice: string, speed: number) {
  return {
    lookup: async (text: string) => (await getVoiceClip(clipKey(voice, text, speed)))?.bytes,
    store: async (text: string, bytes: Blob) => {
      await putVoiceClip({
        key: clipKey(voice, text, speed),
        voice,
        bytes,
        chars: text.length,
        createdAt: Date.now(),
      });
      schedulePrune();
    },
  };
}


export async function listVoicePacks(): Promise<VoicePack[]> {
  const clips = await listVoiceClips();
  const map = new Map<string, VoicePack>();
  for (const c of clips) {
    const pack = map.get(c.voice) ?? { voice: c.voice, clips: 0, bytes: 0, seconds: 0 };
    pack.clips += 1;
    pack.bytes += c.bytes.size;
    pack.seconds = pack.bytes / BYTES_PER_SECOND;
    map.set(c.voice, pack);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}

export async function deleteVoicePack(voice: string) {
  await deleteVoiceClips(voice);
}

export async function deleteAllVoicePacks() {
  for (const pack of await listVoicePacks()) await deleteVoiceClips(pack.voice);
}

/** Split text into passage-sized chunks at sentence boundaries. */
function toPassages(text: string, maxChars = 420): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let current = "";
  for (const s of sentences) {
    if (!s.trim()) continue;
    if (current && current.length + s.length + 1 > maxChars) {
      out.push(current);
      current = "";
    }
    current = current ? `${current} ${s}` : s;
    while (current.length > maxChars) {
      out.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Chooses what a download should cover: a sample line plus the opening passages
 * of the books currently being read (falling back to the rest of the library).
 */
export async function planDownload(): Promise<string[]> {
  const passages: string[] = [SAMPLE_PASSAGE];
  try {
    const [books, indexes] = await Promise.all([listBooks(), allTextIndexes()]);
    const rank = new Map(books.map((b) => [b.id, b.status === "reading" ? 0 : 1] as const));
    const ordered = [...indexes].sort(
      (a, b) => (rank.get(a.bookId) ?? 2) - (rank.get(b.bookId) ?? 2),
    );
    for (const idx of ordered) {
      const text = idx.sections.map((s) => s.text).join(" ");
      passages.push(...toPassages(text).slice(0, PASSAGES_PER_BOOK));
      if (passages.length >= MAX_PASSAGES) break;
    }
  } catch {
    /* no index yet — the sample alone still proves the voice works offline */
  }
  return passages.slice(0, MAX_PASSAGES);
}

/** Roughly how much space one download will take. */
export function estimateBytes(passages: string[]) {
  // ~15 characters of prose per second of speech at normal pace.
  return Math.round((passages.join(" ").length / 15) * BYTES_PER_SECOND);
}

/**
 * Downloads a voice for offline use. Passages already stored are skipped, so
 * repeating a download only fetches what is missing.
 */
export async function downloadVoicePack(
  voice: string,
  settings: TtsSettings,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ added: number; bytes: number }> {
  const passages = await planDownload();
  const speed = Math.min(4, Math.max(0.25, settings.rate));
  const instructions = buildInstructions(settings);
  let added = 0;
  let bytes = 0;
  for (let i = 0; i < passages.length; i++) {
    if (signal?.aborted) break;
    const text = passages[i] ?? "";
    onProgress?.(i, passages.length);
    if (!text.trim()) continue;
    const key = clipKey(voice, text, speed);
    if (await getVoiceClip(key)) continue;
    const blob = await fetchPassagePcm(text, voice, speed, instructions, signal);
    await putVoiceClip({ key, voice, bytes: blob, chars: text.length, createdAt: Date.now() });
    added += 1;
    bytes += blob.size;
  }
  onProgress?.(passages.length, passages.length);
  return { added, bytes };
}
