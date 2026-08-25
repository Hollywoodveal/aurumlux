import { openDB, type IDBPDatabase } from "idb";

export type BookFormat = "epub" | "pdf" | "cbz" | "cbr" | "mobi" | "azw3" | "txt";
export type ReadingStatus = "want" | "reading" | "finished";
export type ReadingSession = {
  id: string;
  start: number;
  end: number;
  progressStart: number;
  progressEnd: number;
  chapter: string;
};


export type BookMeta = {
  id: string;
  title: string;
  subtitle?: string;
  author: string;
  tags?: string[];
  genre: string;
  description: string;
  isbn: string;
  publisher: string;
  publishedDate: string;
  language: string;
  pageCount: number;
  format: BookFormat;
  fileSize: number;
  series: string;
  /** Position of this book within its series (1-based); 0 or undefined when unknown. */
  seriesIndex?: number;
  rating: number;
  notes: string;
  locked: string[];
  status: ReadingStatus;
  favorite: boolean;
  progress: number;
  location: string;
  chapter: string;
  addedAt: number;
  lastOpened: number;
  finishedAt: number | null;
  rereadCount: number;
  readingTime: number;
  readDays: number[];
  sessions?: ReadingSession[];
  /** Optional per-book goal: finish-by date (ms) and a daily reading target. */
  goalTargetDate?: number | null;
  goalDailyMinutes?: number;
  /** Per-book follow-along timing offset in ms, set by the calibration step. */
  highlightLeadMs?: number;
  /** Per-book typeface override; falls back to the global reader preference. */
  fontOverride?: string | null;
  /**
   * Cached epub.js locations index (JSON). Restoring it means the percentage is
   * exact the instant a book reopens, instead of after a rebuild.
   */
  locationsIndex?: string;


  hasCover: boolean;
  /** SHA-256 of the imported file, used to spot duplicate imports. */
  fileHash?: string;
  /** User-named collections this book belongs to. */
  collections?: string[];


};

export type Annotation = {
  id: string;
  bookId: string;
  type: "bookmark" | "highlight" | "note";
  color: string;
  text: string;
  note: string;
  location: string;
  label: string;
  createdAt: number;
};

const DB_NAME = "aurum";
const DB_VERSION = 3;

let dbp: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
        if (!db.objectStoreNames.contains("covers")) db.createObjectStore("covers");
        if (!db.objectStoreNames.contains("annotations")) {
          const s = db.createObjectStore("annotations", { keyPath: "id" });
          s.createIndex("bookId", "bookId");
        }
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
        // v2: plain-text index per book, powering library-wide full-text search.
        if (!db.objectStoreNames.contains("texts")) db.createObjectStore("texts");
        // v3: downloaded narration audio, so streaming voices can read offline.
        if (!db.objectStoreNames.contains("voices")) {
          const s = db.createObjectStore("voices", { keyPath: "key" });
          s.createIndex("voice", "voice");
        }
      },
    });
  }
  return dbp;
}

/** One cached narration clip: raw 24kHz PCM for a passage in a given voice. */
export type VoiceClip = {
  key: string;
  voice: string;
  bytes: Blob;
  chars: number;
  createdAt: number;
};

export async function putVoiceClip(clip: VoiceClip) {
  const db = await getDB();
  await db.put("voices", clip);
}

export async function getVoiceClip(key: string): Promise<VoiceClip | undefined> {
  const db = await getDB();
  return (await db.get("voices", key)) as VoiceClip | undefined;
}

export async function listVoiceClips(): Promise<VoiceClip[]> {
  const db = await getDB();
  return (await db.getAll("voices")) as VoiceClip[];
}

export async function deleteVoiceClips(voice: string) {
  const db = await getDB();
  const tx = db.transaction("voices", "readwrite");
  let cursor = await tx.store.index("voice").openCursor(voice);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Remove specific cached narration clips (used to keep the cache under its cap). */
export async function deleteVoiceClipKeys(keys: string[]) {
  if (keys.length === 0) return;
  const db = await getDB();
  const tx = db.transaction("voices", "readwrite");
  for (const key of keys) await tx.store.delete(key);
  await tx.done;
}



/** Sections of a book's plain text, used for full-text search. */
export type TextIndex = {
  bookId: string;
  builtAt: number;
  sections: { label: string; href: string; text: string }[];
};

export async function putTextIndex(idx: TextIndex) {
  const db = await getDB();
  await db.put("texts", idx, idx.bookId);
}

export async function getTextIndex(bookId: string): Promise<TextIndex | undefined> {
  const db = await getDB();
  return (await db.get("texts", bookId)) as TextIndex | undefined;
}

export async function allTextIndexes(): Promise<TextIndex[]> {
  const db = await getDB();
  return (await db.getAll("texts")) as TextIndex[];
}


export async function listBooks(): Promise<BookMeta[]> {
  const db = await getDB();
  return (await db.getAll("books")) as BookMeta[];
}

export async function getBook(id: string): Promise<BookMeta | undefined> {
  const db = await getDB();
  return (await db.get("books", id)) as BookMeta | undefined;
}

export async function putBook(book: BookMeta) {
  const db = await getDB();
  await db.put("books", book);
}

export async function updateBook(id: string, patch: Partial<BookMeta>) {
  const existing = await getBook(id);
  if (!existing) return;
  await putBook({ ...existing, ...patch });
}

export async function deleteBook(id: string) {
  const db = await getDB();
  await db.delete("books", id);
  await db.delete("files", id);
  await db.delete("covers", id);
  await db.delete("texts", id);
  const tx = db.transaction("annotations", "readwrite");
  const idx = tx.store.index("bookId");
  let cursor = await idx.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function putFile(id: string, blob: Blob) {
  const db = await getDB();
  await db.put("files", blob, id);
}

export async function getFile(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  return (await db.get("files", id)) as Blob | undefined;
}

export async function putCover(id: string, blob: Blob) {
  const db = await getDB();
  await db.put("covers", blob, id);
}

export async function getCover(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  return (await db.get("covers", id)) as Blob | undefined;
}

export async function listAnnotations(bookId: string): Promise<Annotation[]> {
  const db = await getDB();
  return (await db.getAllFromIndex("annotations", "bookId", bookId)) as Annotation[];
}

export async function allAnnotations(): Promise<Annotation[]> {
  const db = await getDB();
  return (await db.getAll("annotations")) as Annotation[];
}

export async function putAnnotation(a: Annotation) {
  const db = await getDB();
  await db.put("annotations", a);
}

export async function deleteAnnotation(id: string) {
  const db = await getDB();
  await db.delete("annotations", id);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDB();
  const v = await db.get("settings", key);
  return (v === undefined ? fallback : v) as T;
}

export async function setSetting(key: string, value: unknown) {
  const db = await getDB();
  await db.put("settings", value, key);
}

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
