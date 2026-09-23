import JSZip from "jszip";
import {
  getFile,
  getSetting,
  listBooks,
  putBook,
  putCover,
  putFile,
  setSetting,
  uid,
  type BookFormat,
  type BookMeta,
} from "./db";

/** SHA-256 of a file's bytes, used as its identity for duplicate detection. */
export async function hashFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Looks for a book already in the library with the same bytes. Falls back to a
 * title + size match for books imported before hashing existed.
 */
export async function findDuplicate(
  file: File,
): Promise<{ hash: string; existing: BookMeta | null }> {
  const hash = await hashFile(file);
  const books = await listBooks();
  const title = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim().toLowerCase();
  const existing =
    books.find((b) => b.fileHash === hash) ??
    books.find((b) => !b.fileHash && b.fileSize === file.size && b.title.toLowerCase() === title) ??
    null;
  return { hash, existing };
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
  const zip = await JSZip.loadAsync(file);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) return;
  const container = new DOMParser().parseFromString(
    await containerFile.async("string"),
    "application/xml",
  );
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path") ?? "";
  const opfFile = zip.file(opfPath);
  if (!opfFile) return;
  const opf = new DOMParser().parseFromString(await opfFile.async("string"), "application/xml");
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  book.title = textOf(opf, "title") || book.title;
  book.author = allOf(opf, "creator").join(", ") || book.author;
  book.genre = allOf(opf, "subject").slice(0, 3).join(", ");
  book.description = (textOf(opf, "description") || "").replace(/<[^>]+>/g, "").trim();
  book.publisher = textOf(opf, "publisher");
  book.language = textOf(opf, "language");
  book.publishedDate = textOf(opf, "date");
  const ids = allOf(opf, "identifier").join(" ");
  const isbnMatch = ids.replace(/[-\s]/g, "").match(/(97[89]\d{10}|\d{9}[\dXx])/);
  book.isbn = isbnMatch ? isbnMatch[0] : "";
  const series = Array.from(opf.getElementsByTagName("meta")).find(
    (m) => m.getAttribute("name") === "calibre:series",
  );
  book.series = series?.getAttribute("content") ?? "";

  // Page count: trust publisher metadata, else count the real text in the spine.
  const metas = Array.from(opf.getElementsByTagName("meta"));
  const declaredPages = metas
    .map((m) => {
      const name = (m.getAttribute("name") ?? m.getAttribute("property") ?? "").toLowerCase();
      if (!/(numberofpages|page-progression-count|calibre:page_count|pages)$/.test(name)) return 0;
      return Math.round(Number(m.getAttribute("content") ?? m.textContent ?? 0)) || 0;
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
          manifestItems.find((i) => i.getAttribute("id") === id)?.getAttribute("href") ?? "",
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

  // cover
  let coverHref = "";
  const metaCover = Array.from(opf.getElementsByTagName("meta")).find(
    (m) => m.getAttribute("name") === "cover",
  );
  const items = Array.from(opf.getElementsByTagName("item"));
  const byId = (id: string) => items.find((i) => i.getAttribute("id") === id);
  if (metaCover) coverHref = byId(metaCover.getAttribute("content") ?? "")?.getAttribute("href") ?? "";
  if (!coverHref) {
    const props = items.find((i) => (i.getAttribute("properties") ?? "").includes("cover-image"));
    coverHref = props?.getAttribute("href") ?? "";
  }
  if (!coverHref) {
    const guess = items.find(
      (i) =>
        (i.getAttribute("media-type") ?? "").startsWith("image/") &&
        /cover/i.test(i.getAttribute("href") ?? ""),
    );
    coverHref = guess?.getAttribute("href") ?? "";
  }
  if (coverHref) {
    const path = decodeURIComponent(dir + coverHref).replace(/^\.\//, "");
    const entry = zip.file(path) ?? zip.file(coverHref);
    if (entry) {
      const blob = await entry.async("blob");
      await putCover(book.id, blob);
      book.hasCover = true;
    }
  }
}

async function parsePdf(file: File, book: BookMeta) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  book.pageCount = doc.numPages;
  const meta = await doc.getMetadata();
  const info = (meta.info ?? {}) as Record<string, string>;
  book.title = info['Title']?.trim() || book.title;
  book.author = info['Author']?.trim() || "";
  book.description = info['Subject']?.trim() || "";
  book.publisher = info['Producer']?.trim() || "";
  book.genre = info['Keywords']?.trim() || "";
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
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (blob) {
      await putCover(book.id, blob);
      book.hasCover = true;
    }
  }
}

