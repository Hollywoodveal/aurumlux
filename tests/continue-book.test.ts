import { describe, expect, test } from "bun:test";
import { pickContinueBook } from "@/lib/continue-book";
import type { BookMeta } from "@/lib/db";

const book = (id: string, lastOpened: number, status: BookMeta["status"]) =>
  ({ id, lastOpened, status }) as BookMeta;

describe("pickContinueBook", () => {
  test("picks the most recently opened book you're reading", () => {
    const books = [
      book("a", 100, "reading"),
      book("b", 300, "finished"),
      book("c", 200, "reading"),
    ];
    expect(pickContinueBook(books)?.id).toBe("c");
  });
  test("falls back to the last opened book when none are in progress", () => {
    expect(pickContinueBook([book("a", 5, "finished")])?.id).toBe("a");
  });
  test("nothing opened yet", () => {
    expect(pickContinueBook([book("a", 0, "want")])).toBeNull();
  });
});
