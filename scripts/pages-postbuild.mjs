// Post-build step for the Cloudflare Pages (SPA) build.
//
// 1. TanStack Start's SPA mode emits the app shell as `dist/client/_shell.html`.
//    Pages needs it as `index.html` (paired with `public/_redirects`, which
//    rewrites every route to `/index.html` for client-side routing).
// 2. vite-plugin-pwa skips service-worker generation for this build shape
//    (its closeBundle gate requires `build.ssr === false`), so we run
//    workbox-build's generateSW directly with the same caching strategy the
//    Worker build used.
//
// Run: `bun run build:pages` (or `bun run build && bun scripts/pages-postbuild.mjs`)
import { cpSync, rmSync } from "node:fs";
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

console.log(`Service worker generated: ${count} precached files (${size} bytes)`);
