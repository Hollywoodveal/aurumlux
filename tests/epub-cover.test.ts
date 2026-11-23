import { expect, test } from "bun:test";
import JSZip from "jszip";
import { DOMParser as XDOMParser } from "@xmldom/xmldom";
import {
  elementsNamed,
  findEpubCover,
  mimeForPath,
  resolveZipPath,
} from "@/lib/epub-cover";

// The app runs in a browser; bun has no DOMParser, so the tests bring one.
(globalThis as unknown as { DOMParser: unknown }).DOMParser = XDOMParser;

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

// Four books shipped with covers the app could not see: their OPF binds the
// OPF namespace to a prefix (ns0:item) instead of the default namespace, and
// getElementsByTagName("item") then finds nothing. These tests pin the fix.
function opfDoc(prefixed: boolean, meta: string, props: string, guide: string) {
  const p = (t: string) => (prefixed ? `ns0:${t}` : t);
  const ns = prefixed
    ? `xmlns:ns0="http://www.idpf.org/2007/opf"`
    : `xmlns="http://www.idpf.org/2007/opf"`;
  const xml = `<?xml version="1.0"?><${p("package")} ${ns} xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="id"><${p("metadata")}><dc:title>Prefixed</dc:title><dc:creator>Tester</dc:creator>${meta}</${p("metadata")}><${p("manifest")}><${p("item")} id="cimg" href="images/cover.jpg" media-type="image/jpeg"${props}/><${p("item")} id="cv" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><${p("item")} id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></${p("manifest")}><${p("spine")}><${p("itemref")} idref="c1"/></${p("spine")}>${guide}</${p("package")}>`;
  return new XDOMParser().parseFromString(
    xml,
    "application/xml",
  ) as unknown as Document;
}

async function epubZip(
  prefixed: boolean,
  meta: string,
  props: string,
  guide: string,
) {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/Text/cover.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body><div><img src="../images/cover.jpg" alt=""/></div></body></html>`,
  );
  zip.file(
    "OEBPS/c1.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>Hello.</p></body></html>`,
  );
  zip.file("OEBPS/images/cover.jpg", Buffer.from("fake-jpeg-bytes"));
  return { zip, opf: opfDoc(prefixed, meta, props, guide) };
}

test("elementsNamed finds elements under a namespace prefix", () => {
  const doc = opfDoc(true, `<ns0:meta name="cover" content="cimg"/>`, "", "");
  expect(elementsNamed(doc, "meta").length).toBe(1);
  expect(elementsNamed(doc, "item").length).toBe(3);
  expect(elementsNamed(doc, "package").length).toBe(1);
});

test("findEpubCover follows <meta name=cover> in a prefixed OPF", async () => {
  const { zip, opf } = await epubZip(
    true,
    `<ns0:meta name="cover" content="cimg"/>`,
    "",
    "",
  );
  const hit = await findEpubCover(zip, opf, "OEBPS/");
  expect(hit?.path).toBe("OEBPS/images/cover.jpg");
});

test("findEpubCover follows cover-image properties in a prefixed OPF", async () => {
  const { zip, opf } = await epubZip(true, "", ` properties="cover-image"`, "");
  const hit = await findEpubCover(zip, opf, "OEBPS/");
  expect(hit?.path).toBe("OEBPS/images/cover.jpg");
});

test("findEpubCover follows the guide cover reference in a prefixed OPF", async () => {
  const { zip, opf } = await epubZip(
    true,
    "",
    "",
    `<ns0:guide><ns0:reference type="cover" href="Text/cover.xhtml"/></ns0:guide>`,
  );
  const hit = await findEpubCover(zip, opf, "OEBPS/");
  expect(hit?.path).toBe("OEBPS/images/cover.jpg");
});

test("findEpubCover still works with a plain default-namespace OPF", async () => {
  const { zip, opf } = await epubZip(
    false,
    `<meta name="cover" content="cimg"/>`,
    "",
    "",
  );
  const hit = await findEpubCover(zip, opf, "OEBPS/");
  expect(hit?.path).toBe("OEBPS/images/cover.jpg");
});
