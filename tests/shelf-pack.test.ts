import { describe, expect, test } from "bun:test";
import { packShelves } from "@/lib/shelf-pack";

const w = (n: number) => n;

describe("packShelves", () => {
  test("falls back to fixed rows before the shelf is measured", () => {
    const rows = packShelves(Array(30).fill(40), 0, w, 3);
    expect(rows.map((r) => r.length)).toEqual([12, 12, 6]);
  });

  test("a wider shelf holds more books per row", () => {
    const books = Array(40).fill(40);
    const narrow = packShelves(books, 400, w, 3);
    const wide = packShelves(books, 700, w, 3);
    expect(wide[0].length).toBeGreaterThan(narrow[0].length);
  });

  test("rows never overflow and keep every book in order", () => {
    const books = [30, 52, 41, 28, 50, 44, 36, 52, 29, 47];
    const rows = packShelves(books, 160, w, 3);
    for (const row of rows) {
      const used = row.reduce((a, b) => a + b, 0) + 3 * (row.length - 1);
      expect(used).toBeLessThanOrEqual(160);
    }
    expect(rows.flat()).toEqual(books);
  });

  test("a book wider than the shelf still gets its own row", () => {
    expect(packShelves([80, 20], 50, w, 3)).toEqual([[80], [20]]);
  });
});
