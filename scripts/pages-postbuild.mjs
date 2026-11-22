// Post-build step for the Cloudflare Pages (SPA) build.
//
// 1. TanStack Start's SPA mode emits the app shell as `dist/client/_shell.html`.
//    Pages needs it as `index.html` (paired with `public/_redirects`, which
//    rewrites every route to `/index.html` for client-side routing).
// 2. Generates the offline service worker with workbox-build. This script is
//    the only place its caching rules live.
// 3. Writes a Content-Security-Policy into `_headers`. The app shell has a few
//    inline scripts (theme boot, router hydration); they're allowed by their
//    SHA-256 hash, so nothing else inline can run. That includes scripts
//    inside EPUB chapters, whose iframes inherit this policy.
//
// Run: `bun run build`
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSW } from "workbox-build";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = join(root, "dist", "client");

// 1. Shell -> index.html
cpSync(join(clientDir, "_shell.html"), join(clientDir, "index.html"));
rmSync(join(clientDir, "_shell.html"));

// 2. Service worker
const { count, size } = await generateSW({
  globDirectory: clientDir,
  // `mjs` is required: pdf.js ships its worker as pdf.worker.min-*.mjs and the
  // PDF reader cannot open a book offline without it.
  globPatterns: ["**/*.{js,mjs,css,html,ico,png,svg,woff2}"],
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
  // No precached index.html fallback: Pages serves index.html for navigations
  // via `_redirects`, and the NetworkFirst runtime cache below handles them.
  navigateFallback: undefined,
  cleanupOutdatedCaches: true,
  swDest: join(clientDir, "sw.js"),
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.mode === "navigate",
      handler: "NetworkFirst",
      options: {
        cacheName: "aurum-pages",
        networkTimeoutSeconds: 5,
      },
    },
    {
      urlPattern: ({ url, sameOrigin }) =>
        sameOrigin && /\/assets\/|\.(?:woff2|png|svg|ico)$/.test(url.pathname),
      handler: "CacheFirst",
      options: {
        cacheName: "aurum-assets",
        expiration: { maxEntries: 300 },
      },
    },
    {
      urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
      handler: "CacheFirst",
      options: {
        cacheName: "aurum-fonts",
        expiration: { maxEntries: 30 },
      },
    },
  ],
});

// New workers must NOT skipWaiting on their own: the app shows a
// "new version, tap to refresh" prompt and only then posts SKIP_WAITING.
// Workbox's generateSW has no hook for custom code, so append the listener.
appendFileSync(
  join(clientDir, "sw.js"),
  `\nself.addEventListener("message", (event) => {\n  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();\n});\n`,
);

console.log(
  `Service worker generated: ${count} precached files (${size} bytes)`,
);

// 3. Content-Security-Policy
const html = readFileSync(join(clientDir, "index.html"), "utf8");
const inlineHashes = [
  ...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
]
  // Hash the text as the browser's HTML parser sees it: newlines normalized,
  // and NUL characters (TanStack's router state contains some) replaced with
  // U+FFFD. Otherwise the hash doesn't match and the script is blocked.
  .map((m) => (m[1] ?? "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "\uFFFD"))
  .filter((body) => body.trim().length > 0)
  .map(
    (body) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
  );

const csp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets pdf.js use its WebAssembly image decoders.
  `script-src 'self' 'wasm-unsafe-eval' ${inlineHashes.join(" ")}`.trim(),
  // epub.js applies reader themes as inline styles; book CSS loads as blob: URLs.
  "style-src 'self' 'unsafe-inline' blob:",
  "font-src 'self' data: blob: https://fonts.gstatic.com",
  // Covers come from Open Library / Google Books / OPDS catalogs.
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  // Link imports, OPDS catalogs and WebDAV sync can point at any HTTPS host
  // the reader chooses.
  "connect-src 'self' https: blob: data:",
  "frame-src 'self' blob: about:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

appendFileSync(
  join(clientDir, "_headers"),
  `\n/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`,
);
console.log(`CSP written with ${inlineHashes.length} inline script hash(es)`);
