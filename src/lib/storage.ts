import { openDB } from "idb";

export type BookUsage = { id: string; fileBytes: number; coverBytes: number; total: number };
export type StorageReport = {
  usage: number | null;
  quota: number | null;
  percent: number | null;
  booksBytes: number;
  perBook: Record<string, BookUsage>;
};

export function fmtBytes(bytes: number) {
  if (!bytes) return "0 KB";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function sizeMap(store: "files" | "covers") {
  // No version: open whatever the current schema is, so this never blocks upgrades.
  const db = await openDB("aurum");
  const keys = (await db.getAllKeys(store)) as string[];
  const blobs = (await db.getAll(store)) as Blob[];
  const out: Record<string, number> = {};
  keys.forEach((k, i) => {
    out[k] = blobs[i]?.size ?? 0;
  });
  return out;
}


/** Measures on-device usage: browser quota plus per-book file and cover bytes. */
export async function measureStorage(): Promise<StorageReport> {
  const [files, covers] = await Promise.all([sizeMap("files"), sizeMap("covers")]);
  const perBook: Record<string, BookUsage> = {};
  for (const id of new Set([...Object.keys(files), ...Object.keys(covers)])) {
    const fileBytes = files[id] ?? 0;
    const coverBytes = covers[id] ?? 0;
    perBook[id] = { id, fileBytes, coverBytes, total: fileBytes + coverBytes };
  }
  const booksBytes = Object.values(perBook).reduce((n, b) => n + b.total, 0);

  let usage: number | null = null;
  let quota: number | null = null;
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      usage = est.usage ?? null;
      quota = est.quota ?? null;
    } catch {
      /* unsupported */
    }
  }
  const percent = usage !== null && quota ? Math.min(100, (usage / quota) * 100) : null;
  return { usage, quota, percent, booksBytes, perBook };
}

/** Asks the browser to keep this library out of automatic eviction. */
export async function requestPersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
