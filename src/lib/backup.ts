import JSZip from "jszip";
import {
  allAnnotations,
  getCover,
  getFile,
  listBooks,
  putAnnotation,
  putBook,
  putCover,
  putFile,
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
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
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
export async function encryptBundle(
  bundle: SyncBundle,
  passphrase: string,
): Promise<string> {
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

export async function decryptBundle(
  payload: string,
  passphrase: string,
): Promise<SyncBundle> {
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

export type FullBackupReport = { books: number; files: number; covers: number };

function isQuota(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.code === 22)
  );
}

/**
 * A complete backup: the library JSON plus every book file and cover, zipped.
 * This is the file to carry to a new phone — restoring it brings the books
 * themselves back, not just their titles. Book files are already compressed
 * formats, so the zip stores rather than re-compresses them.
 */
export async function exportFullBackup(): Promise<Blob> {
  const zip = new JSZip();
  const books = await listBooks();
  const coverTypes: Record<string, string> = {};
  for (const book of books) {
    const file = await getFile(book.id);
    if (file) zip.file(`files/${book.id}.${book.format}`, file);
    if (book.hasCover) {
      const cover = await getCover(book.id);
      if (cover) {
        zip.file(`covers/${book.id}`, cover);
        coverTypes[book.id] = cover.type || "image/jpeg";
      }
    }
  }
  zip.file(
    "library.json",
    JSON.stringify(
      {
        app: "aurum",
        kind: "full-backup",
        version: 2,
        exportedAt: new Date().toISOString(),
        books,
        annotations: await allAnnotations(),
        coverTypes,
      },
      null,
      2,
    ),
  );
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

/** Restore a full backup made by `exportFullBackup`. */
export async function importFullBackup(file: File): Promise<FullBackupReport> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("not-aurum");
  }
  const libEntry = zip.file("library.json");
  if (!libEntry) throw new Error("not-aurum");
  const data = JSON.parse(await libEntry.async("string")) as {
    app?: string;
    books?: BookMeta[];
    annotations?: Annotation[];
    coverTypes?: Record<string, string>;
  };
  if (data.app !== "aurum") throw new Error("not-aurum");

  const entries = Object.keys(zip.files);
  const report: FullBackupReport = { books: 0, files: 0, covers: 0 };
  try {
    for (const meta of data.books ?? []) {
      const filePath = entries.find((p) => p.startsWith(`files/${meta.id}.`));
      let hasFile = false;
      if (filePath) {
        const bytes = await zip.file(filePath)!.async("blob");
        await putFile(meta.id, bytes);
        hasFile = true;
        report.files += 1;
      }
      let hasCover = false;
      const coverEntry = zip.file(`covers/${meta.id}`);
      if (coverEntry) {
        const raw = await coverEntry.async("blob");
        const type = data.coverTypes?.[meta.id] ?? "image/jpeg";
        await putCover(meta.id, new Blob([raw], { type }));
        hasCover = true;
        report.covers += 1;
      }
      await putBook({ ...meta, hasCover });
      if (hasFile) report.books += 1;
    }
    for (const a of data.annotations ?? []) await putAnnotation(a);
  } catch (error) {
    if (isQuota(error)) {
      throw new Error(
        "Your device storage is full, so the backup couldn't be fully restored. Free up some space, then restore it again.",
      );
    }
    throw error;
  }
  return report;
}

export type MergeReport = {
  positions: number;
  added: number;
  annotations: number;
};

/**
 * Merge a bundle from another device: newest reading position wins, unseen books
 * arrive as placeholders (the file itself must be re-imported on this device).
 */
export async function mergeSyncBundle(
  bundle: SyncBundle,
): Promise<MergeReport> {
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
        sessions: incoming.sessions?.length
          ? incoming.sessions
          : (mine.sessions ?? []),
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
