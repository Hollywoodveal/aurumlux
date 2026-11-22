// Cover regression test (runs in CI after the smoke test): import books whose files carry real cover images (EPUB 2
// <meta name="cover">, EPUB 3 cover-image, CBZ, PDF) and verify every view
// shows the image, before and after a reload. Usage:
// node tests/e2e/covers.mjs <dist/client> <playwright> <jszip> <engine>
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";

const [root, playwrightPath, jszipPath, engine = "chromium"] =
  process.argv.slice(2);
const require = createRequire(import.meta.url);
const pw = require(playwrightPath);
const JSZip = require(jszipPath);

// --- tiny PNG encoder (solid colour with a stripe) -------------------------
function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const stripe = y > h * 0.4 && y < h * 0.55;
      raw[o] = stripe ? 240 : r;
      raw[o + 1] = stripe ? 210 : g;
      raw[o + 2] = stripe ? 120 : b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function epub(title, kind, color) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  // Where the image lives and how the OPF points at it, per variant.
  const img = {
    epub2: ["images/cover.png", "OEBPS/images/cover.png"],
    epub3: ["images/cover.png", "OEBPS/images/cover.png"],
    subdir: ["../Images/front.png", "Images/front.png"],
    metahref: ["images/img001.png", "OEBPS/images/img001.png"],
    guide: ["images/img002.png", "OEBPS/images/img002.png"],
    titlepage: ["images/pic.png", "OEBPS/images/pic.png"],
  }[kind];
  const meta =
    {
      epub2: `<meta name="cover" content="cimg"/>`,
      subdir: `<meta name="cover" content="cimg"/>`,
      metahref: `<meta name="cover" content="images/img001.png"/>`,
    }[kind] ?? "";
  const props = kind === "epub3" ? ` properties="cover-image"` : "";
  const guide =
    kind === "guide"
      ? `<guide><reference type="cover" title="Cover" href="Text/cover.xhtml"/></guide>`
      : "";
  const firstPage = kind === "titlepage" ? `<itemref idref="tp"/>` : "";
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:c:${title}</dc:identifier><dc:title>${title}</dc:title><dc:creator>Cover Tester</dc:creator><dc:language>en</dc:language>${meta}</metadata><manifest><item id="cimg" href="${img[0]}" media-type="image/png"${props}/><item id="tp" href="Text/title.xhtml" media-type="application/xhtml+xml"/><item id="cv" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${firstPage}<itemref idref="c1"/></spine>${guide}</package>`,
  );
  zip.file(
    "OEBPS/Text/cover.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><title>Cover</title></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"><image xlink:href="../${img[0]}" width="300" height="450"/></svg></body></html>`,
  );
  zip.file(
    "OEBPS/Text/title.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body><div><img src="../${img[0]}" alt=""/></div></body></html>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>`,
  );
  zip.file(
    "OEBPS/c1.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>Hello.</p></body></html>`,
  );
  zip.file(img[1], png(300, 450, color));
  return zip.generateAsync({ type: "nodebuffer" });
}
async function cbz(title, color) {
  const zip = new JSZip();
  zip.file("__MACOSX/._001.png", Buffer.from("not an image"));
  zip.file("001.png", png(300, 450, color));
  zip.file("002.png", png(300, 450, [20, 20, 20]));
  return zip.generateAsync({ type: "nodebuffer" });
}

const palette = [
  [120, 30, 40],
  [30, 90, 60],
  [30, 50, 120],
  [90, 40, 110],
  [140, 90, 20],
  [20, 100, 110],
];
const files = [];
const kinds = ["epub2", "epub3", "subdir", "metahref", "guide", "titlepage"];
for (let i = 0; i < 66; i++) {
  const kind = kinds[i % 3];
  const title = `Cover ${String(i + 1).padStart(2, "0")} ${kind}`;
  files.push({
    name: `${title}.epub`,
    mimeType: "application/epub+zip",
    buffer: await epub(title, kind, palette[i % 6]),
  });
}
for (let i = 0; i < 4; i++) {
  files.push({
    name: `Cover Comic ${i + 1}.cbz`,
    mimeType: "application/vnd.comicbook+zip",
    buffer: await cbz(`Comic ${i}`, palette[i]),
  });
}

