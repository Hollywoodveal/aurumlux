/* eslint-disable @typescript-eslint/no-explicit-any */
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from "lucide-react";
import { toast } from "sonner";
import { getFile, putAnnotation, uid, type Annotation, type BookMeta } from "@/lib/db";
import { ReaderSettings, type ReaderPrefs } from "./EpubReader";
import { THEME_COLORS, resolveReaderTheme, withPrefDefaults } from "@/lib/reader-prefs";
import { useAppTheme } from "@/hooks/useAppTheme";

type ComicPage = { name: string; entry: any };

export function CbzReader({
  book,
  prefs,
  onPrefs,
  annotations,
  onAnnotationsChanged,
  onProgress,
  onBack,
  goalHud,
}: {
  book: BookMeta;
  prefs: ReaderPrefs;
  onPrefs: (p: ReaderPrefs) => void;
  annotations: Annotation[];
  onAnnotationsChanged: () => void;
  onProgress: (p: { progress: number; location: string; chapter: string }) => void;
  onBack: () => void;
  /** Live daily-target control, docked into the bottom bar. */
  goalHud?: React.ReactNode;
}) {
  const [pages, setPages] = useState<ComicPage[]>([]);
  const [page, setPage] = useState(Math.max(1, Number(book.location) || 1));
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState<"width" | "contain">("width");
  const [panel, setPanel] = useState<null | "settings" | "notes">(null);
  const [url, setUrl] = useState<string | null>(null);
  const urlCache = useRef<Map<number, string>>(new Map());

  const theme = THEME_COLORS[resolveReaderTheme(prefs.theme, useAppTheme())] ?? THEME_COLORS.dark;

  useEffect(() => {
    let destroyed = false;
    (async () => {
      const blob = await getFile(book.id);
      if (!blob || destroyed) return;
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(blob);
        const entries = Object.values(zip.files)
          .filter((f: any) => !f.dir && /\.(jpe?g|png|gif|webp)$/i.test(f.name))
          .sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        if (destroyed) return;
        if (entries.length === 0) {
          setError("No readable images found in this archive.");
          return;
        }
        setPages(entries.map((e: any) => ({ name: e.name, entry: e })));
      } catch {
        if (destroyed) return;
        setError(
          book.format === "cbr"
            ? "CBR (RAR) archives can't be opened in the browser — please convert to CBZ."
            : "This comic archive could not be opened.",
        );
      }
    })();
    return () => {
      destroyed = true;
    };
  }, [book.id, book.format]);

  // Lazily create object URLs for a small window around the current page,
  // revoking anything outside of it so memory stays bounded.
  useEffect(() => {
    if (pages.length === 0) return;
    let cancelled = false;
    const cache = urlCache.current;
    const keep = new Set([page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages.length));

    (async () => {
      const target = pages[page - 1];
      if (!target) return;
      if (!cache.has(page)) {
        const blob = await target.entry.async("blob");
        if (cancelled) return;
        cache.set(page, URL.createObjectURL(blob));
      }
      if (!cancelled) setUrl(cache.get(page) ?? null);

      for (const n of keep) {
        if (cache.has(n)) continue;
        const p = pages[n - 1];
        if (!p) continue;
        void p.entry.async("blob").then((blob: Blob) => {
          if (cancelled || cache.has(n)) return;
          cache.set(n, URL.createObjectURL(blob));
        });
      }

      for (const [n, u] of Array.from(cache.entries())) {
        if (!keep.has(n)) {
          URL.revokeObjectURL(u);
          cache.delete(n);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, pages]);

  useEffect(() => {
    return () => {
      for (const u of urlCache.current.values()) URL.revokeObjectURL(u);
      urlCache.current.clear();
    };
  }, []);

  useEffect(() => {
    if (pages.length === 0) return;
    const pct = Math.round((page / pages.length) * 100);
    onProgress({ progress: pct, location: String(page), chapter: `Page ${page} of ${pages.length}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pages.length]);

  const goPrev = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);
  const goNext = useCallback(() => setPage((p) => Math.min(pages.length || 1, p + 1)), [pages.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keyup", onKey);
    return () => window.removeEventListener("keyup", onKey);
  }, [goNext, goPrev]);

  async function addBookmark() {
    await putAnnotation({
      id: uid(),
      bookId: book.id,
      type: "bookmark",
      color: "#c9a227",
      text: "",
      note: "",
      location: String(page),
      label: `Page ${page}`,
      createdAt: Date.now(),
    });
    onAnnotationsChanged();
    toast.success("Bookmark saved");
  }

  const percent = pages.length ? Math.round((page / pages.length) * 100) : 0;

  return (
    <div className="fixed inset-0 flex h-dvh flex-col" style={{ background: theme.bg }}>
      <header className="flex items-center justify-between gap-2 border-b border-gold/15 bg-background/95 px-safe-sm pb-2 pt-safe-sm">
        <button
          onClick={onBack}
          aria-label="Back to library"
          className="flex size-11 items-center justify-center text-gold"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground">
          {book.title}
        </h1>
        <div className="flex items-center gap-1 text-gold">
          <button
            onClick={() => setFit((f) => (f === "width" ? "contain" : "width"))}
            aria-label={fit === "width" ? "Fit to screen" : "Fit to width"}
            className="flex size-11 items-center justify-center"
          >
            {fit === "width" ? <Maximize2 className="size-[18px]" /> : <Minimize2 className="size-[18px]" />}
          </button>
          <button onClick={() => void addBookmark()} aria-label="Add bookmark" className="flex size-11 items-center justify-center">
            <Bookmark className="size-[18px]" />
          </button>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : pages.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Opening archive…
          </p>
        ) : (
          <>
            <div className="flex h-full items-center justify-center overflow-auto">
              {url ? (
                <img
                  src={url}
                  alt={`Page ${page} of ${book.title}`}
                  className={fit === "width" ? "w-full" : "max-h-full max-w-full"}
                  draggable={false}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Loading page…</p>
              )}
            </div>
            <button aria-label="Previous page" onClick={goPrev} className="absolute inset-y-0 left-0 w-1/3" />
            <button aria-label="Next page" onClick={goNext} className="absolute inset-y-0 right-0 w-1/3" />
          </>
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-gold/15 bg-background/95 px-safe pb-safe-sm py-2">
        <button
          onClick={goPrev}
          aria-label="Previous"
          className="flex size-11 items-center justify-center text-gold"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-gradient-gold" style={{ width: `${percent}%` }} />
        </div>
        <span className="min-w-[3.5rem] text-center text-[11px] text-gold/80">
          {pages.length ? `${page}/${pages.length}` : "—"}
        </span>
        <button
          onClick={goNext}
          aria-label="Next"
          className="flex size-11 items-center justify-center text-gold"
        >
          <ChevronRight className="size-4" />
        </button>
        <button
          onClick={() => setPanel("notes")}
          className="ml-1 rounded-full border border-gold/25 px-3 py-1 text-[11px] uppercase tracking-widest text-gold/80"
        >
          Notes ({annotations.length})
        </button>
        {goalHud}
      </footer>

      {panel === "settings" ? (
        <ReaderSettings
          prefs={withPrefDefaults(prefs)}
          onChange={(p) => onPrefs(p)}
          onClose={() => setPanel(null)}
          showFonts={false}
        />
      ) : null}

      {panel === "notes" ? (
        <div className="fixed inset-0 z-50 flex">
          <button aria-label="Close panel" onClick={() => setPanel(null)} className="absolute inset-0 bg-scrim" />
          <div className="pt-safe-sm pb-safe px-safe-sm pr-safe relative ml-auto h-full w-[86%] max-w-sm overflow-y-auto border-l border-gold/25 bg-card">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl text-gold">Notes</h3>
              <button onClick={() => setPanel(null)} aria-label="Close">
                <X className="size-5 text-muted-foreground" />
              </button>
            </div>
            <ul className="mt-4 space-y-2">
              {annotations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bookmarks yet.</p>
              ) : null}
              {annotations.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => {
                      setPage(Number(a.location) || 1);
                      setPanel(null);
                    }}
                    className="w-full rounded-lg border-l-2 bg-secondary/50 p-3 text-left"
                    style={{ borderColor: a.color }}
                  >
                    <p className="text-[10px] uppercase tracking-widest text-gold/70">{a.label}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
