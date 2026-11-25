import type { BookMeta } from "./db";

/** The book to reopen for "Continue reading": the last one you had open,
 *  preferring books you're still reading over finished ones. */
export function pickContinueBook(books: BookMeta[]): BookMeta | null {
  const opened = books.filter((b) => b.lastOpened > 0);
  const reading = opened.filter((b) => b.status === "reading");
  const pool = reading.length ? reading : opened;
  return [...pool].sort((a, b) => b.lastOpened - a.lastOpened)[0] ?? null;
}
