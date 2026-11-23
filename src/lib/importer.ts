import { coverBlob, findEpubCover, mimeForPath } from "./epub-cover";
import { fetchExternal, friendlyHttpError } from "./net";
import type JSZip from "jszip";
import {
  getFile,
  getSetting,
  listBooks,
  putBook,
  putCover,
  putFile,
  setSetting,
  uid,
  updateBook,
  type BookFormat,
  type BookMeta,
} from "./db";
import { requestPersistentStorage } from "./storage";

/** JSZip loads on first use, so it isn't part of the library's first download. */
const loadJSZip = () => import("jszip").then((m) => m.default);

/** True when a write failed because the device is out of storage. */
export function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.code === 22)
  );
}

export const STORAGE_FULL_MESSAGE =
  "Your device storage is full, so this book couldn't be saved. Free up some space, then try importing it again.";

/** SHA-256 of a file's bytes, used as its identity for duplicate detection. */
export async function hashFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Looks for a book already in the library with the same bytes. Falls back to a
 * title + size match for books imported before hashing existed.
 */
/**
 * Look for this file already on the shelf. When the match is a placeholder
 * (a book synced from another device whose file isn't here yet), the file is
 * stored into it and `restored` is true — the book becomes readable with its
 * synced position, notes and history intact.
 */
export async function findDuplicate(
  file: File,
): Promise<{ hash: string; existing: BookMeta | null; restored: boolean }> {
  const hash = await hashFile(file);
  const books = await listBooks();
  const title = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .trim()
    .toLowerCase();
  const existing =
    books.find((b) => b.fileHash === hash) ??
    books.find(
      (b) =>
        !b.fileHash &&
        b.fileSize === file.size &&
        b.title.toLowerCase() === title,
    ) ??
    null;
  if (existing && !(await getFile(existing.id))) {
    await putFile(existing.id, file);
    let hasCover = existing.hasCover;
    if (!hasCover) {
      // Parse into a throwaway record just to store the embedded cover.
      const probe = {
        ...emptyBook(),
        id: existing.id,
        format: existing.format,
      };
      await parseInto(file, probe).catch(() => undefined);
      hasCover = probe.hasCover;
    }
    await updateBook(existing.id, {
      fileHash: hash,
      fileSize: file.size,
      hasCover,
    });
    return { hash, existing, restored: true };
  }
  return { hash, existing, restored: false };
}

/** Read metadata (and the embedded cover, stored under book.id) from a file. */
async function parseInto(file: File, book: BookMeta) {
  const format = book.format;
  if (format === "epub") await parseEpub(file, book);
  else if (format === "pdf") await parsePdf(file, book);
  else if (format === "cbz" || format === "cbr")
    await parseComicArchive(file, book);
  else if (format === "txt") await parseTxt(file, book);
  else book.pageCount = Math.round(file.size / 2200);
}

export function emptyBook(): BookMeta {
  return {
    id: uid(),
    title: "",
    author: "",
    genre: "",
    description: "",
    isbn: "",
    publisher: "",
    publishedDate: "",
    language: "",
    pageCount: 0,
    format: "epub",
    fileSize: 0,
    series: "",
    rating: 0,
    notes: "",
    locked: [],
    status: "want",
    favorite: false,
    progress: 0,
    location: "",
    chapter: "",
    addedAt: Date.now(),
    lastOpened: 0,
    finishedAt: null,
    rereadCount: 0,
    readingTime: 0,
    readDays: [],
    sessions: [],
    hasCover: false,
  };
}

function textOf(doc: Document, tag: string) {
  const el = Array.from(doc.getElementsByTagName("*")).find(
    (n) => n.localName === tag || n.nodeName === `dc:${tag}`,
  );
  return el?.textContent?.trim() ?? "";
}

function allOf(doc: Document, tag: string) {
  return Array.from(doc.getElementsByTagName("*"))
    .filter((n) => n.localName === tag || n.nodeName === `dc:${tag}`)
    .map((n) => n.textContent?.trim() ?? "")
    .filter(Boolean);
}

