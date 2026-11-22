// TEMPORARY audit: accessibility scan (axe-core) and screenshots of the main
// screens in dark and light themes. Usage:
// node tests/e2e/audit.mjs <dist/client> <playwright> <jszip> <axe.min.js>
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";

const [root, playwrightPath, jszipPath, axePath] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(playwrightPath);
const JSZip = require(jszipPath);
const axeSource = readFileSync(axePath, "utf8");

async function makeEpub(title, author, body) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:t:${title}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>`);
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Chapter One</a></li></ol></nav></body></html>`);
  zip.file("OEBPS/c1.xhtml", `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body>${body}</body></html>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

const para = "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness. ".repeat(6);
const titles = [
  ["Pride and Prejudice", "Jane Austen"], ["Moby-Dick", "Herman Melville"], ["Dracula", "Bram Stoker"],
  ["Frankenstein", "Mary Shelley"], ["Jane Eyre", "Charlotte Brontë"], ["Middlemarch", "George Eliot"],
  ["The Odyssey", "Homer"], ["Great Expectations", "Charles Dickens"], ["Persuasion", "Jane Austen"],
  ["Wuthering Heights", "Emily Brontë"], ["The Time Machine", "H. G. Wells"], ["Little Women", "Louisa May Alcott"],
  ["Emma", "Jane Austen"], ["Ulysses", "James Joyce"], ["Walden", "Henry David Thoreau"],
  ["The Iliad", "Homer"], ["Treasure Island", "Robert Louis Stevenson"], ["Anna Karenina", "Leo Tolstoy"],
];
const books = await Promise.all(
  titles.map(async ([t, a]) => ({
    name: `${t}.epub`,
    mimeType: "application/epub+zip",
    buffer: await makeEpub(t, a, `<h1>Chapter One</h1><p>${para}</p><p>${para}</p><h2>Two</h2><p>${para}</p>`),
  })),
);

function parseHeaders(file) {
  const rules = []; let cur = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), headers: {} }; rules.push(cur); }
    else if (cur) { const i = line.indexOf(":"); cur.headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  }
  return rules;
}
const headerRules = parseHeaders(join(root, "_headers"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let file = join(root, decodeURIComponent(url.pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  const headers = { "content-type": TYPES[extname(file)] ?? "application/octet-stream" };
  for (const rule of headerRules) {
    const re = new RegExp(`^${rule.pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    if (re.test(url.pathname)) Object.assign(headers, rule.headers);
  }
  res.writeHead(200, headers); res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4180, r));
const BASE = "http://localhost:4180";
const shots = "audit-shots"; mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.setDefaultTimeout(15000);

// Cold-load network: what the library screen downloads.
const requests = [];
page.on("response", async (r) => {
  try {
    const len = Number(r.headers()["content-length"] ?? 0) || (await r.body()).length;
    requests.push([new URL(r.url()).pathname, len]);
  } catch { /* ignore */ }
});
await page.goto(BASE); await page.waitForLoadState("networkidle");
const total = requests.reduce((s, [, n]) => s + n, 0);
console.log(`COLD LOAD: ${requests.length} requests, ${(total / 1024).toFixed(0)} KB`);
for (const [p, n] of requests.sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${(n / 1024).toFixed(0).padStart(5)} KB ${p}`);

await page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open("aurum");
  open.onsuccess = () => { const tx = open.result.transaction("settings", "readwrite"); tx.objectStore("settings").put(true, "onboardingSeen"); tx.oncomplete = () => { open.result.close(); resolve(null); }; };
}));
await page.reload(); await page.waitForLoadState("networkidle");
await page.locator('input[type="file"][accept*=".epub"]').first().setInputFiles(books);
await page.waitForTimeout(8000);
await page.reload(); await page.waitForLoadState("networkidle");

async function axe(label) {
  await page.evaluate(axeSource);
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => x.target.join(" ") + " :: " + (x.failureSummary ?? "").split("\n").slice(1, 2).join("")) }));
  });
  console.log(`AXE ${label}: ${result.length} rule(s) violated`);
  for (const v of result) {
    console.log(`  [${v.impact}] ${v.id} (${v.n}) ${v.help}`);
    for (const s of v.sample) console.log(`      ${s.slice(0, 220)}`);
  }
}
async function shot(name) { await page.waitForTimeout(600); await page.screenshot({ path: `${shots}/${name}.png` }); }

for (const theme of ["dark", "light"]) {
  await page.evaluate((t) => localStorage.setItem("aurum.theme", t), theme);
  await page.goto(BASE); await page.waitForLoadState("networkidle");
  await shot(`${theme}-library`); await axe(`${theme} library`);
  await page.mouse.wheel(0, 900); await shot(`${theme}-library-scrolled`);
  await page.getByRole("button", { name: /Pride and Prejudice/ }).first().click();
  await shot(`${theme}-details`); await axe(`${theme} details sheet`);
  await page.getByRole("button", { name: /^(Read|Continue)/ }).first().click();
  await page.frameLocator("iframe").first().locator("body").waitFor();
  await page.waitForTimeout(1500);
  await page.mouse.click(195, 400);
  await shot(`${theme}-reader`); await axe(`${theme} reader`);
  for (const route of ["/notes", "/stats", "/settings", "/settings?tab=sync", "/settings?tab=privacy"]) {
    await page.goto(BASE + route); await page.waitForLoadState("networkidle");
    const name = `${theme}${route.replace(/[/?=]/g, "-")}`;
    await shot(name); await axe(`${theme} ${route}`);
  }
}
await browser.close(); server.close();
