/**
 * Export highlights, bookmarks and notes as Markdown, for one book or the
 * whole library. Pure formatting lives in buildNotesMarkdown (unit-tested);
 * shareOrDownload hands the file to the share sheet or saves it.
 */
import type { Annotation, BookMeta } from "./db";

const KIND_ORDER: Record<Annotation["type"], number> = {
  highlight: 0,
  note: 1,
  bookmark: 2,
};

function quote(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function oneBook(book: BookMeta, notes: Annotation[]) {
  const lines: string[] = [`## ${book.title || "Untitled"}`];
  if (book.author) lines.push(`*${book.author}*`);
  lines.push("");
  const sorted = [...notes].sort(
    (a, b) =>
      KIND_ORDER[a.type] - KIND_ORDER[b.type] || a.createdAt - b.createdAt,
  );
  for (const a of sorted) {
    const where = a.label?.trim() ? ` — ${a.label.trim()}` : "";
    if (a.type === "bookmark") {
      lines.push(`- 🔖 Bookmark${where}`);
      continue;
    }
    if (a.text.trim()) {
      lines.push(quote(a.text));
      if (a.note.trim()) lines.push("");
    }
    if (a.note.trim()) lines.push(`**Note:** ${a.note.trim()}`);
    if (where) lines.push(`<sub>${where.slice(3)}</sub>`);
    lines.push("");
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildNotesMarkdown(
  books: BookMeta[],
  annotations: Annotation[],
  options: { bookId?: string; now?: Date } = {},
): string {
  const byBook = new Map<string, Annotation[]>();
  for (const a of annotations) {
    if (options.bookId && a.bookId !== options.bookId) continue;
    byBook.set(a.bookId, [...(byBook.get(a.bookId) ?? []), a]);
  }
  const included = books
    .filter((b) => byBook.has(b.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  const date = (options.now ?? new Date()).toISOString().slice(0, 10);
  const header = options.bookId
    ? []
    : [`# Reading notes`, ``, `Exported from Aurum on ${date}.`, ``];
  if (included.length === 0)
    return [...header, "_No highlights or notes yet._"].join("\n");
  return [
    ...header,
    included.map((b) => oneBook(b, byBook.get(b.id) ?? [])).join("\n\n---\n\n"),
    "",
  ].join("\n");
}

export function notesFileName(book?: BookMeta) {
  const base = book
    ? (book.title || "notes")
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80)
    : `aurum-notes-${new Date().toISOString().slice(0, 10)}`;
  return `${base || "notes"}.md`;
}

/** Offer the file to the share sheet (iPhone: Files, Notes, Mail…), else download it. */
export async function shareOrDownload(markdown: string, fileName: string) {
  const file = new File([markdown], fileName, { type: "text/markdown" });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName });
      return "shared" as const;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError")
        return "cancelled" as const;
      /* fall through to a download */
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded" as const;
}
