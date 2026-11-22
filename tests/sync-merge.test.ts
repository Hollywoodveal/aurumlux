import { describe, expect, test } from "bun:test";
import {
  mergeBook,
  mergeTombstones,
  planMerge,
  type LibraryState,
} from "@/lib/sync-merge";
import { book, note, session } from "./fixtures";

const empty: LibraryState = {
  books: [],
  annotations: [],
  deletedBooks: [],
  deletedAnnotations: [],
};

describe("mergeBook", () => {
  test("newer position wins and history is combined", () => {
    const mine = book({
      lastOpened: 100,
      progress: 10,
      sessions: [session("a", 1, 50)],
      readDays: [1],
      readingTime: 5,
    });
    const theirs = book({
      lastOpened: 200,
      progress: 40,
      location: "cfi-b",
      sessions: [session("b", 60, 90)],
      readDays: [2],
      readingTime: 9,
    });
    const merged = mergeBook(mine, theirs);
    expect(merged?.progress).toBe(40);
    expect(merged?.location).toBe("cfi-b");
    expect(merged?.sessions?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(merged?.readDays).toEqual([1, 2]);
    expect(merged?.readingTime).toBe(9);
  });

  test("older copy keeps my position but adds its sessions", () => {
    const mine = book({ lastOpened: 300, progress: 60, sessions: [] });
    const theirs = book({
      lastOpened: 200,
      progress: 40,
      sessions: [session("b", 1, 2)],
    });
    const merged = mergeBook(mine, theirs);
    expect(merged?.progress).toBe(60);
    expect(merged?.sessions).toHaveLength(1);
  });

  test("same session saved twice keeps the longer copy", () => {
    const mine = book({ sessions: [session("a", 1, 50)] });
    const theirs = book({ sessions: [session("a", 1, 80)] });
    expect(mergeBook(mine, theirs)?.sessions?.[0]?.end).toBe(80);
  });

  test("returns null when nothing changes", () => {
    const b = book({ sessions: [session("a", 1, 2)], readDays: [1] });
    expect(mergeBook(b, { ...b })).toBeNull();
  });

  test("keeps my metadata", () => {
    const merged = mergeBook(
      book({ title: "Mine", lastOpened: 1 }),
      book({ title: "Theirs", lastOpened: 5 }),
    );
    expect(merged?.title).toBe("Mine");
  });
});

describe("planMerge", () => {
  test("unseen books arrive as placeholders with their notes", () => {
    const plan = planMerge(empty, {
      ...empty,
      books: [book({ id: "x" })],
      annotations: [note("n1", "x")],
    });
    expect(plan.putBooks.map((b) => b.id)).toEqual(["x"]);
    expect(plan.putBooks[0]?.hasCover).toBe(false);
    expect(plan.putAnnotations.map((a) => a.id)).toEqual(["n1"]);
    expect(plan.report.added).toBe(1);
  });

  test("a book deleted elsewhere is removed here, with its notes", () => {
    const plan = planMerge(
      {
        ...empty,
        books: [book({ id: "x", addedAt: 5, lastOpened: 10 })],
        annotations: [note("n1", "x")],
      },
      { ...empty, deletedBooks: [{ id: "x", at: 20 }] },
    );
    expect(plan.deleteBooks).toEqual(["x"]);
    expect(plan.deleteAnnotations).toEqual(["n1"]);
    expect(plan.report.removed).toBe(1);
  });

  test("a book opened here after it was deleted elsewhere is kept", () => {
    const plan = planMerge(
      { ...empty, books: [book({ id: "x", lastOpened: 30 })] },
      { ...empty, deletedBooks: [{ id: "x", at: 20 }] },
    );
    expect(plan.deleteBooks).toEqual([]);
  });

  test("a book I deleted isn't brought back", () => {
    const plan = planMerge(
      { ...empty, deletedBooks: [{ id: "x", at: 50 }] },
      {
        ...empty,
        books: [book({ id: "x", lastOpened: 10 })],
        annotations: [note("n1", "x")],
      },
    );
    expect(plan.putBooks).toEqual([]);
    expect(plan.putAnnotations).toEqual([]);
  });

  test("deleted annotations stay deleted on both sides", () => {
    const plan = planMerge(
      { ...empty, books: [book()], annotations: [note("keep"), note("gone")] },
      {
        ...empty,
        books: [book()],
        annotations: [note("gone2")],
        deletedAnnotations: [{ id: "gone", at: 1 }],
      },
    );
    expect(plan.deleteAnnotations).toEqual(["gone"]);
    expect(plan.putAnnotations.map((a) => a.id)).toEqual(["gone2"]);
  });

  test("tombstones keep the latest time per id", () => {
    expect(
      mergeTombstones(
        [{ id: "a", at: 1 }],
        [
          { id: "a", at: 5 },
          { id: "b", at: 2 },
        ],
      ),
    ).toEqual([
      { id: "b", at: 2 },
      { id: "a", at: 5 },
    ]);
  });
});
