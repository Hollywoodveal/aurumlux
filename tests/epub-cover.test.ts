import { expect, test } from "bun:test";
import { mimeForPath, resolveZipPath } from "@/lib/epub-cover";

test("resolves hrefs relative to the OPF folder", () => {
  expect(resolveZipPath("OEBPS/", "images/cover.jpg")).toBe(
    "OEBPS/images/cover.jpg",
  );
  expect(resolveZipPath("OEBPS/", "../Images/front.png")).toBe(
    "Images/front.png",
  );
  expect(resolveZipPath("OEBPS/Text/", "./../Images/a%20b.jpg")).toBe(
    "OEBPS/Images/a b.jpg",
  );
  expect(resolveZipPath("", "cover.jpeg#frag")).toBe("cover.jpeg");
  expect(resolveZipPath("OEBPS/", "/root.png")).toBe("root.png");
});

test("image types from file names", () => {
  expect(mimeForPath("a/B.JPG")).toBe("image/jpeg");
  expect(mimeForPath("x.webp")).toBe("image/webp");
  expect(mimeForPath("x.svg")).toBe("image/svg+xml");
});