// --- static server with the real headers -----------------------------------
function parseHeaders(file) {
  const rules = [];
  let cur = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      cur = { pattern: line.trim(), headers: {} };
      rules.push(cur);
    } else if (cur) {
      const i = line.indexOf(":");
      cur.headers[line.slice(0, i).trim().toLowerCase()] = line
        .slice(i + 1)
        .trim();
    }
  }
  return rules;
}
const headerRules = parseHeaders(join(root, "_headers"));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".wasm": "application/wasm",
};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let file = join(root, decodeURIComponent(url.pathname));
  if (!existsSync(file) || statSync(file).isDirectory())
    file = join(root, "index.html");
  const headers = {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
  };
  for (const rule of headerRules) {
    const re = new RegExp(
      `^${rule.pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    if (re.test(url.pathname)) Object.assign(headers, rule.headers);
  }
  res.writeHead(200, headers);
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4190, "127.0.0.1", r));
const BASE = "http://127.0.0.1:4190";
mkdirSync("cover-shots", { recursive: true });

const browser = await pw[engine].launch();
console.log(`[${engine}] browser ${browser.version()}`);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(20000);
const logs = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") logs.push(m.text());
});
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) =>
  console.log(
    `[${engine}] request failed: ${r.url()} ${r.failure()?.errorText}`,
  ),
);

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.locator("h1").first().waitFor({ timeout: 60000 });
await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open("aurum");
      open.onsuccess = () => {
        const tx = open.result.transaction("settings", "readwrite");
        tx.objectStore("settings").put(true, "onboardingSeen");
        tx.oncomplete = () => {
          open.result.close();
          resolve(null);
        };
      };
    }),
);
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator("h1").first().waitFor();
await page
  .locator('input[type="file"][accept*=".epub"]')
  .first()
  .setInputFiles(files);
await page.waitForTimeout(20000);

const db = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open("aurum");
      open.onsuccess = () => {
        const tx = open.result.transaction(["books", "covers"]);
        const books = tx.objectStore("books").getAll();
        const keys = tx.objectStore("covers").getAllKeys();
        tx.oncomplete = () => {
          const k = new Set(keys.result);
          resolve(
            books.result.map((b) => ({
              t: b.title,
              has: b.hasCover,
              stored: k.has(b.id),
            })),
          );
          open.result.close();
        };
      };
    }),
);
let failures = 0;
const noCover = db.filter((b) => !b.has || !b.stored);
failures += noCover.length;
console.log(
  `[${engine}] imported ${db.length}; without a stored cover: ${noCover.length}`,
);
for (const b of noCover.slice(0, 10))
  console.log(`   ${b.t} hasCover=${b.has} stored=${b.stored}`);

async function checkView(label) {
  // Scroll through the whole page so every lazy image gets a chance to load.
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img[alt^="Cover of "]')];
    const broken = imgs
      .filter((i) => !i.complete || i.naturalWidth === 0)
      .map((i) => i.alt);
    const fallbacks = [
      ...document.querySelectorAll("main span.font-display.text-gold"),
    ].length;
    return { imgs: imgs.length, broken, fallbacks };
  });
  console.log(
    `[${engine}] ${label}: ${r.imgs} cover images, ${r.broken.length} not loaded, ${r.fallbacks} text fallbacks`,
  );
  failures += r.broken.length + r.fallbacks;
  if (r.broken.length)
    console.log(`   e.g. ${r.broken.slice(0, 5).join(" | ")}`);
}
async function spines(label) {
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(150);
  }
  const r = await page.evaluate(() => {
    const sp = [...document.querySelectorAll('button[aria-label^="Cover "]')];
    const withImg = sp.filter(
      (b) =>
        b.querySelector("img") ||
        /url\(/.test(
          getComputedStyle(b).backgroundImage +
            [...b.querySelectorAll("*")]
              .map((e) => getComputedStyle(e).backgroundImage)
              .join(" "),
        ),
    );
    return { total: sp.length, withImg: withImg.length };
  });
  console.log(
    `[${engine}] ${label}: ${r.total} spines, ${r.withImg} showing cover art`,
  );
  failures += r.total - r.withImg;
}

for (const pass of ["fresh", "after reload"]) {
  if (pass === "after reload") {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await spines(`${pass} shelf`);
  for (const view of ["Grid", "List", "Compact"]) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const btn = page
      .getByRole("button", { name: new RegExp(`^${view}`, "i") })
      .first();
    if (await btn.count()) await btn.click();
    await page.waitForTimeout(500);
    if (view === "Compact") await spines(`${pass} ${view.toLowerCase()}`);
    else await checkView(`${pass} ${view.toLowerCase()}`);
    await page.screenshot({
      path: `cover-shots/${engine}-${pass.replace(" ", "-")}-${view}.png`,
    });
  }
  const shelf = page.getByRole("button", { name: /^Shelf/i }).first();
  if (await shelf.count()) await shelf.click();
}
console.log(`[${engine}] console errors: ${logs.length}`);
for (const l of [...new Set(logs)].slice(0, 10))
  console.log(`   ${l.slice(0, 200)}`);
await browser.close();
server.close();
if (failures > 0) {
  console.log(`✗ ${failures} cover problem(s)`);
  process.exit(1);
}
console.log("✓ every book shows its cover in every view");
