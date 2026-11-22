/**
 * Pure merge rules for combining one device's library records with another's.
 * Kept free of storage code so they can be unit-tested.
 */
import type { Annotation, BookMeta, ReadingSession, Tombstone } from "./db";

const MAX_SESSIONS = 400;

function mergeSessions(
  a: ReadingSession[] = [],
  b: ReadingSession[] = [],
): ReadingSession[] {
  const byId = new Map<string, ReadingSession>();
  for (const s of [...a, ...b]) {
    const seen = byId.get(s.id);
    // The same session saved twice (it's re-saved while reading): keep the
    // longer copy.
    if (!seen || s.end > seen.end) byId.set(s.id, s);
  }
  return [...byId.values()]
    .sort((x, y) => x.start - y.start)
    .slice(-MAX_SESSIONS);
}

function sameSessions(a: ReadingSession[] = [], b: ReadingSession[] = []) {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.id === b[i]?.id && s.end === b[i]?.end);
}

/**
 * Combine this device's copy of a book with another device's.
 *
 * - Reading position and status follow whichever device opened it last.
 * - Reading sessions and read days are unioned, so neither device loses history.
 * - Reading time keeps the larger total.
 * - Everything else (metadata, rating, shelves) stays as this device has it.
 *
 * Returns null when the incoming copy adds nothing.
 */
export function mergeBook(mine: BookMeta, incoming: BookMeta): BookMeta | null {
  const theirsNewer = (incoming.lastOpened ?? 0) > (mine.lastOpened ?? 0);
  const sessions = mergeSessions(mine.sessions, incoming.sessions);
  const readDays = [...new Set([...mine.readDays, ...incoming.readDays])].sort(
    (a, b) => a - b,
  );
  const readingTime = Math.max(
    mine.readingTime ?? 0,
    incoming.readingTime ?? 0,
  );

  const changed =
    theirsNewer ||
    !sameSessions(mine.sessions, sessions) ||
    readDays.length !== mine.readDays.length ||
    readingTime !== mine.readingTime;
  if (!changed) return null;

  return {
    ...mine,
    sessions,
    readDays,
    readingTime,
    ...(theirsNewer
      ? {
          progress: incoming.progress,
          location: incoming.location,
          chapter: incoming.chapter,
          lastOpened: incoming.lastOpened,
          status: incoming.status,
          finishedAt: incoming.finishedAt ?? mine.finishedAt,
          rereadCount: Math.max(
            mine.rereadCount ?? 0,
            incoming.rereadCount ?? 0,
          ),
        }
      : {}),
  };
}

export function mergeTombstones(a: Tombstone[] = [], b: Tombstone[] = []) {
  const byId = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    const seen = byId.get(t.id);
    if (!seen || t.at > seen.at) byId.set(t.id, t);
  }
  return [...byId.values()].sort((x, y) => x.at - y.at).slice(-2000);
}

export type LibraryState = {
  books: BookMeta[];
  annotations: Annotation[];
  deletedBooks: Tombstone[];
  deletedAnnotations: Tombstone[];
};

export type LibraryPlan = {
  /** Books to write (new placeholders or merged records). */
  putBooks: BookMeta[];
  /** Books deleted on the other device after they were last opened here. */
  deleteBooks: string[];
  putAnnotations: Annotation[];
  deleteAnnotations: string[];
  deletedBooks: Tombstone[];
  deletedAnnotations: Tombstone[];
  report: {
    positions: number;
    added: number;
    removed: number;
    annotations: number;
  };
};

/** Work out what has to change locally to take in another device's library. */
export function planMerge(
  local: LibraryState,
  remote: LibraryState,
): LibraryPlan {
  const deletedBooks = mergeTombstones(local.deletedBooks, remote.deletedBooks);
  const deletedAnnotations = mergeTombstones(
    local.deletedAnnotations,
    remote.deletedAnnotations,
  );
  const bookTomb = new Map(deletedBooks.map((t) => [t.id, t.at]));
  const noteTomb = new Set(deletedAnnotations.map((t) => t.id));
  const mine = new Map(local.books.map((b) => [b.id, b]));

  const plan: LibraryPlan = {
    putBooks: [],
    deleteBooks: [],
    putAnnotations: [],
    deleteAnnotations: [],
    deletedBooks,
    deletedAnnotations,
    report: { positions: 0, added: 0, removed: 0, annotations: 0 },
  };

  for (const b of local.books) {
    const at = bookTomb.get(b.id);
    // Deleted elsewhere, and not opened here since: remove it here too.
    if (
      at !== undefined &&
      at >= (b.lastOpened ?? 0) &&
      at >= (b.addedAt ?? 0)
    ) {
      plan.deleteBooks.push(b.id);
      plan.report.removed += 1;
    }
  }
  const removed = new Set(plan.deleteBooks);

  for (const incoming of remote.books) {
    if (removed.has(incoming.id)) continue;
    const local = mine.get(incoming.id);
    if (!local) {
      const at = bookTomb.get(incoming.id);
      if (at !== undefined && at >= (incoming.lastOpened ?? 0)) continue;
      // Arrives as a placeholder: the book file itself stays on the other
      // device until it's imported here too.
      plan.putBooks.push({ ...incoming, hasCover: false });
      plan.report.added += 1;
      continue;
    }
    const merged = mergeBook(local, incoming);
    if (merged) {
      plan.putBooks.push(merged);
      if (merged.lastOpened !== local.lastOpened) plan.report.positions += 1;
    }
  }

  // Annotations only make sense for books that will be on this device.
  const keptBooks = new Set([
    ...local.books.map((b) => b.id).filter((id) => !removed.has(id)),
    ...plan.putBooks.map((b) => b.id),
  ]);
  const seen = new Set(local.annotations.map((a) => a.id));
  for (const a of local.annotations) {
    if (noteTomb.has(a.id) || removed.has(a.bookId))
      plan.deleteAnnotations.push(a.id);
  }
  for (const a of remote.annotations) {
    if (seen.has(a.id) || noteTomb.has(a.id) || !keptBooks.has(a.bookId))
      continue;
    plan.putAnnotations.push(a);
    plan.report.annotations += 1;
  }
  return plan;
}
