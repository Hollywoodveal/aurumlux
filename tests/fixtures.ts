import type { Annotation, BookMeta, ReadingSession } from "@/lib/db";

export function book(overrides: Partial<BookMeta> = {}): BookMeta {
  return {
    id: "b1",
    title: "Persuasion",
    author: "Jane Austen",
    genre: "",
    description: "",
    isbn: "",
    publisher: "",
    publishedDate: "",
    language: "en",
    pageCount: 250,
    format: "epub",
    fileSize: 1000,
    series: "",
    rating: 0,
    notes: "",
    locked: [],
    status: "reading",
    favorite: false,
    progress: 10,
    location: "cfi-a",
    chapter: "Chapter 1",
    addedAt: 1_000,
    lastOpened: 2_000,
    finishedAt: null,
    rereadCount: 0,
    readingTime: 60_000,
    readDays: [],
    sessions: [],
    hasCover: true,
    ...overrides,
  };
}

export function session(
  id: string,
  start: number,
  end: number,
  extra: Partial<ReadingSession> = {},
): ReadingSession {
  return {
    id,
    start,
    end,
    progressStart: 0,
    progressEnd: 1,
    chapter: "",
    ...extra,
  };
}

export function note(id: string, bookId = "b1"): Annotation {
  return {
    id,
    bookId,
    type: "highlight",
    color: "gold",
    text: "a line",
    note: "",
    location: "cfi",
    label: "",
    createdAt: 1,
  };
}
