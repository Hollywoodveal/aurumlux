import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";

// This project previously used @lovable.dev/vite-tanstack-config, which bundled the
// plugins below behind a single defineConfig. That wrapper is gone, so the plugin list
// and resolve/css settings it injected are now spelled out here. Plugin order matters:
// tailwind and path resolution first, then tanstackStart, then nitro, then react.
export default defineConfig(({ command }) => ({
  css: {
    // Matches the previous build output; lightningcss also minifies the Tailwind 4 output.
    transformer: "lightningcss",
  },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    // Multiple copies of React or the query client break hooks and cache identity.
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    ignoreOutdatedRequests: true,
  },
  server: { host: "::", port: 8080 },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Fail the build if client code pulls in a server-only module.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error
      // wrapper). nitro/vite builds from this.
      server: { entry: "server" },
    }),
    // nitro owns the production build; it emits the Cloudflare Worker and wrangler.json.
    // Build-only, exactly as the previous wrapper did.
    ...(command === "build"
      ? [
          nitro({
            defaultPreset: "cloudflare-module",
            // Without an explicit name nitro derives one from the git remote
            // ("hollywoodveal-aurumlux"), which becomes the workers.dev hostname.
            cloudflare: { deployConfig: true, wrangler: { name: "aurumlux" } },
          }),
        ]
      : []),
    viteReact(),
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
            urlPattern: ({ request }: { request: Request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "aurum-pages",
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
              sameOrigin && /\/assets\/|\.(?:woff2|png|svg|ico)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "aurum-assets",
              expiration: { maxEntries: 300 },
            },
          },
          {
            urlPattern: ({ url }: { url: URL }) => url.origin === "https://fonts.gstatic.com",
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
}));