async function parseEpub(file: File, book: BookMeta) {
  const zip = await (await loadJSZip()).loadAsync(file);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) return;
  const container = new DOMParser().parseFromString(
    await containerFile.async("string"),
    "application/xml",
  );
  const opfPath =
    container.querySelector("rootfile")?.getAttribute("full-path") ?? "";
  const opfFile = zip.file(opfPath);
  if (!opfFile) return;
  const opf = new DOMParser().parseFromString(
    await opfFile.async("string"),
    "application/xml",
  );
  const dir = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
    : "";

  book.title = textOf(opf, "title") || book.title;
  book.author = allOf(opf, "creator").join(", ") || book.author;
  book.genre = allOf(opf, "subject").slice(0, 3).join(", ");
  book.description = (textOf(opf, "description") || "")
    .replace(/<[^>]+>/g, "")
    .trim();
  book.publisher = textOf(opf, "publisher");
  book.language = textOf(opf, "language");
  book.publishedDate = textOf(opf, "date");
  const ids = allOf(opf, "identifier").join(" ");
  const isbnMatch = ids
    .replace(/[-\s]/g, "")
    .match(/(97[89]\d{10}|\d{9}[\dXx])/);
  book.isbn = isbnMatch ? isbnMatch[0] : "";
  const series = Array.from(opf.getElementsByTagName("meta")).find(
    (m) => m.getAttribute("name") === "calibre:series",
  );
  book.series = series?.getAttribute("content") ?? "";

  // Page count: trust publisher metadata, else count the real text in the spine.
  const metas = Array.from(opf.getElementsByTagName("meta"));
  const declaredPages = metas
    .map((m) => {
      const name = (
        m.getAttribute("name") ??
        m.getAttribute("property") ??
        ""
      ).toLowerCase();
      if (
        !/(numberofpages|page-progression-count|calibre:page_count|pages)$/.test(
          name,
        )
      )
        return 0;
      return (
        Math.round(Number(m.getAttribute("content") ?? m.textContent ?? 0)) || 0
      );
    })
    .find((n) => n > 0);

  if (declaredPages) {
    book.pageCount = declaredPages;
  } else {
    const manifestItems = Array.from(opf.getElementsByTagName("item"));
    const spineIds = Array.from(opf.getElementsByTagName("itemref")).map((r) =>
      r.getAttribute("idref"),
    );
    const hrefs = spineIds
      .map(
        (id) =>
          manifestItems
            .find((i) => i.getAttribute("id") === id)
            ?.getAttribute("href") ?? "",
      )
      .filter(Boolean);

    let chars = 0;
    for (const href of hrefs) {
      const path = decodeURIComponent(dir + href).replace(/^\.\//, "");
      const entry = zip.file(path) ?? zip.file(decodeURIComponent(href));
      if (!entry) continue;
      try {
        const html = await entry.async("string");
        chars += html
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;|&#\d+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim().length;
      } catch {
        /* skip unreadable spine item */
      }
    }

    // ~1800 characters of prose per printed page
    book.pageCount = chars
      ? Math.max(1, Math.round(chars / 1800))
      : Math.max(hrefs.length * 12, Math.round(file.size / 2200));
  }

  // cover (see epub-cover.ts for the ways publishers mark it)
  const coverHit = await findEpubCover(zip, opf, dir);
  if (coverHit) {
    await putCover(book.id, await coverBlob(coverHit));
    book.hasCover = true;
  }
}

async function parsePdf(file: File, book: BookMeta) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
    .default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  book.pageCount = doc.numPages;
  const meta = await doc.getMetadata();
  const info = (meta.info ?? {}) as Record<string, string>;
  book.title = info["Title"]?.trim() || book.title;
  book.author = info["Author"]?.trim() || "";
  book.description = info["Subject"]?.trim() || "";
  book.publisher = info["Producer"]?.trim() || "";
  book.genre = info["Keywords"]?.trim() || "";
  book.language = (meta as { lang?: string }).lang ?? "";

  // render page 1 as cover
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.4 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", 0.85),
    );
    if (blob) {
      await putCover(book.id, blob);
      book.hasCover = true;
    }
  }
}

