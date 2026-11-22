// Browser smoke test for the production build (run in CI; see ci.yml).
//
// Serves dist/client with the same headers Cloudflare Pages would apply
// (including the generated Content-Security-Policy) and a stand-in for the
// /api/fetch relay backed by a fake OPDS catalog and WebDAV server. Then, in
// Chromium, it checks that:
//   1. the app boots under the CSP with no violations or page errors,
//   2. an EPUB opens and renders, while a <script> inside it does NOT run,
//   3. the OPDS browser lists a catalog and downloads a book from it,
//   4. WebDAV sync uploads an encrypted file and can sync again (ETag path).
//
// Usage: node tests/e2e/smoke.mjs <dist/client> <path-to-playwright> <path-to-jszip>
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";

const [root, playwrightPath, jszipPath] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(playwrightPath);
const JSZip = require(jszipPath);

// ---------------------------------------------------------------- fixtures
async function makeEpub(title, body) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test:${title}</dc:identifier><dc:title>${title}</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Nav</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>`,
  );
  zip.file(
    "OEBPS/c1.xhtml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body>${body}</body></html>`,
  );
  return zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/epub+zip",
  });
}

const evilEpub = await makeEpub(
  "Script Test",
  `<p id="marker">Call me Ishmael.</p>
   <script>
     try { localStorage.setItem("pwned", "1"); } catch (e) {}
     try { parent.document.title = "PWNED"; } catch (e) {}
     try { indexedDB.open("aurum"); top.postMessage("pwned", "*"); } catch (e) {}
   </script>`,
);
const catalogEpub = await makeEpub("Catalog Book", "<p>From the catalog.</p>");

const CATALOG = "https://catalog.test/root.xml";
const opdsFeed = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Catalog</title>
  <entry>
    <id>urn:catalog-book</id><title>Catalog Book</title>
    <author><name>Test Author</name></author>
    <summary>A book served by the fake catalog.</summary>
    <link rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip" href="https://catalog.test/download/1"/>
  </entry>
</feed>`;

// ------------------------------------------------------------- headers
function parseHeaders(file) {
  const rules = [];
  let current = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
    } else if (current) {
      const i = line.indexOf(":");
      current.headers[line.slice(0, i).trim().toLowerCase()] = line
        .slice(i + 1)
        .trim();
    }
  }
  return rules;
}
const headerRules = parseHeaders(join(root, "_headers"));
const csp = headerRules.find((r) => r.pattern === "/*")?.headers[
  "content-security-policy"
];
if (!csp) throw new Error("No CSP in dist/client/_headers");

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
  ".txt": "text/plain",
};

// ------------------------------------------------------------- fake servers
const dav = { body: null, etag: null, puts: 0 };
const relayLog = [];

function relay(req, res, target) {
  relayLog.push(`${req.method} ${target}`);
  const u = new URL(target);
  if (u.host === "catalog.test") {
    if (u.pathname === "/root.xml") {
      res.writeHead(200, {
        "content-type": "application/atom+xml;profile=opds-catalog",
        "x-final-url": target,
      });
      return res.end(opdsFeed);
    }
    if (u.pathname === "/download/1") {
      res.writeHead(200, {
        "content-type": "application/epub+zip",
        "x-final-url": target,
      });
      return res.end(catalogEpub);
    }
  }
  if (u.host === "blocked.test") {
    // Like a library that refuses requests from cloud servers.
    res.writeHead(503, { "content-type": "text/html", "x-final-url": target });
    return res.end("<h1>Service unavailable</h1>");
  }
  if (u.host === "dav.test" && u.pathname === "/Aurum/aurum-sync.aurum") {
    if (
      req.headers.authorization !==
      `Basic ${Buffer.from("reader:secret").toString("base64")}`
    ) {
      res.writeHead(401, { "x-final-url": target });
      return res.end();
    }
    if (req.method === "GET") {
      if (!dav.body) {
        res.writeHead(404, { "x-final-url": target });
        return res.end();
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        etag: dav.etag,
        "x-final-url": target,
      });
      return res.end(dav.body);
    }
    if (req.method === "PUT") {
      const ifMatch = req.headers["if-match"];
      const ifNone = req.headers["if-none-match"];
      if ((ifMatch && ifMatch !== dav.etag) || (ifNone === "*" && dav.body)) {
        res.writeHead(412, { "x-final-url": target });
        return res.end();
      }
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        dav.body = Buffer.concat(chunks).toString();
        dav.puts += 1;
        dav.etag = `"v${dav.puts}"`;
        res.writeHead(dav.puts === 1 ? 201 : 204, {
          etag: dav.etag,
          "x-final-url": target,
        });
        res.end();
      });
      return;
    }
  }
  res.writeHead(502, { "content-type": "text/plain" });
  res.end("unknown host");
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/fetch")
    return relay(req, res, url.searchParams.get("url"));
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
await new Promise((r) => server.listen(4173, r));
const BASE = "http://localhost:4173";

// ------------------------------------------------------------- browser
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 400, height: 860 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("CSP-VIOLATION")) problems.push(t);
  else if (m.type() === "error") console.log("  console error:", t);
});
await context.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (e) =>
    console.log(
      `CSP-VIOLATION ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
    ),
  );
});

