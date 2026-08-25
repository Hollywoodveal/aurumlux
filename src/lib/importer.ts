import JSZip from "jszip";
import {
  getFile,
  listBooks,
  putBook,
  putCover,
  putFile,
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

async function googleLookup(q: string): Promise<Remote> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?maxResults=5&q=${encodeURIComponent(q)}`,
    );
    const json = await res.json();
    const items: any[] = Array.isArray(json?.items) ? json.items : [];
    const v = items[0]?.volumeInfo;
    if (!v) return {};
    // categories are sparse — take them from the first result that has any
    const cats = items.map((i) => i?.volumeInfo?.categories).find((c) => Array.isArray(c) && c.length);
    return {
      title: v.title,
      subtitle: v.subtitle,
      author: Array.isArray(v.authors) ? v.authors.join(", ") : undefined,
      description: v.description,
      genre: normaliseGenre(cats ?? []),
      publisher: v.publisher,
      publishedDate: v.publishedDate,
      coverUrl: v.imageLinks?.thumbnail?.replace("http://", "https://")?.replace("zoom=1", "zoom=3"),
    };
  } catch {
    return {};
  }
}

async function openLibraryLookup(q: string): Promise<Remote> {
  try {
    const res = await fetch(
      `https://openlibrary.org/search.json?limit=3&fields=title,subtitle,author_name,subject,publisher,first_publish_year,cover_i&q=${encodeURIComponent(q)}`,
    );
    const json = await res.json();
    const docs: any[] = Array.isArray(json?.docs) ? json.docs : [];
    const d = docs[0];
    if (!d) return {};
    const subjects = docs.map((x) => x?.subject).find((s) => Array.isArray(s) && s.length);
    return {
      title: d.title,
      subtitle: d.subtitle,
      author: Array.isArray(d.author_name) ? d.author_name.join(", ") : undefined,
      genre: normaliseGenre(subjects ?? []),
      publisher: Array.isArray(d.publisher) ? d.publisher[0] : undefined,
      publishedDate: d.first_publish_year ? String(d.first_publish_year) : undefined,
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
    };
  } catch {
    return {};
  }
}

async function queryProviders(q: string): Promise<Remote> {
  const google = await googleLookup(q);
  if (Object.values(google).some(Boolean) && google.genre) return google;
  const ol = await openLibraryLookup(q);
  if (Object.values(google).some(Boolean)) {
    // keep Google's richer fields, borrow the genre (and anything missing) from Open Library
    return { ...ol, ...Object.fromEntries(Object.entries(google).filter(([, v]) => Boolean(v))) };
  }
  return ol;
}

export async function fetchRemote(book: BookMeta): Promise<Remote> {
  const title = cleanTitle(book.title ?? "");
  const author = (book.author ?? "").trim();
  const isbn = (book.isbn ?? "").replace(/[-\s]/g, "");
  const queries = [
    isbn ? `isbn:${isbn}` : "",
    title && author ? `${title} ${author}` : "",
    title,
  ].filter(Boolean);
  let best: Remote = {};
  for (const q of queries) {
    const remote = await queryProviders(q);
    if (Object.values(remote).some(Boolean)) {
      best = { ...remote, ...Object.fromEntries(Object.entries(best).filter(([, v]) => Boolean(v))) };
      if (best.genre) return best;
    }
  }
  return best;
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

  // metadata provider fallback for missing (never locked at import) fields
  if (!book.description || !book.genre || !book.hasCover) {
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

/** Re-query metadata providers for one book. Overwrites unlocked fields, never locked ones. */
export async function refetchMetadata(book: BookMeta): Promise<Partial<BookMeta>> {
  const remote = await fetchRemote(book);
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
