import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { LiveAnnouncer } from "@/components/LiveAnnouncer";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { BottomNav, TabBarSpacer } from "@/components/BottomNav";
import { Celebration } from "@/components/Celebration";
import { NativeBridge } from "@/components/NativeBridge";
import { registerServiceWorker } from "@/lib/pwa";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

/**
 * iPhone/iPad launch screens for the Home Screen app (black, gold logo), so it
 * never flashes white on open. [css width, css height, pixel ratio, file].
 */
const SPLASH_SCREENS: [number, number, number, string][] = [
  [440, 956, 3, "splash-1320x2868.png"],
  [402, 874, 3, "splash-1206x2622.png"],
  [430, 932, 3, "splash-1290x2796.png"],
  [393, 852, 3, "splash-1179x2556.png"],
  [390, 844, 3, "splash-1170x2532.png"],
  [428, 926, 3, "splash-1284x2778.png"],
  [375, 812, 3, "splash-1125x2436.png"],
  [414, 896, 3, "splash-1242x2688.png"],
  [414, 896, 2, "splash-828x1792.png"],
  [414, 736, 3, "splash-1242x2208.png"],
  [375, 667, 2, "splash-750x1334.png"],
  [320, 568, 2, "splash-640x1136.png"],
  [1024, 1366, 2, "splash-2048x2732.png"],
  [834, 1194, 2, "splash-1668x2388.png"],
  [820, 1180, 2, "splash-1640x2360.png"],
  [768, 1024, 2, "splash-1536x2048.png"],
];
const splashLinks = SPLASH_SCREENS.map(([w, h, r, file]) => ({
  rel: "apple-touch-startup-image",
  href: `/splash/${file}`,
  media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
}));

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back
          home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content:
            "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1",
        },
        { title: "Aurum — Where every page is treasured" },
        {
          name: "description",
          content:
            "Aurum is a private, offline-first e-reader for EPUB and PDF books with a black & gold digital bookshelf.",
        },
        { name: "theme-color", content: "#0b0b0a" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        {
          name: "apple-mobile-web-app-status-bar-style",
          content: "black-translucent",
        },
        { name: "apple-mobile-web-app-title", content: "Aurum" },
        {
          property: "og:title",
          content: "Aurum — Where every page is treasured",
        },
        {
          property: "og:description",
          content:
            "A premium offline-first EPUB and PDF reader. No account, no ads, no analytics — the network is only used for features you explicitly enable.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        {
          // Self-hosted brand type (Cormorant Garamond, Jost, Atkinson
          // Hyperlegible) — no third-party font requests, ever.
          rel: "stylesheet",
          href: "/fonts/fonts.css",
        },
        { rel: "manifest", href: "/manifest.webmanifest" },
        { rel: "icon", type: "image/png", href: "/favicon.png" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        ...splashLinks,
      ],
    }),

    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <HeadContent />
        {/*
          Applies the saved palette to <html> before the first paint, so a light
          or neutral reader never gets a flash of the dark theme on load. Must
          stay ahead of the stylesheet-dependent content and run synchronously.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Optional WebDAV sync (off unless set up in Settings). Loaded lazily so the
  // library screen doesn't pay for it.
  useEffect(() => {
    void import("@/lib/sync")
      .then((m) => m.autoSync())
      .then((r) => {
        if (r && r.positions + r.added + r.removed + r.annotations > 0)
          void queryClient.invalidateQueries();
        else void queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
      });
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <TabBarSpacer />
      <BottomNav />
      <Celebration />
      <NativeBridge />
      <LiveAnnouncer />
      <UpdatePrompt />
      <InstallPrompt />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