async function parseComicArchive(file: File, book: BookMeta) {
  try {
    const zip = await (await loadJSZip()).loadAsync(file);
    const entries = Object.values(zip.files)
      .filter(
        (f) =>
          !f.dir &&
          /\.(jpe?g|png|gif|webp)$/i.test(f.name) &&
          // macOS adds "__MACOSX/._page.jpg" resource files that aren't images.
          !/(^|\/)(__MACOSX\/|\._)/.test(f.name),
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    if (entries.length === 0) return;
    book.pageCount = entries.length;
    const first = entries[0];
    if (first) {
      await putCover(
        book.id,
        new Blob([await first.async("arraybuffer")], {
          type: mimeForPath(first.name),
        }),
      );
      book.hasCover = true;
    }
  } catch {
    // CBR (RAR) archives can't be parsed by JSZip in the browser. Leave the
    // book importable with a fallback page count; the reader detects the
    // same failure and shows a friendly "convert to CBZ" message.
    book.pageCount = Math.round(file.size / 2200);
  }
}

async function parseTxt(file: File, book: BookMeta) {
  const text = await file.text();
  book.pageCount = Math.max(1, Math.round(text.length / 1800));
}

type Remote = {
  title?: string | undefined;
  subtitle?: string | undefined;
  author?: string | undefined;
  description?: string | undefined;
  genre?: string | undefined;
  publisher?: string | undefined;
  coverUrl?: string | undefined;
  publishedDate?: string | undefined;
};

/** Strip filename noise so providers can actually match the title. */
function cleanTitle(raw: string) {
  return raw
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_.]+/g, " ")
    .replace(/\((?:[^)]*)\)|\[[^\]]*\]/g, " ")
    .replace(
      /\b(epub|pdf|mobi|azw3|retail|ebook|z-lib\w*|libgen|v\d+)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalise provider category strings ("Fiction / Fantasy / Epic") into clean tags. */
function normaliseGenre(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const raw of values) {
    for (const part of String(raw).split(/[/>|;]+/)) {
      const t = part.replace(/\s+/g, " ").trim();
      if (t.length < 2 || t.length > 40) continue;
      const key = t.toLowerCase();
      if (!seen.has(key)) seen.add(key);
      if (seen.size >= 3) break;
    }
    if (seen.size >= 3) break;
  }
  if (!seen.size) return undefined;
  return [...seen]
    .map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(", ");
}

export type RemoteCandidate = Remote & {
  provider: "google" | "openlibrary";
  /** Higher is a better match: 100+ = exact ISBN, 75+ = strong, 40+ = likely. */
  score: number;
  matchLabel: string;
};

type MatchWant = { title: string; author: string; isbn: string };