let failed = false;
const shots = "e2e-screenshots";
mkdirSync(shots, { recursive: true });
async function step(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed = true;
    console.log(
      `✗ ${name}\n  ${e.message.split("\n").slice(0, 6).join("\n  ")}`,
    );
    await page
      .screenshot({ path: `${shots}/${name.replace(/\W+/g, "-")}.png` })
      .catch(() => {});
  }
}

const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/**
 * Read or write the app's IndexedDB once the app has created it (version 3),
 * always closing the connection so the app is never blocked. (No eval: the
 * page's CSP forbids it, so each operation is spelled out here.)
 */
function withDb(op, arg) {
  return page.evaluate(
    async ({ op, arg }) => {
      for (let i = 0; i < 100; i += 1) {
        const dbs = (await indexedDB.databases?.()) ?? [];
        if (dbs.some((d) => d.name === "aurum" && (d.version ?? 0) >= 3)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open("aurum");
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        if (op === "putSetting") {
          return await new Promise((resolve, reject) => {
            const tx = db.transaction("settings", "readwrite");
            tx.objectStore("settings").put(arg.value, arg.key);
            tx.oncomplete = () => resolve(null);
            tx.onerror = () => reject(tx.error);
          });
        }
        return await new Promise((resolve, reject) => {
          const req = db.transaction("books").objectStore("books").getAll();
          req.onsuccess = () =>
            resolve(req.result.find((b) => b.title === arg)?.id ?? null);
          req.onerror = () => reject(req.error);
        });
      } finally {
        db.close();
      }
    },
    { op, arg },
  );
}

const putSetting = (key, value) => withDb("putSetting", { key, value });
const bookIdByTitle = (title) => withDb("findBook", title);

await step("app boots under the CSP", async () => {
  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  // Skip the first-run tour.
  await putSetting("onboardingSeen", true);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const text = await page.locator("body").innerText();
  expect(/Aurum|shelves|library/i.test(text), "library screen did not render");
  expect(problems.length === 0, `problems on boot:\n${problems.join("\n")}`);
});

await step("imports and renders an EPUB; its script does not run", async () => {
  const input = page.locator('input[type="file"][accept*=".epub"]').first();
  await input.setInputFiles({
    name: "script-test.epub",
    mimeType: "application/epub+zip",
    buffer: evilEpub,
  });
  let id = null;
  for (let i = 0; i < 40 && !id; i += 1) {
    await page.waitForTimeout(250);
    id = await bookIdByTitle("Script Test");
  }
  expect(id, "book was not imported");
  await page.goto(`${BASE}/read/${id}`);
  const frame = page.frameLocator("iframe").first();
  await frame.locator("#marker").waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${shots}/reader.png` });
  expect(
    (await frame.locator("#marker").innerText()).includes("Ishmael"),
    "chapter text missing",
  );
  await page.waitForTimeout(1000);
  expect(
    (await page.title()) !== "PWNED",
    "EPUB script changed the page title",
  );
  expect(
    (await page.evaluate(() => localStorage.getItem("pwned"))) === null,
    "EPUB script wrote to storage",
  );
  const sandbox = await page.locator("iframe").first().getAttribute("sandbox");
  expect(
    sandbox !== null && !sandbox.includes("allow-scripts"),
    `iframe sandbox is "${sandbox}"`,
  );
  const appProblems = problems.filter((p) => !p.includes("blob:"));
  expect(
    appProblems.length === 0,
    `problems while reading:\n${appProblems.join("\n")}`,
  );
});

await step(
  "library shows the continue-reading card and details sheet",
  async () => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    const hero = page.getByRole("region", { name: "Continue reading" });
    await hero.getByRole("button", { name: "Continue", exact: true }).waitFor();
    expect(
      (await hero.innerText()).includes("Script Test"),
      "hero card doesn't show the book being read",
    );
    await page.screenshot({ path: `${shots}/library.png` });
    await hero.getByRole("button", { name: /Details for Script Test/ }).click();
    const sheet = page.getByRole("dialog", { name: /Details for Script Test/ });
    await sheet
      .getByRole("button", { name: /Continue|Read/ })
      .first()
      .waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/details-sheet.png` });
    await page.getByRole("button", { name: "Close details" }).click({
      position: { x: 10, y: 10 },
    });
  },
);