async function parseComicArchive(file: File, book: BookMeta) {
  try {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files)
      .filter((f) => !f.dir && /\.(jpe?g|png|gif|webp)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (entries.length === 0) return;
    book.pageCount = entries.length;
    const first = entries[0];
    if (first) {
      const blob = await first.async("blob");
      await putCover(book.id, blob);
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
    .replace(/\b(epub|pdf|mobi|azw3|retail|ebook|z-lib\w*|libgen|v\d+)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalise provider category strings ("Fiction / Fantasy / Epic") into clean tags. */
function normaliseGenre(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const raw of values) {
    for (const part of String(raw).split(/[\/>|;]+/)) {
      const t = part.replace(/\s+/g, " ").trim();
      if (t.length < 2 || t.length > 40) continue;
      const key = t.toLowerCase();
      if (!seen.has(key)) seen.add(key);
      if (seen.size >= 3) break;
    }
    if (seen.size >= 3) break;
  }
  if (!seen.size) return undefined;
  return [...seen].map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase())).join(", ");
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

function googleVolumeToRemote(v: any): { remote: Remote; isbns: string[] } {
  const ids: any[] = Array.isArray(v?.industryIdentifiers) ? v.industryIdentifiers : [];
  return {
    remote: {
      title: v?.title,
      subtitle: v?.subtitle,
      author: Array.isArray(v?.authors) ? v.authors.join(", ") : undefined,
      description: v?.description,
      genre: normaliseGenre(
        (Array.isArray(v?.categories) ? v.categories : []).flatMap((c: string) =>
          String(c).split("/"),
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

async function googleCandidates(q: string, want: MatchWant): Promise<RemoteCandidate[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?maxResults=5&q=${encodeURIComponent(q)}`,
    );
    const json = await res.json();
    const items: any[] = Array.isArray(json?.items) ? json.items : [];
    return items.map((item) => {
      const { remote, isbns } = googleVolumeToRemote(item?.volumeInfo);
      const score = scoreRemote(remote, isbns, want);
      return { ...remote, provider: "google" as const, score, matchLabel: labelFor(score) };
    });
  } catch {
    return [];
  }
}

function openLibraryDocToRemote(d: any): Remote {
  const subjects = Array.isArray(d?.subject) ? d.subject : [];
  return {
    title: d?.title,
    subtitle: d?.subtitle,
    author: Array.isArray(d?.author_name) ? d.author_name.join(", ") : undefined,
    genre: normaliseGenre(subjects),
    publisher: Array.isArray(d?.publisher) ? d.publisher[0] : undefined,
    publishedDate: d?.first_publish_year ? String(d.first_publish_year) : undefined,
    coverUrl: d?.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
  };
}

async function openLibraryCandidates(q: string, want: MatchWant): Promise<RemoteCandidate[]> {
  try {
    const res = await fetch(
      `https://openlibrary.org/search.json?limit=5&fields=title,subtitle,author_name,subject,publisher,first_publish_year,cover_i,isbn&q=${encodeURIComponent(q)}`,
    );
    const json = await res.json();
    const docs: any[] = Array.isArray(json?.docs) ? json.docs : [];
    return docs.map((d) => {
      const remote = openLibraryDocToRemote(d);
      const isbns: string[] = Array.isArray(d?.isbn) ? d.isbn.map(String) : [];
      const score = scoreRemote(remote, isbns, want);
      return { ...remote, provider: "openlibrary" as const, score, matchLabel: labelFor(score) };
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
    const ed: any = await res.json();
    const covers: number[] = Array.isArray(ed?.covers) ? ed.covers : [];
    const remote: Remote = {
      title: ed?.title,
      subtitle: ed?.subtitle,
      publisher: Array.isArray(ed?.publishers) ? ed.publishers[0] : undefined,
      publishedDate: ed?.publish_date ? String(ed.publish_date) : undefined,
      coverUrl: covers[0] ? `https://covers.openlibrary.org/b/id/${covers[0]}-L.jpg` : undefined,
    };
    const score = scoreRemote(remote, [isbn], want);
    return { ...remote, provider: "openlibrary", score, matchLabel: labelFor(score) };
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
export async function searchMetadataCandidates(book: BookMeta): Promise<RemoteCandidate[]> {
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
    const ol = cands.find((c) => c.provider === "openlibrary" && c.genre && c.score >= 40);
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
  if (["epub", "pdf", "cbz", "cbr", "mobi", "azw3", "txt"].includes(ext)) return ext as BookFormat;
  return null;
}

export async function importFile(file: File, fileHash?: string): Promise<BookMeta> {
  const format = detectFormat(file.name) ?? "epub";
  const book = emptyBook();
  book.format = format;
  book.fileSize = file.size;
  const hash = fileHash ?? (await hashFile(file).catch(() => ""));
  if (hash) book.fileHash = hash;

  book.title = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();


  if (format === "epub") await parseEpub(file, book);
  else if (format === "pdf") await parsePdf(file, book);
  else if (format === "cbz" || format === "cbr") await parseComicArchive(file, book);
  else if (format === "txt") await parseTxt(file, book);
  else book.pageCount = Math.round(file.size / 2200);

  // metadata provider fallback for missing (never locked at import) fields.
  // Only when the reader has opted in: otherwise imports stay fully offline.
  if ((!book.description || !book.genre || !book.hasCover) && (await getOnlineMetadataLookup())) {
    const remote = await fetchRemote(book);
    if (!book.description && remote.description) book.description = remote.description;
    if (!book.genre && remote.genre) book.genre = remote.genre;
    if (!book.publisher && remote.publisher) book.publisher = remote.publisher;
    if (!book.publishedDate && remote.publishedDate) book.publishedDate = remote.publishedDate;
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

  await putFile(book.id, file);
  await putBook(book);
  return book;
}

/**
 * Build a metadata patch from a remote match. Overwrites unlocked fields,
 * never locked ones, and skips values identical to what the book already has.
 */
export function applyRemotePatch(book: BookMeta, remote: Remote): Partial<BookMeta> {
  const locked = new Set(book.locked ?? []);
  const patch: Partial<BookMeta> = {};
  const set = <K extends keyof BookMeta>(key: K, value: BookMeta[K] | undefined) => {
    if (value === undefined || value === "" || locked.has(key as string)) return;
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
export async function refetchMetadata(book: BookMeta): Promise<Partial<BookMeta>> {
  return applyRemotePatch(book, await fetchRemote(book));
}

/** Fetch and store a cover from metadata providers. Returns true when a cover was saved. */
export async function refetchCover(book: BookMeta, force = false): Promise<boolean> {
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
  const zip = await JSZip.loadAsync(file);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) return 0;
  const container = new DOMParser().parseFromString(
    await containerFile.async("string"),
    "application/xml",
  );
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path") ?? "";
  const opfFile = zip.file(opfPath);
  if (!opfFile) return 0;
  const opf = new DOMParser().parseFromString(await opfFile.async("string"), "application/xml");
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const declared = Array.from(opf.getElementsByTagName("meta"))
    .map((m) => {
      const name = (m.getAttribute("name") ?? m.getAttribute("property") ?? "").toLowerCase();
      if (!/(numberofpages|page-progression-count|calibre:page_count|pages)$/.test(name)) return 0;
      return Math.round(Number(m.getAttribute("content") ?? m.textContent ?? 0)) || 0;
    })
    .find((n) => n > 0);
  if (declared) return declared;

  const manifestItems = Array.from(opf.getElementsByTagName("item"));
  const hrefs = Array.from(opf.getElementsByTagName("itemref"))
    .map((r) => r.getAttribute("idref"))
    .map(
      (id) => manifestItems.find((i) => i.getAttribute("id") === id)?.getAttribute("href") ?? "",
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
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    pages = doc.numPages;
  } else if (book.format === "cbz" || book.format === "cbr") {
    try {
      const zip = await JSZip.loadAsync(file);
      pages = Object.values(zip.files).filter(
        (f) => !f.dir && /\.(jpe?g|png|gif|webp)$/i.test(f.name),
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

const LINK_EXT = /\.(epub|pdf|cbz|cbr|txt)(\?|#|$)/i;

/** Filename for a downloaded book, from the response headers or the URL path. */
function nameFromResponse(url: string, response: Response): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (match?.[1]) return decodeURIComponent(match[1]);
  const path = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "book.epub";
  return decodeURIComponent(path);
}

/**
 * Imports a book straight from a web link, including download links found in an
 * OPDS catalog feed. Returns the books that were added and any duplicates skipped.
 */
export async function importFromUrl(
  rawUrl: string,
): Promise<{ added: BookMeta[]; duplicates: BookMeta[] }> {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("Enter a link starting with http:// or https://");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`The link returned ${response.status}`);
  const type = (response.headers.get("content-type") ?? "").toLowerCase();

  // OPDS / Atom catalog feed: collect the direct book download links inside it.
  if (type.includes("xml") || type.includes("atom") || type.includes("opds")) {
    const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
    const hrefs = [...xml.querySelectorAll("link")]
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => LINK_EXT.test(href))
      .map((href) => new URL(href, url).toString());
    const unique = [...new Set(hrefs)].slice(0, 25);
    if (unique.length === 0) throw new Error("No downloadable books found in that catalog");
    const added: BookMeta[] = [];
    const duplicates: BookMeta[] = [];
    for (const href of unique) {
      try {
        const result = await importFromUrl(href);
        added.push(...result.added);
        duplicates.push(...result.duplicates);
      } catch {
        /* skip entries that fail so the rest of the catalog still imports */
      }
    }
    return { added, duplicates };
  }

  const blob = await response.blob();
  const name = nameFromResponse(url, response);
  if (!detectFormat(name)) throw new Error("That link is not an EPUB, PDF, CBZ or TXT file");
  const file = new File([blob], name, { type: blob.type });
  const { hash, existing } = await findDuplicate(file);
  if (existing) return { added: [], duplicates: [existing] };
  return { added: [await importFile(file, hash)], duplicates: [] };
}