/** Lowercase alphanumeric tokens for fuzzy comparison. */
function normText(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanIsbn(s: string | undefined): string {
  return (s ?? "").replace(/[-\s]/g, "");
}

/**
 * Score one provider result against the book we are looking for. An exact
 * ISBN wins outright; otherwise title similarity matters most, author second.
 */
function scoreRemote(r: Remote, isbns: string[], want: MatchWant): number {
  let s = 0;
  if (want.isbn && isbns.some((i) => cleanIsbn(i) === want.isbn)) s += 100;
  const t = normText(r.title);
  const wt = normText(want.title);
  if (t && wt) {
    if (t === wt) s += 50;
    else if (t.includes(wt) || wt.includes(t)) s += 25;
  }
  const a = normText(r.author);
  const wa = normText(want.author);
  if (a && wa) {
    if (a === wa) s += 30;
    else {
      const last = (x: string) => x.split(" ").filter(Boolean).pop() ?? "";
      const al = last(a);
      const wl = last(wa);
      if (al.length > 2 && al === wl) s += 15;
    }
  }
  if (r.coverUrl) s += 8;
  if (r.description) s += 4;
  return s;
}

function labelFor(score: number): string {
  if (score >= 100) return "Exact ISBN match";
  if (score >= 75) return "Strong match";
  if (score >= 40) return "Likely match";
  return "Possible match";
}

/** Untyped JSON from Google Books / Open Library; every field is checked before use. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiJson = any;

function googleVolumeToRemote(v: ApiJson): { remote: Remote; isbns: string[] } {
  const ids: ApiJson[] = Array.isArray(v?.industryIdentifiers)
    ? v.industryIdentifiers
    : [];
  return {
    remote: {
      title: v?.title,
      subtitle: v?.subtitle,
      author: Array.isArray(v?.authors) ? v.authors.join(", ") : undefined,
      description: v?.description,
      genre: normaliseGenre(
        (Array.isArray(v?.categories) ? v.categories : []).flatMap(
          (c: string) => String(c).split("/"),
        ),
      ),
      publisher: v?.publisher,
      publishedDate: v?.publishedDate,
      coverUrl: v?.imageLinks?.thumbnail
        ?.replace("http://", "https://")
        ?.replace("zoom=1", "zoom=3"),
    },
    isbns: ids.map((i) => String(i?.identifier ?? "")),
  };
}

async function googleCandidates(
  q: string,
  want: MatchWant,
): Promise<RemoteCandidate[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?maxResults=5&q=${encodeURIComponent(q)}`,
    );
    const json = await res.json();
    const items: ApiJson[] = Array.isArray(json?.items) ? json.items : [];
    return items.map((item) => {
      const { remote, isbns } = googleVolumeToRemote(item?.volumeInfo);
      const score = scoreRemote(remote, isbns, want);
      return {
        ...remote,
        provider: "google" as const,
        score,
        matchLabel: labelFor(score),
      };
    });
  } catch {
    return [];
  }
}

function openLibraryDocToRemote(d: ApiJson): Remote {
  const subjects = Array.isArray(d?.subject) ? d.subject : [];
  return {
    title: d?.title,
    subtitle: d?.subtitle,
    author: Array.isArray(d?.author_name)
      ? d.author_name.join(", ")
      : undefined,
    genre: normaliseGenre(subjects),
    publisher: Array.isArray(d?.publisher) ? d.publisher[0] : undefined,
    publishedDate: d?.first_publish_year
      ? String(d.first_publish_year)
      : undefined,
    coverUrl: d?.cover_i
      ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`
      : undefined,
  };
}

async function openLibraryCandidates(
  q: string,
  want: MatchWant,
): Promise<RemoteCandidate[]> {
  try {
    const res = await fetch(
      `https://openlibrary.org/search.json?limit=5&fields=title,subtitle,author_name,subject,publisher,first_publish_year,cover_i,isbn&q=${encodeURIComponent(q)}`,
    );
    const json = await res.json();
    const docs: ApiJson[] = Array.isArray(json?.docs) ? json.docs : [];
    return docs.map((d) => {
      const remote = openLibraryDocToRemote(d);
      const isbns: string[] = Array.isArray(d?.isbn) ? d.isbn.map(String) : [];
      const score = scoreRemote(remote, isbns, want);
      return {
        ...remote,
        provider: "openlibrary" as const,
        score,
        matchLabel: labelFor(score),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Deterministic exact-edition lookup: Open Library resolves an ISBN straight
 * to its edition record, no fuzzy search involved.
 */
async function openLibraryIsbnCandidate(
  isbn: string,
  want: MatchWant,
): Promise<RemoteCandidate | null> {
  try {
    const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    if (!res.ok) return null;
    const ed: ApiJson = await res.json();
    const covers: number[] = Array.isArray(ed?.covers) ? ed.covers : [];
    const remote: Remote = {
      title: ed?.title,
      subtitle: ed?.subtitle,
      publisher: Array.isArray(ed?.publishers) ? ed.publishers[0] : undefined,
      publishedDate: ed?.publish_date ? String(ed.publish_date) : undefined,
      coverUrl: covers[0]
        ? `https://covers.openlibrary.org/b/id/${covers[0]}-L.jpg`
        : undefined,
    };
    const score = scoreRemote(remote, [isbn], want);
    return {
      ...remote,
      provider: "openlibrary",
      score,
      matchLabel: labelFor(score),
    };
  } catch {
    return null;
  }
}

function stripCandidate(c: RemoteCandidate): Remote {
  const { provider: _p, score: _s, matchLabel: _m, ...remote } = c;
  return remote;
}

/**
 * Ranked metadata candidates from every provider, best match first. Used by
 * the manual pick-a-match UI; the automatic paths take the top candidate.
 */
export async function searchMetadataCandidates(
  book: BookMeta,
): Promise<RemoteCandidate[]> {
  const title = cleanTitle(book.title ?? "");
  const author = (book.author ?? "").trim();
  const isbn = cleanIsbn(book.isbn ?? "");
  const want: MatchWant = { title, author, isbn };
  const queries = [
    isbn ? `isbn:${isbn}` : "",
    title && author ? `${title} ${author}` : "",
    title,
  ].filter(Boolean);

  const all: RemoteCandidate[] = [];
  if (isbn) {
    const exact = await openLibraryIsbnCandidate(isbn, want);
    if (exact) all.push(exact);
  }
  for (const q of queries) {
    const [g, o] = await Promise.all([
      googleCandidates(q, want),
      openLibraryCandidates(q, want),
    ]);
    all.push(...g, ...o);
  }

  const seen = new Set<string>();
  return all
    .filter((c) => {
      if (c.score <= 0) return false;
      const key = `${c.provider}|${normText(c.title)}|${normText(c.author)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

/**
 * Best single remote match for automatic use (import-time fill, cover fetch).
 * Returns {} unless a candidate actually resembles the book — a wrong book's
 * metadata is worse than none.
 */
export async function fetchRemote(book: BookMeta): Promise<Remote> {
  const cands = await searchMetadataCandidates(book);
  const best = cands[0];
  if (!best || best.score < 40) return {};
  const out = stripCandidate(best);
  if (!out.genre) {
    // Borrow the genre from the best Open Library candidate for the same
    // book — its subject tags are richer than Google's categories.
    const ol = cands.find(
      (c) => c.provider === "openlibrary" && c.genre && c.score >= 40,
    );
    if (ol?.genre) out.genre = ol.genre;
  }
  return out;
}

/**
 * Whether importing a book may query online metadata providers (Google Books,
 * Open Library) for missing fields and covers. Off by default: with it off,
 * imports use only what is embedded in the file and make zero network calls.
 * Manual "refresh metadata" from a book's details is always an explicit user
 * action and is not gated by this setting.
 */
const ONLINE_METADATA_KEY = "onlineMetadataLookup";

export function getOnlineMetadataLookup(): Promise<boolean> {
  return getSetting<boolean>(ONLINE_METADATA_KEY, false);
}

export function setOnlineMetadataLookup(enabled: boolean): Promise<void> {
  return setSetting(ONLINE_METADATA_KEY, enabled);
}

export function detectFormat(name: string): BookFormat | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["epub", "pdf", "cbz", "cbr", "txt"].includes(ext))
    return ext as BookFormat;
  return null;
}

export async function importFile(
  file: File,
  fileHash?: string,
): Promise<BookMeta> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  // Kindle formats aren't supported: explain instead of a generic error.
  if (ext === "mobi" || ext === "azw3" || ext === "azw") {
    throw new Error(
      "Kindle MOBI/AZW3 files can't be read in Aurum — it reads EPUB, PDF, CBZ and TXT. A DRM-free EPUB copy of the same book will work.",
    );
  }
  // CBR is a RAR archive, and RAR can't be unpacked in the browser. Refuse it
  // at the door (as MOBI is refused) instead of importing a book that then
  // can't be opened. Books already in the library as CBR keep the reader's
  // convert message.
  if (ext === "cbr") {
    throw new Error(
      "CBR files are RAR archives, which can't be opened in the browser. Convert this comic to CBZ first — free tools like Calibre or an online CBZ converter can do it — then import the CBZ.",
    );
  }
  const format = detectFormat(file.name) ?? "epub";
  const book = emptyBook();
  book.format = format;
  book.fileSize = file.size;
  const hash = fileHash ?? (await hashFile(file).catch(() => ""));
  if (hash) book.fileHash = hash;

  book.title = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .trim();

  await parseInto(file, book);

  // metadata provider fallback for missing (never locked at import) fields.
  // Only when the reader has opted in: otherwise imports stay fully offline.
  if (
    (!book.description || !book.genre || !book.hasCover) &&
    (await getOnlineMetadataLookup())
  ) {
    const remote = await fetchRemote(book);
    if (!book.description && remote.description)
      book.description = remote.description;
    if (!book.genre && remote.genre) book.genre = remote.genre;
    if (!book.publisher && remote.publisher) book.publisher = remote.publisher;
    if (!book.publishedDate && remote.publishedDate)
      book.publishedDate = remote.publishedDate;
    if (!book.hasCover && remote.coverUrl) {
      try {
        const blob = await (await fetch(remote.coverUrl)).blob();
        if (blob.size > 1000) {
          await putCover(book.id, blob);
          book.hasCover = true;
        }
      } catch {
        /* ignore */
      }
    }
  }

  try {
    await putFile(book.id, file);
    await putBook(book);
  } catch (error) {
    if (isQuotaError(error)) throw new Error(STORAGE_FULL_MESSAGE);
    throw error;
  }
  // A library on the device is worth protecting from automatic eviction:
  // ask for persistent storage as books arrive, not only from Settings.
  void requestPersistentStorage();
  return book;
}

/**
 * Build a metadata patch from a remote match. Overwrites unlocked fields,
 * never locked ones, and skips values identical to what the book already has.
 */
export function applyRemotePatch(
  book: BookMeta,
  remote: Remote,
): Partial<BookMeta> {
  const locked = new Set(book.locked ?? []);
  const patch: Partial<BookMeta> = {};
  const set = <K extends keyof BookMeta>(
    key: K,
    value: BookMeta[K] | undefined,
  ) => {
    if (value === undefined || value === "" || locked.has(key as string))
      return;
    if (book[key] === value) return;
    patch[key] = value;
  };

  set("title", remote.title);
  set("subtitle", remote.subtitle);
  set("author", remote.author);
  set("description", remote.description);
  set("genre", remote.genre);
  set("publisher", remote.publisher);
  set("publishedDate", remote.publishedDate);
  return patch;
}

/** Re-query metadata providers for one book. Overwrites unlocked fields, never locked ones. */
export async function refetchMetadata(
  book: BookMeta,
): Promise<Partial<BookMeta>> {
  return applyRemotePatch(book, await fetchRemote(book));
}

/** Fetch and store a cover from metadata providers. Returns true when a cover was saved. */
export async function refetchCover(
  book: BookMeta,
  force = false,
): Promise<boolean> {
  if ((book.locked ?? []).includes("cover")) return false;
  if (book.hasCover && !force) return false;
  const remote = await fetchRemote(book);
  if (!remote.coverUrl) return false;
  try {
    const blob = await (await fetch(remote.coverUrl)).blob();
    if (blob.size <= 1000) return false;
    await putCover(book.id, blob);
    return true;
  } catch {
    return false;
  }
}

/** Count pages for an EPUB zip: publisher metadata first, else real text length. */
async function countEpubPages(file: File): Promise<number> {
  const zip = await (await loadJSZip()).loadAsync(file);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) return 0;
  const container = new DOMParser().parseFromString(
    await containerFile.async("string"),
    "application/xml",
  );
  const opfPath =
    container.querySelector("rootfile")?.getAttribute("full-path") ?? "";
  const opfFile = zip.file(opfPath);
  if (!opfFile) return 0;
  const opf = new DOMParser().parseFromString(
    await opfFile.async("string"),
    "application/xml",
  );
  const dir = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
    : "";

  const declared = Array.from(opf.getElementsByTagName("meta"))
    .map((m) => {
      const name = (
        m.getAttribute("name") ??
        m.getAttribute("property") ??
        ""
      ).toLowerCase();
      if (
        !/(numberofpages|page-progression-count|calibre:page_count|pages)$/.test(
          name,
        )
      )
        return 0;
      return (
        Math.round(Number(m.getAttribute("content") ?? m.textContent ?? 0)) || 0
      );
    })
    .find((n) => n > 0);
  if (declared) return declared;

  const manifestItems = Array.from(opf.getElementsByTagName("item"));
  const hrefs = Array.from(opf.getElementsByTagName("itemref"))
    .map((r) => r.getAttribute("idref"))
    .map(
      (id) =>
        manifestItems
          .find((i) => i.getAttribute("id") === id)
          ?.getAttribute("href") ?? "",
    )
    .filter(Boolean);

  let chars = 0;
  for (const href of hrefs) {
    const path = decodeURIComponent(dir + href).replace(/^\.\//, "");
    const entry = zip.file(path) ?? zip.file(decodeURIComponent(href));
    if (!entry) continue;
    try {
      const html = await entry.async("string");
      chars += html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;|&#\d+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim().length;
    } catch {
      /* skip unreadable spine item */
    }
  }
  return chars
    ? Math.max(1, Math.round(chars / 1800))
    : Math.max(hrefs.length * 12, Math.round(file.size / 2200));
}

/**
 * Recompute the page count for a book already in the library, straight from its
 * stored file. Returns the new count, or null when the file is unavailable.
 */
export async function recountPages(book: BookMeta): Promise<number | null> {
  const blob = await getFile(book.id);
  if (!blob) return null;
  const file = new File([blob], `${book.title || "book"}.${book.format}`);

  let pages = 0;
  if (book.format === "epub") {
    pages = await countEpubPages(file);
  } else if (book.format === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
      .default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() })
      .promise;
    pages = doc.numPages;
  } else if (book.format === "cbz" || book.format === "cbr") {
    try {
      const zip = await (await loadJSZip()).loadAsync(file);
      pages = Object.values(zip.files).filter(
        (f) =>
          !f.dir &&
          /\.(jpe?g|png|gif|webp)$/i.test(f.name) &&
          !/(^|\/)(__MACOSX\/|\._)/.test(f.name),
      ).length;
    } catch {
      pages = Math.round(file.size / 2200);
    }
  } else if (book.format === "txt") {
    pages = Math.max(1, Math.round((await file.text()).length / 1800));
  } else {
    pages = Math.round(file.size / 2200);
  }

  if (!pages) return null;
  return pages;
}

const LINK_EXT = /\.(epub|pdf|cbz|txt)(\?|#|$)/i;

/**
 * True when a book's page count is exactly what the old size-based estimate
 * (file bytes / 2200) would produce. Those counts came from imports that
 * never actually counted the text, so a recount from the file is safe to
 * apply; a real count is only ever replaced when the recount differs, and
 * the repair below only writes when the stored count carries this signature.
 */
export function isFallbackPageCount(
  pageCount: number,
  fileSize: number,
): boolean {
  return (
    pageCount > 0 && fileSize > 0 && pageCount === Math.round(fileSize / 2200)
  );
}

export type RepairPatchResult = {
  /** Fields to write back to the book. Empty when nothing needs fixing. */
  patch: Partial<BookMeta>;
  /** The probe found a cover the book is missing. */
  cover: boolean;
  /** The probe recounts the pages to a different number. */
  pages: boolean;
  /** The probe fills in a blank metadata field. */
  details: boolean;
};

/**
 * Compare a book against a fresh parse of its own file and work out what the
 * file can repair. Pure: it never writes, so it is easy to test.
 *
 * It only ever fills in blanks and fixes counts that carry the old fallback
 * signature. It never overwrites a value the book already has, never touches
 * a locked field, and never writes a recount that matches the stored count.
 */
export function repairPatch(
  book: BookMeta,
  probe: BookMeta,
): RepairPatchResult {
  const patch: Partial<BookMeta> = {};
  const locked = new Set(book.locked ?? []);
  let cover = false;
  let pages = false;
  let details = false;

  if (probe.hasCover && !book.hasCover) {
    patch.hasCover = true;
    cover = true;
  }
  if (
    probe.pageCount > 0 &&
    probe.pageCount !== book.pageCount &&
    isFallbackPageCount(book.pageCount, book.fileSize)
  ) {
    patch.pageCount = probe.pageCount;
    pages = true;
  }
  const fill = <K extends keyof BookMeta>(key: K, value: BookMeta[K]) => {
    if (locked.has(key as string)) return;
    const current = book[key];
    const empty = current === "" || current === undefined || current === null;
    if (empty && value !== "" && value !== undefined && value !== null) {
      patch[key] = value;
      details = true;
    }
  };
  fill("title", probe.title);
  fill("author", probe.author);
  fill("publisher", probe.publisher);
  fill("isbn", probe.isbn);
  fill("language", probe.language);
  fill("publishedDate", probe.publishedDate);
  fill("genre", probe.genre);
  fill("description", probe.description);
  fill("series", probe.series);
  return { patch, cover, pages, details };
}

export type RepairSummary = {
  covers: number;
  pages: number;
  details: number;
};

/**
 * Look again inside stored book files for covers that weren't found at import
 * (older imports only recognised the simplest cover markings), and repair
 * what else the file can fix: page counts that were only ever a size-based
 * estimate, and blank author, publisher, ISBN and other details the file
 * actually contains. Local only. Returns how many books gained each fix.
 */
export async function restoreMissingCovers(
  onProgress?: (done: number, total: number) => void,
): Promise<RepairSummary> {
  const summary: RepairSummary = { covers: 0, pages: 0, details: 0 };
  const needsWork = (await listBooks()).filter(
    (b) =>
      !b.hasCover || !b.author || isFallbackPageCount(b.pageCount, b.fileSize),
  );
  for (const [i, book] of needsWork.entries()) {
    onProgress?.(i, needsWork.length);
    const file = await getFile(book.id);
    if (!file) continue;
    const probe = { ...emptyBook(), id: book.id, format: book.format };
    try {
      await parseInto(
        file instanceof File
          ? file
          : new File([file], `book.${book.format}`, { type: file.type }),
        probe,
      );
    } catch {
      continue;
    }
    const { patch, cover, pages, details } = repairPatch(book, probe);
    if (Object.keys(patch).length === 0) continue;
    await updateBook(book.id, patch);
    if (cover) summary.covers += 1;
    if (pages) summary.pages += 1;
    if (details) summary.details += 1;
  }
  onProgress?.(needsWork.length, needsWork.length);
  return summary;
}

/** File extension for a book MIME type, or null when it isn't one Aurum reads. */
export function extensionForType(contentType: string): string | null {
  const t = contentType.toLowerCase();
  if (t.includes("epub")) return "epub";
  if (t.includes("pdf")) return "pdf";
  if (t.includes("comicbook+zip") || t.includes("cbz")) return "cbz";
  if (t.startsWith("text/plain")) return "txt";
  return null;
}

/** Filename for a downloaded book, from the response headers or the URL path. */
function nameFromResponse(url: string, response: Response): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (match?.[1]) return decodeURIComponent(match[1]);
  const path =
    new URL(url).pathname.split("/").filter(Boolean).pop() ?? "book.epub";
  return decodeURIComponent(path);
}

export type UrlImportResult = {
  added: BookMeta[];
  duplicates: BookMeta[];
  /** Set when the link was an OPDS catalog: open it in the catalog browser. */
  catalogUrl?: string;
};

/**
 * Imports a book straight from a web link. A link to an OPDS catalog isn't
 * imported; its URL comes back as `catalogUrl` so it can be browsed instead.
 */
export async function importFromUrl(
  rawUrl: string,
  options: { authorization?: string; filename?: string } = {},
): Promise<UrlImportResult> {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url))
    throw new Error("Enter a link starting with http:// or https://");

  const { response, finalUrl, viaRelay } = await fetchExternal(url, {
    ...(options.authorization ? { authorization: options.authorization } : {}),
  });
  if (response.status === 401) {
    throw new Error(
      options.authorization
        ? friendlyHttpError(401, { kind: "book", signedIn: true })
        : "That site needs you to sign in. If it's an OPDS catalog, add it in Browse catalogs with your username and password.",
    );
  }
  if (!response.ok) {
    throw new Error(
      friendlyHttpError(response.status, {
        kind: "book",
        viaRelay,
        signedIn: Boolean(options.authorization),
      }),
    );
  }
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("text/html")) {
    // A 200 that serves a page instead of a file: a sign-in wall, a
    // "your download starts soon" interstitial, or the wrong link entirely.
    throw new Error(
      "That link opened a web page, not a book file — the site may need a sign-in or a click through its download page. Download the book in your browser, then import the file here.",
    );
  }

  if (
    type.includes("atom") ||
    type.includes("opds") ||
    type.includes("xml") ||
    (type.includes("json") && !LINK_EXT.test(finalUrl))
  ) {
    void response.body?.cancel();
    return { added: [], duplicates: [], catalogUrl: finalUrl };
  }

  const blob = await response.blob();
  let name = options.filename ?? nameFromResponse(finalUrl, response);
  // Catalog download links often have no file extension
  // (e.g. /ebooks/1342.epub3.images); fall back to the content type.
  if (!detectFormat(name)) {
    const ext = extensionForType(type);
    if (ext)
      name = `${name.replace(/[^\w\s.-]+/g, "").trim() || "book"}.${ext}`;
  }
  const fmt = detectFormat(name);
  if (/\.(mobi|azw3?)$/i.test(name)) {
    throw new Error(
      "Kindle MOBI/AZW3 files can't be read in Aurum — it reads EPUB, PDF, CBZ and TXT.",
    );
  }
  if (fmt === "cbr") {
    throw new Error(
      "That link is a CBR file — a RAR archive, which can't be opened in the browser. Convert it to CBZ first, then import the CBZ.",
    );
  }
  if (!fmt || !["epub", "pdf", "cbz", "txt"].includes(fmt)) {
    throw new Error("That link is not an EPUB, PDF, CBZ or TXT file");
  }
  const file = new File([blob], name, { type: blob.type });
  const { hash, existing, restored } = await findDuplicate(file);
  if (existing && restored) return { added: [existing], duplicates: [] };
  if (existing) return { added: [], duplicates: [existing] };
  return { added: [await importFile(file, hash)], duplicates: [] };
}
