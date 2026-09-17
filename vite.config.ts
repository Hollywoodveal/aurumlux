// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        // Must match the client build's real outDir (nitro owns `.output/public`).
        // Pointing this at `dist/client` produced a 0-entry precache manifest in a
        // directory that never gets deployed, so the app had no offline support.
        outDir: ".output/public",
        devOptions: { enabled: false },
        manifest: false,
        workbox: {
          // `mjs` is required: pdf.js ships its worker as pdf.worker.min-*.mjs and the
          // PDF reader cannot open a book offline without it.
          globPatterns: ["**/*.{js,mjs,css,html,ico,png,svg,woff2}"],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // No precached index.html (the app is server-rendered), so navigations are
          // served by the NetworkFirst runtime cache below instead of a fallback shell.
          navigateFallback: null,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: ({ request }: { request: Request }) =>
                request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "aurum-pages",
                networkTimeoutSeconds: 5,
              },
            },
            {
              urlPattern: ({
                url,
                sameOrigin,
              }: {
                url: URL;
                sameOrigin: boolean;
              }) =>
                sameOrigin &&
                /\/assets\/|\.(?:woff2|png|svg|ico)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "aurum-assets",
                expiration: { maxEntries: 300 },
              },
            },
            {
              urlPattern: ({ url }: { url: URL }) =>
                url.origin === "https://fonts.gstatic.com",
              handler: "CacheFirst",
              options: {
                cacheName: "aurum-fonts",
                expiration: { maxEntries: 30 },
              },
            },
          ],
        },
      }),
    ],
  },
});
