/* eslint-disable @typescript-eslint/no-explicit-any */
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, ChevronLeft, Minus, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { getFile, putAnnotation, uid, type Annotation, type BookMeta } from "@/lib/db";
import { ReaderSettings, type ReaderPrefs } from "./EpubReader";
import { ReadAloudBar } from "./ReadAloudBar";
import { resolveReaderTheme } from "@/lib/reader-prefs";
import { useAppTheme } from "@/hooks/useAppTheme";

const THEME_BG: Record<string, string> = {
  light: "#faf8f4",
  dark: "#0f0f0e",
  sepia: "#f4ecd8",
};

const FILTER: Record<string, string> = {
  light: "none",
  dark: "invert(0.92) hue-rotate(180deg) brightness(0.95)",
  sepia: "sepia(0.35) saturate(0.9)",
};

export function PdfReader({
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
  // Page colour actually painted: the per-book override, or the app theme when "auto".
  const readerTheme = resolveReaderTheme(prefs.theme, useAppTheme());
  const scrollRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(Number(book.location) || 1);
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<null | "settings" | "search" | "notes">(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ page: number; excerpt: string }[]>([]);
  const pageRef = useRef(page);
  /** Page narration is currently reading, so pages turn as the voice advances. */
  const narratedPage = useRef<number | null>(null);

  pageRef.current = page;

  const goto = useCallback((pageNumber: number) => {
    const el = scrollRef.current?.querySelector(`[data-page="${pageNumber}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const pageText = useCallback(async (pageNumber: number) => {
    const doc = docRef.current;
    if (!doc || pageNumber < 1 || pageNumber > doc.numPages) return null;
    const p = await doc.getPage(pageNumber);
    const content = await p.getTextContent();
    const text = content.items.map((it: any) => it.str).join(" ").replace(/\s+/g, " ").trim();
    return text || null;
  }, []);

  /** Text of the page being narrated (starting from wherever the reader is). */
  const getSectionText = useCallback(async () => {
    if (narratedPage.current === null) narratedPage.current = pageRef.current;
    return pageText(narratedPage.current);
  }, [pageText]);

  /** Auto page-turn: advance to the next page when the current one is read out. */
  const onSectionEnd = useCallback(async () => {
    const doc = docRef.current;
    if (!doc) return false;
    const next = (narratedPage.current ?? pageRef.current) + 1;
    if (next > doc.numPages) {
      narratedPage.current = null;
      return false;
    }
    narratedPage.current = next;
    setPage(next);
    goto(next);
    return true;
  }, [goto]);


  useEffect(() => {
    let destroyed = false;
    (async () => {
      const blob = await getFile(book.id);
      if (!blob) return;
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
      if (destroyed) return;
      docRef.current = doc;
      setNumPages(doc.numPages);
    })();
    return () => {
      destroyed = true;
      docRef.current?.destroy?.();
    };
  }, [book.id]);

  const renderPage = useCallback(
    async (pageNumber: number, canvas: HTMLCanvasElement) => {
      const doc = docRef.current;
      if (!doc) return;
      const p = await doc.getPage(pageNumber);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const base = p.getViewport({ scale: 1 });
      const width = Math.min(canvas.parentElement?.clientWidth ?? 360, 1000);
      const scale = (width / base.width) * zoom;
      const viewport = p.getViewport({ scale: scale * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) await p.render({ canvas, canvasContext: ctx, viewport }).promise;
    },
    [zoom],
  );


  async function runSearch(term: string) {
    const doc = docRef.current;
    if (!doc || term.trim().length < 3) return;
    const found: { page: number; excerpt: string }[] = [];
    for (let i = 1; i <= doc.numPages && found.length < 40; i += 1) {
      const p = await doc.getPage(i);
      const content = await p.getTextContent();
      const text = content.items.map((it: any) => it.str).join(" ");
      const idx = text.toLowerCase().indexOf(term.toLowerCase());
      if (idx >= 0) found.push({ page: i, excerpt: text.slice(Math.max(0, idx - 50), idx + 90) });
    }
    setResults(found);
  }

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

  const percent = numPages ? Math.round((page / numPages) * 100) : 0;

  useEffect(() => {
    if (!numPages) return;
    onProgress({
      progress: Math.round((page / numPages) * 100),
      location: String(page),
      chapter: `Page ${page} of ${numPages}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, numPages]);

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: THEME_BG[readerTheme] }}>
      <header className="flex items-center justify-between gap-2 border-b border-gold/15 bg-background/95 px-safe-sm pb-2 pt-safe-sm">
        <button onClick={onBack} aria-label="Back to library" className="p-2 text-gold">
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground">
          {book.title}
        </h1>
        <div className="flex items-center gap-1 text-gold">
          <button onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))} aria-label="Zoom out" className="p-2">
            <Minus className="size-[18px]" />
          </button>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.2))} aria-label="Zoom in" className="p-2">
            <Plus className="size-[18px]" />
          </button>
          <button onClick={() => setPanel("search")} aria-label="Search in PDF" className="p-2">
            <Search className="size-[18px]" />
          </button>
          <button onClick={() => void addBookmark()} aria-label="Add bookmark" className="p-2">
            <Bookmark className="size-[18px]" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="px-safe-sm flex-1 overflow-y-auto py-3">
        {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
          <PdfPage
            key={`${n}-${zoom}`}
            pageNumber={n}
            render={renderPage}
            onVisible={() => setPage(n)}
            filter={FILTER[readerTheme] ?? "none"}
          />
        ))}
        {numPages === 0 ? (
          <p className="py-20 text-center text-sm text-muted-foreground">Opening document…</p>
        ) : null}
      </div>

      <footer className="pb-safe-sm flex flex-wrap items-center gap-2 border-t border-gold/15 bg-background/95 px-safe py-2">
        <div className="flex w-full items-center gap-3">
          <button
            onClick={() => setPanel("notes")}
            className="text-[11px] uppercase tracking-widest text-gold/80"
          >
            Notes ({annotations.length})
          </button>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-gradient-gold" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-[11px] text-gold/80">
            {page}/{numPages || "?"}
          </span>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2">
          <ReadAloudBar
            getSectionText={getSectionText}
            onSectionEnd={onSectionEnd}
            rate={prefs.speechRate ?? 1}
            mediaTitle={book.title}
            mediaArtist={book.author}
          />
          {goalHud}
        </div>
      </footer>


      {panel === "settings" ? (
        <ReaderSettings
          prefs={prefs}
          onChange={onPrefs}
          onClose={() => setPanel(null)}
          showFonts={false}
        />
      ) : null}

      {panel === "search" || panel === "notes" ? (
        <div className="fixed inset-0 z-50 flex">
          <button aria-label="Close panel" onClick={() => setPanel(null)} className="absolute inset-0 bg-scrim" />
          <div className="pt-safe-sm pb-safe px-safe-sm pr-safe relative ml-auto h-full w-[86%] max-w-sm overflow-y-auto border-l border-gold/25 bg-card">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl capitalize text-gold">{panel}</h3>
              <button onClick={() => setPanel(null)} aria-label="Close">
                <X className="size-5 text-muted-foreground" />
              </button>
            </div>
            {panel === "search" ? (
              <>
                <form
                  className="mt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSearch(query);
                  }}
                >
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search in this PDF"
                    placeholder="Search in this PDF"
                    className="w-full rounded-full border border-gold/25 bg-secondary/60 px-4 py-2 text-sm outline-none"
                  />
                </form>
                <ul className="mt-3 space-y-2">
                  {results.map((r) => (
                    <li key={r.page}>
                      <button
                        onClick={() => {
                          goto(r.page);
                          setPanel(null);
                        }}
                        className="w-full rounded-lg border border-border/60 p-2.5 text-left text-xs text-muted-foreground"
                      >
                        <span className="text-gold">p.{r.page}</span> {r.excerpt}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <ul className="mt-4 space-y-2">
                {annotations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bookmarks yet.</p>
                ) : null}
                {annotations.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => {
                        goto(Number(a.location) || 1);
                        setPanel(null);
                      }}
                      className="w-full rounded-lg border-l-2 bg-secondary/50 p-3 text-left"
                      style={{ borderColor: a.color }}
                    >
                      <p className="text-[10px] uppercase tracking-widest text-gold/70">{a.label}</p>
                      {a.text ? <p className="mt-1 text-sm">{a.text}</p> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PdfPage({
  pageNumber,
  render,
  onVisible,
  filter,
}: {
  pageNumber: number;
  render: (n: number, canvas: HTMLCanvasElement) => Promise<void>;
  onVisible: () => void;
  filter: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          onVisible();
          if (!rendered && canvasRef.current) {
            setRendered(true);
            void render(pageNumber, canvasRef.current);
          }
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, pageNumber]);

  return (
    <div ref={ref} data-page={pageNumber} className="mx-auto mb-3 flex min-h-[40vh] justify-center">
      <canvas ref={canvasRef} className="max-w-full rounded shadow-lux" style={{ filter }} />
    </div>
  );
}
