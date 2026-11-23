import { expect, test } from "bun:test";
import { emptyBook, isFallbackPageCount, repairPatch } from "@/lib/importer";

test("spots page counts that are only the old size-based estimate", () => {
  // The four books that showed the wrong count in Aurum: each count is
  // exactly its file size / 2200.
  expect(isFallbackPageCount(1002, 2204454)).toBe(true); // Caste
  expect(isFallbackPageCount(2853, 6275508)).toBe(true); // Black Man, White House
  expect(isFallbackPageCount(11706, 25753159)).toBe(true); // Africa's Struggle for Its Art
  expect(isFallbackPageCount(1513, 3329659)).toBe(true); // A Hubert Harrison Reader
  // A real count is not the estimate, and neither is an empty one.
  expect(isFallbackPageCount(458, 2204454)).toBe(false);
  expect(isFallbackPageCount(0, 2204454)).toBe(false);
  expect(isFallbackPageCount(1002, 0)).toBe(false);
});

test("repairPatch takes the cover from the file when the book has none", () => {
  const book = { ...emptyBook(), hasCover: false };
  const probe = { ...emptyBook(), hasCover: true };
  const { patch, cover } = repairPatch(book, probe);
  expect(patch.hasCover).toBe(true);
  expect(cover).toBe(true);
});

test("repairPatch leaves a book that already has a cover alone", () => {
  const book = { ...emptyBook(), hasCover: true };
  const probe = { ...emptyBook(), hasCover: true };
  const { patch, cover } = repairPatch(book, probe);
  expect(patch.hasCover).toBeUndefined();
  expect(cover).toBe(false);
});

test("repairPatch replaces a fallback page count with the recount", () => {
  const book = { ...emptyBook(), pageCount: 1002, fileSize: 2204454 };
  const probe = { ...emptyBook(), pageCount: 458 };
  const { patch, pages } = repairPatch(book, probe);
  expect(patch.pageCount).toBe(458);
  expect(pages).toBe(true);
});

test("repairPatch never overwrites a real page count", () => {
  const book = { ...emptyBook(), pageCount: 458, fileSize: 2204454 };
  const probe = { ...emptyBook(), pageCount: 500 };
  const { patch, pages } = repairPatch(book, probe);
  expect(patch.pageCount).toBeUndefined();
  expect(pages).toBe(false);
});

test("repairPatch ignores a recount of zero", () => {
  const book = { ...emptyBook(), pageCount: 1002, fileSize: 2204454 };
  const probe = { ...emptyBook(), pageCount: 0 };
  const { patch, pages } = repairPatch(book, probe);
  expect(patch.pageCount).toBeUndefined();
  expect(pages).toBe(false);
});

test("repairPatch fills blank details from the file, and only blanks", () => {
  const book = {
    ...emptyBook(),
    author: "",
    publisher: "HarperCollins",
    isbn: "",
  };
  const probe = {
    ...emptyBook(),
    author: "George Jackson",
    publisher: "Black Classic Press",
    isbn: "9780933121232",
  };
  const { patch, details } = repairPatch(book, probe);
  expect(patch.author).toBe("George Jackson");
  expect(patch.isbn).toBe("9780933121232");
  expect(patch.publisher).toBeUndefined();
  expect(details).toBe(true);
});

test("repairPatch never touches a locked field", () => {
  const book = { ...emptyBook(), author: "", locked: ["author"] };
  const probe = { ...emptyBook(), author: "George Jackson" };
  const { patch, details } = repairPatch(book, probe);
  expect(patch.author).toBeUndefined();
  expect(details).toBe(false);
});

test("repairPatch returns an empty patch when nothing needs fixing", () => {
  const book = {
    ...emptyBook(),
    hasCover: true,
    author: "Isabel Wilkerson",
    pageCount: 458,
    fileSize: 2204454,
  };
  const probe = { ...emptyBook(), hasCover: true, pageCount: 458 };
  const { patch, cover, pages, details } = repairPatch(book, probe);
  expect(patch).toEqual({});
  expect(cover).toBe(false);
  expect(pages).toBe(false);
  expect(details).toBe(false);
});
