import { describe, expect, test } from "bun:test";
import { bookStatus } from "@/components/BookBadge";
import { chapterLeftLabel, PagePace } from "@/lib/chapter-pace";
import { buildNotesMarkdown, notesFileName } from "@/lib/export-notes";
import { friendlyHttpError } from "@/lib/net";
import { book, note } from "./fixtures";

describe("friendlyHttpError", () => {
  test("a relay block says what to do instead", () => {
    const msg = friendlyHttpError(503, { kind: "catalog", viaRelay: true });
    expect(msg).toContain("blocks downloads through Aurum");
    expect(msg).toContain("Add books");
  });
  test("a web page instead of a catalog", () => {
    expect(friendlyHttpError(415, { kind: "catalog" })).toContain("web page");
  });
  test("sign-in problems", () => {
    expect(friendlyHttpError(401, { kind: "catalog" })).toContain("sign in");
    expect(
      friendlyHttpError(403, { kind: "catalog", signedIn: true }),
    ).toContain("didn't accept");
  });
  test("missing address", () => {
    expect(friendlyHttpError(404, { kind: "book" })).toContain(
      "Nothing was found",
    );
  });
  test("never a bare status code for common errors", () => {
    for (const s of [401, 403, 404, 413, 415, 429, 500, 502, 503])
      expect(friendlyHttpError(s, { kind: "catalog" })).not.toContain("(error");
  });
});

describe("bookStatus", () => {
  const now = 10 * 86_400_000;
  test("placeholder without a file", () => {
    expect(bookStatus(book({ id: "x" }), new Set(["x"]), now)).toBe("missing");
  });
  test("fresh import is new", () => {
    expect(
      bookStatus(
        book({ addedAt: now - 1000, lastOpened: 0, progress: 0 }),
        new Set(),
        now,
      ),
    ).toBe("new");
  });
  test("opened or old books have no badge", () => {
    expect(
      bookStatus(
        book({ addedAt: now - 1000, lastOpened: now }),
        new Set(),
        now,
      ),
    ).toBeNull();
    expect(
      bookStatus(
        book({ addedAt: 0, lastOpened: 0, progress: 0 }),
        new Set(),
        now,
      ),
    ).toBeNull();
  });
});

describe("chapter pace", () => {
  test("pages left without pace", () => {
    expect(chapterLeftLabel(3, 10, null)).toBe("7 pages left in chapter");
    expect(chapterLeftLabel(10, 10, null)).toBe("Last page of the chapter");
    expect(chapterLeftLabel(undefined, 10, null)).toBeNull();
  });
  test("adds minutes once the pace is known", () => {
    const pace = new PagePace();
    let t = 0;
    for (let i = 0; i < 5; i += 1) {
      pace.turn(t);
      t += 30_000;
    }
    expect(pace.msPerPage()).toBe(30_000);
    expect(chapterLeftLabel(2, 10, pace.msPerPage())).toBe(
      "8 pages left in chapter · about 4 min",
    );
  });
  test("ignores flicking and long breaks", () => {
    const pace = new PagePace();
    [0, 500, 1000, 1_000_000, 1_000_400].forEach((t) => pace.turn(t));
    expect(pace.msPerPage()).toBeNull();
  });
});

describe("buildNotesMarkdown", () => {
  const books = [
    book({ id: "a", title: "Emma", author: "Jane Austen" }),
    book({ id: "b", title: "Dracula" }),
  ];
  const notes = [
    {
      ...note("1", "a"),
      text: "A line worth keeping.",
      note: "Love this",
      label: "Chapter 1",
    },
    {
      ...note("2", "a"),
      type: "bookmark" as const,
      text: "",
      label: "Chapter 3",
    },
    { ...note("3", "b"), text: "Listen to them." },
  ];
  test("whole library", () => {
    const md = buildNotesMarkdown(books, notes, {
      now: new Date("2026-11-22T00:00:00Z"),
    });
    expect(md).toContain("# Reading notes");
    expect(md).toContain("2026-11-22");
    expect(md.indexOf("## Dracula")).toBeLessThan(md.indexOf("## Emma"));
    expect(md).toContain("> A line worth keeping.");
    expect(md).toContain("**Note:** Love this");
    expect(md).toContain("🔖 Bookmark — Chapter 3");
  });
  test("one book", () => {
    const md = buildNotesMarkdown(books, notes, { bookId: "a" });
    expect(md.startsWith("## Emma")).toBe(true);
    expect(md).not.toContain("Dracula");
  });
  test("file names are safe", () => {
    expect(notesFileName(book({ title: 'A/B: "C"' }))).toBe("A B C.md");
  });
});
