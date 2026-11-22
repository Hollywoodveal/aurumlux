import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Plugin order matters: tailwind and path resolution first, then tanstackStart,
// then react. The service worker is generated after the build by
// scripts/pages-postbuild.mjs (the one place its caching rules live).
export default defineConfig({
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
      // SPA mode: the app is fully client-side (all data lives in IndexedDB;
      // no server functions, loaders, or server routes). `vite build` emits a
      // static `dist/` that deploys to Cloudflare Pages; client routing is
      // handled by `public/_redirects`.
      spa: { enabled: true },
      // Fail the build if client code pulls in a server-only module.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    viteReact(),
  ],
});
