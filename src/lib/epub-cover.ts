/**
 * Finding the cover image inside an EPUB. Publishers mark covers in several
 * ways, so this tries them in order of reliability:
 *
 * 1. EPUB 2 `<meta name="cover" content="…">` — usually an item id, sometimes
 *    an href or a differently-cased id.
 * 2. EPUB 3 manifest item with `properties="cover-image"`.
 * 3. The `<guide>` cover / title-page reference, either an image or a page
 *    whose first <img> / SVG <image> is the cover.
 * 4. The first page in the reading order, when it's essentially one picture.
 * 5. An image whose file name or id says "cover" or "front".
 */
import type JSZip from "jszip";

type Zip = JSZip;
type ZipEntry = JSZip.JSZipObject;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;

/**
 * Elements with this local name, whatever namespace prefix the file uses.
 * EPUB files often bind the OPF namespace to a prefix (ns0:item) instead of
 * the default namespace, and getElementsByTagName("item") then finds nothing,
 * so the cover, the spine and the page count all silently come back empty.
 */
export function elementsNamed(doc: Document, tag: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS("*", tag));
}

/** Resolve an href against a directory inside the zip ("a/b/" + "../c.png" → "a/c.png"). */
export function resolveZipPath(dir: string, href: string): string {
  let clean = href.split("#")[0]?.split("?")[0] ?? "";
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* keep as is */
  }
  const parts = (clean.startsWith("/") ? clean.slice(1) : dir + clean).split(
    "/",
  );
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

export function mimeForPath(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return (
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
      bmp: "image/bmp",
      svg: "image/svg+xml",
    }[ext] ?? "application/octet-stream"
  );
}

function fileIn(zip: Zip, path: string): ZipEntry | null {
  if (!path) return null;
  const direct = zip.file(path);
  if (direct) return direct;
  // Some zips differ in case from what the OPF says.
  const lower = path.toLowerCase();
  const match = Object.keys(zip.files).find((k) => k.toLowerCase() === lower);
  return match ? zip.file(match) : null;
}

const dirOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";

/** First picture referenced by an (X)HTML or SVG page. */
async function imageInPage(
  zip: Zip,
  pagePath: string,
  maxText = Infinity,
): Promise<string | null> {
  const page = fileIn(zip, pagePath);
  if (!page) return null;
  const doc = new DOMParser().parseFromString(
    await page.async("string"),
    "application/xhtml+xml",
  );
  const body = elementsNamed(doc, "body")[0] ?? doc.documentElement;
  if ((body?.textContent ?? "").trim().length > maxText) return null;
  const img = elementsNamed(doc, "img")[0];
  const svgImage = elementsNamed(doc, "image")[0];
  const src =
    img?.getAttribute("src") ??
    svgImage?.getAttribute("href") ??
    svgImage?.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
    svgImage?.getAttribute("xlink:href") ??
    null;
  return src ? resolveZipPath(dirOf(pagePath), src) : null;
}

export async function findEpubCover(
  zip: Zip,
  opf: Document,
  opfDir: string,
): Promise<{ entry: ZipEntry; path: string } | null> {
  const items = elementsNamed(opf, "item");
  const hrefOf = (el: Element | undefined) =>
    el ? resolveZipPath(opfDir, el.getAttribute("href") ?? "") : "";
  const isImage = (el: Element) =>
    (el.getAttribute("media-type") ?? "").startsWith("image/") ||
    IMAGE_EXT.test(el.getAttribute("href") ?? "");
  const found = (path: string) => {
    const entry = IMAGE_EXT.test(path) ? fileIn(zip, path) : null;
    return entry ? { entry, path } : null;
  };

  // 1. <meta name="cover">
  const metaCover = elementsNamed(opf, "meta").find(
    (m) => (m.getAttribute("name") ?? "").toLowerCase() === "cover",
  );
  const metaContent = metaCover?.getAttribute("content")?.trim() ?? "";
  if (metaContent) {
    const byId =
      items.find((i) => i.getAttribute("id") === metaContent) ??
      items.find(
        (i) =>
          (i.getAttribute("id") ?? "").toLowerCase() ===
          metaContent.toLowerCase(),
      );
    const hit =
      (byId && isImage(byId) ? found(hrefOf(byId)) : null) ??
      found(resolveZipPath(opfDir, metaContent));
    if (hit) return hit;
  }

  // 2. EPUB 3 cover-image
  const prop = items.find((i) =>
    (i.getAttribute("properties") ?? "").split(/\s+/).includes("cover-image"),
  );
  const propHit = prop ? found(hrefOf(prop)) : null;
  if (propHit) return propHit;

  // 3. <guide><reference type="cover">
  const refs = elementsNamed(opf, "reference");
  const guide =
    refs.find(
      (r) => (r.getAttribute("type") ?? "").toLowerCase() === "cover",
    ) ??
    refs.find(
      (r) => (r.getAttribute("type") ?? "").toLowerCase() === "title-page",
    );
  if (guide) {
    const path = resolveZipPath(opfDir, guide.getAttribute("href") ?? "");
    const hit = found(path) ?? found((await imageInPage(zip, path)) ?? "");
    if (hit) return hit;
  }

  // 4. First page in reading order, if it's essentially a single picture.
  const firstRef = elementsNamed(opf, "itemref")[0]?.getAttribute("idref");
  const firstItem = items.find((i) => i.getAttribute("id") === firstRef);
  if (firstItem && !isImage(firstItem)) {
    const hit = found((await imageInPage(zip, hrefOf(firstItem), 200)) ?? "");
    if (hit) return hit;
  }

  // 5. An image named like a cover.
  const named = items.find(
    (i) =>
      isImage(i) &&
      /cover|front/i.test(
        `${i.getAttribute("href") ?? ""} ${i.getAttribute("id") ?? ""}`,
      ),
  );
  return named ? found(hrefOf(named)) : null;
}

/** The cover as a Blob with a proper image type (Safari is pickier without one). */
export async function coverBlob(hit: { entry: ZipEntry; path: string }) {
  return new Blob([await hit.entry.async("arraybuffer")], {
    type: mimeForPath(hit.path),
  });
}
