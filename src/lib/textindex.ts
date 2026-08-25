import JSZip from "jszip";
import {
  allTextIndexes,
  getFile,
  getTextIndex,
  listBooks,
  putTextIndex,
  type BookMeta,
  type TextIndex,
} from "./db";

const MAX_SECTION_CHARS = 60000;

function stripHtml(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunk(text: string, label: string, size = 4000): TextIndex["sections"] {
  const out: TextIndex["sections"] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push({ label: `${label} · part ${out.length + 1}`, href: String(i), text: text.slice(i, i + size) });
  }
  return out;
}

async function epubSections(blob: Blob): Promise<TextIndex["sections"]> {
  const zip = await JSZip.loadAsync(blob);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) return [];
  const container = new DOMParser().parseFromString(await containerFile.async("string"), "application/xml");
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path") ?? "";
  const opfFile = zip.file(opfPath);
  if (!opfFile) return [];
  const opf = new DOMParser().parseFromString(await opfFile.async("string"), "application/xml");
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const items = Array.from(opf.getElementsByTagName("item"));
  const spine = Array.from(opf.getElementsByTagName("itemref")).map((r) => r.getAttribute("idref"));

  const sections: TextIndex["sections"] = [];
  let index = 0;
  for (const id of spine) {
    const item = items.find((i) => i.getAttribute("id") === id);
    const href = item?.getAttribute("href");
    if (!href) continue;
    const entry = zip.file(decodeURIComponent(dir + href).replace(/^\.\//, "")) ?? zip.file(href);
    if (!entry) continue;
    index += 1;
    const text = stripHtml(await entry.async("string")).slice(0, MAX_SECTION_CHARS);
    if (text.length < 20) continue;
    sections.push({ label: `Section ${index}`, href, text });
  }
  return sections;
}

async function pdfSections(blob: Blob): Promise<TextIndex["sections"]> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  const sections: TextIndex["sections"] = [];
  const limit = Math.min(doc.numPages, 600);
  for (let p = 1; p <= limit; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((i) => ("str" in i ? i.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 20) continue;
    sections.push({ label: `Page ${p}`, href: String(p), text });
  }
  return sections;
}

async function cbzSections(blob: Blob): Promise<TextIndex["sections"]> {
  // Comics carry no extractable text; the page list still makes search useful.
  const zip = await JSZip.loadAsync(blob);
  const names = Object.keys(zip.files).filter((n) => /\.(jpe?g|png|webp|gif|avif)$/i.test(n));
  return names.length ? [{ label: "Pages", href: "0", text: names.sort().join(" ") }] : [];
}

/** Build (or rebuild) the searchable plain-text index for one book. */
export async function buildTextIndex(book: BookMeta): Promise<TextIndex | null> {
  const blob = await getFile(book.id);
  if (!blob) return null;
  let sections: TextIndex["sections"] = [];
  try {
    if (book.format === "epub") sections = await epubSections(blob);
    else if (book.format === "pdf") sections = await pdfSections(blob);
    else if (book.format === "cbz" || book.format === "cbr") sections = await cbzSections(blob);
    else if (book.format === "txt") sections = chunk(await blob.text(), "Text");
  } catch {
    sections = [];
  }
  const idx: TextIndex = { bookId: book.id, builtAt: Date.now(), sections };
  await putTextIndex(idx);
  return idx;
}

export async function ensureTextIndex(book: BookMeta): Promise<TextIndex | null> {
  const existing = await getTextIndex(book.id);
  if (existing) return existing;
  return buildTextIndex(book);
}

/** Build indexes for every book that lacks one. Returns how many were built. */
export async function indexLibrary(onProgress?: (done: number, total: number) => void) {
  const books = await listBooks();
  const have = new Set((await allTextIndexes()).map((t) => t.bookId));
  const missing = books.filter((b) => !have.has(b.id));
  let done = 0;
  for (const book of missing) {
    await buildTextIndex(book);
    done += 1;
    onProgress?.(done, missing.length);
  }
  return done;
}

export type TextHit = {
  bookId: string;
  label: string;
  href: string;
  snippet: string;
  index: number;
};

function snippetAround(text: string, at: number, len: number) {
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + len + 90);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Case-insensitive full-text search over indexed books. */
export async function searchText(query: string, limitPerBook = 4): Promise<TextHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const indexes = await allTextIndexes();
  const hits: TextHit[] = [];
  for (const idx of indexes) {
    let taken = 0;
    for (const section of idx.sections) {
      const haystack = section.text.toLowerCase();
      let from = 0;
      while (taken < limitPerBook) {
        const at = haystack.indexOf(q, from);
        if (at === -1) break;
        hits.push({
          bookId: idx.bookId,
          label: section.label,
          href: section.href,
          snippet: snippetAround(section.text, at, q.length),
          index: at,
        });
        taken += 1;
        from = at + q.length;
      }
      if (taken >= limitPerBook) break;
    }
  }
  return hits;
}