await step(
  "a catalog that blocks the relay gets a plain-language message",
  async () => {
    await page.goto(`${BASE}/settings?tab=library`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${shots}/settings-tabs.png` });
    await page.getByRole("button", { name: /Browse book catalogs/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Feedbooks").first().waitFor();
    await dialog.getByText("Download from the website").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/catalogs-home.png` });
    await dialog.getByRole("button", { name: /Add a catalog/ }).click();
    await dialog
      .getByPlaceholder("https://…/opds")
      .fill("https://blocked.test/opds");
    await dialog.getByRole("button", { name: /^Add catalog$/ }).click();
    await dialog.getByText(/blocks downloads through Aurum/).waitFor();
    await page.screenshot({ path: `${shots}/catalog-blocked.png` });
    await page.keyboard.press("Escape");
  },
);

await step("browses an OPDS catalog and downloads a book", async () => {
  await page.goto(`${BASE}/settings?tab=library`);
  await page.waitForLoadState("networkidle");
  const link = page.getByLabel("Book or catalog link").first();
  await link.fill(CATALOG);
  await link.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Catalog Book").first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/opds-browser.png` });
  await dialog.getByRole("button", { name: /EPUB/ }).first().click();
  let id = null;
  for (let i = 0; i < 40 && !id; i += 1) {
    await page.waitForTimeout(250);
    id = await bookIdByTitle("Catalog Book");
  }
  expect(
    id,
    `catalog book was not imported (relay saw: ${relayLog.join(", ")})`,
  );
  await page.keyboard.press("Escape");
});

await step("syncs to WebDAV (first upload, then an ETag update)", async () => {
  await page.goto(`${BASE}/settings?tab=sync`);
  await page.waitForLoadState("networkidle");
  await page.fill("#sync-url", "https://dav.test/Aurum/");
  await page.fill("#sync-user", "reader");
  await page.fill("#sync-pw", "secret");
  await page.fill("#sync-phrase", "correct horse battery");
  await page.getByRole("button", { name: /Turn on & sync/ }).click();
  await page
    .getByText(/Synced ·/)
    .first()
    .waitFor({ timeout: 20000 });
  await page.locator("#sync-phrase").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/sync-settings.png` });
  expect(
    dav.puts === 1 && dav.body?.startsWith("AURUM1."),
    "first upload missing or not encrypted",
  );
  expect(!dav.body.includes("Script Test"), "sync file contains plaintext");
  await page.getByRole("button", { name: /Sync now/ }).click();
  for (let i = 0; i < 40 && dav.puts < 2; i += 1)
    await page.waitForTimeout(250);
  expect(dav.puts === 2, `second sync did not upload (puts=${dav.puts})`);
});

await step("library header shows the sync status", async () => {
  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Synced/ }).waitFor();
  await page.screenshot({
    path: `${shots}/library-synced.png`,
    clip: { x: 0, y: 0, width: 400, height: 200 },
  });
});

await step("no CSP violations or page errors overall", async () => {
  const appProblems = problems.filter((p) => !p.includes("blob:"));
  expect(appProblems.length === 0, appProblems.join("\n"));
});

await browser.close();
server.close();
console.log(`relay requests: ${relayLog.length}`);
process.exit(failed ? 1 : 0);
