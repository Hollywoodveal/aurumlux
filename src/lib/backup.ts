import {
  allAnnotations,
  listBooks,
  putAnnotation,
  putBook,
  type Annotation,
  type BookMeta,
} from "./db";

export type SyncBundle = {
  app: "aurum";
  kind: "sync";
  version: 1;
  exportedAt: string;
  books: BookMeta[];
  annotations: Annotation[];
};

const enc = new TextEncoder();
const dec = new TextDecoder();
const MAGIC = "AURUM1";
const ITERATIONS = 210_000;

function b64(bytes: Uint8Array) {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

function unb64(text: string) {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function buildSyncBundle(): Promise<SyncBundle> {
  return {
    app: "aurum",
    kind: "sync",
    version: 1,
    exportedAt: new Date().toISOString(),
    books: await listBooks(),
    annotations: await allAnnotations(),
  };
}

/** Encrypt a sync bundle into a portable, passphrase-protected text payload. */
export async function encryptBundle(bundle: SyncBundle, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      enc.encode(JSON.stringify(bundle)),
    ),
  );
  return [MAGIC, b64(salt), b64(iv), b64(cipher)].join(".");
}

export async function decryptBundle(payload: string, passphrase: string): Promise<SyncBundle> {
  const [magic, salt, iv, cipher] = payload.trim().split(".");
  if (magic !== MAGIC || !salt || !iv || !cipher) throw new Error("not-aurum");
  const key = await deriveKey(passphrase, unb64(salt));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) as unknown as BufferSource },
    key,
    unb64(cipher) as unknown as BufferSource,
  );
  const parsed = JSON.parse(dec.decode(plain)) as SyncBundle;
  if (parsed.app !== "aurum") throw new Error("not-aurum");
  return parsed;
}

export type MergeReport = { positions: number; added: number; annotations: number };

/**
 * Merge a bundle from another device: newest reading position wins, unseen books
 * arrive as placeholders (the file itself must be re-imported on this device).
 */
export async function mergeSyncBundle(bundle: SyncBundle): Promise<MergeReport> {
  const local = new Map((await listBooks()).map((b) => [b.id, b]));
  const report: MergeReport = { positions: 0, added: 0, annotations: 0 };

  for (const incoming of bundle.books ?? []) {
    const mine = local.get(incoming.id);
    if (!mine) {
      await putBook({ ...incoming, hasCover: false });
      report.added += 1;
      continue;
    }
    if ((incoming.lastOpened ?? 0) > (mine.lastOpened ?? 0)) {
      await putBook({
        ...mine,
        progress: incoming.progress,
        location: incoming.location,
        chapter: incoming.chapter,
        lastOpened: incoming.lastOpened,
        status: incoming.status,
        sessions: incoming.sessions?.length ? incoming.sessions : mine.sessions ?? [],
      });
      report.positions += 1;
    }
  }

  const seen = new Set((await allAnnotations()).map((a) => a.id));
  for (const a of bundle.annotations ?? []) {
    if (seen.has(a.id)) continue;
    await putAnnotation(a);
    report.annotations += 1;
  }
  return report;
}
