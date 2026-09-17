/* eslint-disable @typescript-eslint/no-explicit-any */
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookA, Bookmark, ChevronLeft, ChevronRight, List, Palette, Search, X } from "lucide-react";
import { toast } from "sonner";
import { getFile, putAnnotation, uid, updateBook, type Annotation, type BookMeta } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PREFS,
  DYSLEXIC_FONT,
  READER_FONTS,
  highlightAlphas,
  resolveFont,
  THEME_COLORS,
  type ReaderPrefs,
  type ReaderTheme,
} from "@/lib/reader-prefs";
import { ReadAloudBar, speechSupported, type ReadAloudControls } from "@/components/reader/ReadAloudBar";
import { DictionarySheet } from "@/components/reader/DictionarySheet";
import { SpokenHighlighter } from "@/lib/spoken-highlight";




export { DEFAULT_PREFS };
export type { ReaderPrefs, ReaderTheme };

export function ReaderSettings({
  prefs,
  onChange,
  onClose,
  showFonts = true,
  showTapToRead = false,
}: {
  prefs: ReaderPrefs;
  onChange: (p: ReaderPrefs) => void;
  onClose: () => void;
  showFonts?: boolean;
  /** Shows the tap-to-read-aloud toggle (EPUB reader only). */
  showTapToRead?: boolean;
}) {

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <button aria-label="Close settings" onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div className="animate-rise pb-safe px-safe relative max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border-t border-gold/25 bg-card py-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl text-gold">Reading</h3>
          <button onClick={onClose} aria-label="Close" className="flex size-11 items-center justify-center">
            <X className="size-5 text-muted-foreground" />
          </button>
        </div>

        <p className="mt-5 text-xs uppercase tracking-[0.16em] text-muted-foreground">Theme</p>
        <div className="mt-2 flex gap-2">
          {(["light", "dark", "sepia"] as ReaderTheme[]).map((t) => (
            <button
              key={t}
              onClick={() => onChange({ ...prefs, theme: t })}
              className={cn(
                "min-h-11 flex-1 rounded-lg border py-2 text-sm capitalize",
                prefs.theme === t ? "border-gold/60 text-gold" : "border-border text-muted-foreground",
              )}
              style={{ background: THEME_COLORS[t].bg, color: THEME_COLORS[t].fg }}
            >
              {t}
            </button>
          ))}
        </div>

        {showFonts ? (
          <>
            <p className="mt-5 text-xs uppercase tracking-[0.16em] text-muted-foreground">Font</p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {READER_FONTS.filter((f) => f.value !== DYSLEXIC_FONT).map((f) => (
                <button
                  key={f.value}
                  onClick={() => onChange({ ...prefs, fontFamily: f.value })}
                  style={{ fontFamily: f.value }}
                  className={cn(
                    "min-h-11 rounded-lg border py-2 text-sm",
                    prefs.fontFamily === f.value
                      ? "border-gold/60 text-gold"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {[
          { key: "fontSize" as const, label: "Font size", min: 70, max: 180, step: 5 },
          { key: "lineHeight" as const, label: "Line spacing", min: 1.2, max: 2.4, step: 0.1 },
          { key: "margin" as const, label: "Margins", min: 0, max: 60, step: 4 },
        ].map((s) => (
          <div key={s.key} className="mt-5">
            <div className="flex justify-between text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <span>{s.label}</span>
              <span className="text-gold">{prefs[s.key]}</span>
            </div>
            <input
              type="range"
              aria-label={s.label}
              min={s.min}
              max={s.max}
              step={s.step}
              value={prefs[s.key]}
              onChange={(e) => onChange({ ...prefs, [s.key]: Number(e.target.value) })}
              className="mt-2 w-full accent-[oklch(0.82_0.132_87)]"
            />
          </div>
        ))}

        <p className="mt-6 text-xs uppercase tracking-[0.16em] text-muted-foreground">Comfort</p>
        {[
          { key: "brightness" as const, label: "Dim screen", min: 0, max: 60, step: 5 },
          { key: "warmth" as const, label: "Warmth", min: 0, max: 60, step: 5 },
        ].map((s) => (
          <div key={s.key} className="mt-4">
            <div className="flex justify-between text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <span>{s.label}</span>
              <span className="text-gold">{prefs[s.key]}</span>
            </div>
            <input
              type="range"
              aria-label={s.label}
              min={s.min}
              max={s.max}
              step={s.step}
              value={prefs[s.key]}
              onChange={(e) => onChange({ ...prefs, [s.key]: Number(e.target.value) })}
              className="mt-2 w-full accent-[oklch(0.82_0.132_87)]"
            />
          </div>
        ))}

        <p className="mt-6 text-xs uppercase tracking-[0.16em] text-muted-foreground">Page turn</p>
        <div className="mt-2 flex gap-2">
          {(["none", "slide", "fade"] as ReaderPrefs["pageAnim"][]).map((a) => (
            <button
              key={a}
              onClick={() => onChange({ ...prefs, pageAnim: a })}
              className={cn(
                "min-h-11 flex-1 rounded-lg border py-2 text-sm capitalize",
                prefs.pageAnim === a ? "border-gold/60 text-gold" : "border-border text-muted-foreground",
              )}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Readable font</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Atkinson Hyperlegible, wider spacing</p>
          </div>
          <button
            onClick={() => onChange({ ...prefs, dyslexic: !prefs.dyslexic })}
            aria-pressed={prefs.dyslexic}
            aria-label="Toggle readable font"
            className={cn(
              "min-h-11 min-w-11 rounded-full border px-4 text-xs uppercase tracking-widest",
              prefs.dyslexic ? "border-gold/60 bg-gold/10 text-gold" : "border-border text-muted-foreground",
            )}
          >
            {prefs.dyslexic ? "On" : "Off"}
          </button>
        </div>

        {speechSupported ? (
          <div className="mt-6">
            <div className="flex justify-between text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <span>Read-aloud speed</span>
              <span className="text-gold">{prefs.speechRate.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              aria-label="Read-aloud speed"
              min={0.7}
              max={1.6}
              step={0.1}
              value={prefs.speechRate}
              onChange={(e) => onChange({ ...prefs, speechRate: Number(e.target.value) })}
              className="mt-2 w-full accent-[oklch(0.82_0.132_87)]"
            />
          </div>
        ) : null}

        <p className="mt-6 text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Follow-along
        </p>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            Glow each word as it is narrated, and tap it to jump there
          </p>
          <button
            onClick={() => onChange({ ...prefs, highlightWords: !prefs.highlightWords })}
            aria-pressed={prefs.highlightWords}
            aria-label="Toggle word highlighting"
            className={cn(
              "ml-3 min-h-11 min-w-11 rounded-full border px-4 text-xs uppercase tracking-widest",
              prefs.highlightWords
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-border text-muted-foreground",
            )}
          >
            {prefs.highlightWords ? "On" : "Off"}
          </button>
        </div>

        {showTapToRead ? (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            Tap any word to start reading aloud from there
          </p>
          <button
            onClick={() => onChange({ ...prefs, tapToRead: !prefs.tapToRead })}
            aria-pressed={prefs.tapToRead}
            aria-label="Toggle tap to read aloud"
            className={cn(
              "ml-3 min-h-11 min-w-11 rounded-full border px-4 text-xs uppercase tracking-widest",
              prefs.tapToRead
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-border text-muted-foreground",
            )}
          >
            {prefs.tapToRead ? "On" : "Off"}
          </button>
        </div>
        ) : null}

        {prefs.highlightWords ? (
          <div className="mt-4">
            <div className="flex justify-between text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <span>Highlight strength</span>
              <span className="text-gold">{prefs.highlightIntensity}%</span>
            </div>
            <input
              type="range"
              aria-label="Highlight strength"
              min={10}
              max={90}
              step={5}
              value={prefs.highlightIntensity}
              onChange={(e) => onChange({ ...prefs, highlightIntensity: Number(e.target.value) })}
              className="mt-2 w-full accent-[oklch(0.82_0.132_87)]"
            />
          </div>
        ) : null}

      </div>
    </div>
  );
}

export function EpubReader({
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
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);
  const [toc, setToc] = useState<{ label: string; href: string }[]>([]);
  const [panel, setPanel] = useState<null | "toc" | "settings" | "search" | "notes">(null);
  /** Word sent to the dictionary sheet, or null when it is closed. */
  const [lookup, setLookup] = useState<string | null>(null);


  const [chapter, setChapter] = useState("");
  const [percent, setPercent] = useState(book.progress);
  const [results, setResults] = useState<{ cfi: string; excerpt: string }[]>([]);
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Follow-along narration state: word highlighter, its document, page-turn lock. */
  const spokenRef = useRef<SpokenHighlighter | null>(null);
  const spokenDocRef = useRef<Document | null>(null);
  const pagingRef = useRef(false);
  /** CFI comparator from epub.js, loaded with the book (kept out of SSR). */
  const cfiRef = useRef<{ compare: (a: string, b: string) => number } | null>(null);
  /** Passage being narrated, kept so paging can be re-checked after a re-flow. */
  const lastPassageRef = useRef<string | null>(null);
  /** Latest "is the spoken passage still on this page?" check. */
  const recheckPageRef = useRef<(() => void) | null>(null);


  /** Range of the word currently being spoken, so a tap on it can jump there. */
  const spokenRangeRef = useRef<Range | null>(null);
  /** Latest in-document tap handler, read by the listener added on render. */
  const docTapRef = useRef<((e: PointerEvent | MouseEvent) => void) | null>(null);
  /** Narration controls, used to read aloud from a tapped word. */
  const readAloudRef = useRef<ReadAloudControls | null>(null);



  const relocatedResolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let destroyed = false;
    (async () => {
      const blob = await getFile(book.id);
      if (!blob || destroyed) return;
      const buffer = await blob.arrayBuffer();
      const epubjs = await import("epubjs");
      const ePub = epubjs.default;
      const CFI = (epubjs as unknown as { EpubCFI?: new () => { compare: (a: string, b: string) => number } }).EpubCFI;
      if (CFI) cfiRef.current = new CFI();

      if (destroyed) return;
      const epub = (ePub as any)(buffer);
      bookRef.current = epub;
      const rendition = epub.renderTo(hostRef.current, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "none",
        allowScriptedContent: true,
      });
      renditionRef.current = rendition;
      // Restore the saved locations index before the first paint so the very
      // first percentage shown is already the real one.
      if (book.locationsIndex) {
        try {
          epub.locations.load(book.locationsIndex);
        } catch {
          /* rebuilt below */
        }
      }
      await rendition.display(book.location || undefined);

      if (destroyed) return;
      setReady(true);

      const nav = await epub.loaded.navigation;
      setToc(
        (nav.toc ?? []).map((t: any) => ({ label: String(t.label ?? "").trim(), href: t.href })),
      );

      /**
       * Percentage through the whole book. Only the generated locations index
       * gives a stable figure; before it is ready the spine-index estimate is
       * shown but the stored progress is left untouched, so closing the reader
       * early can no longer overwrite the real number with a coarse guess.
       */
      const percentFor = (location: any): { shown: number; exact: number | null } => {
        const cfi = location?.start?.cfi;
        let exact: number | null = null;
        if (epub.locations?.length()) {
          const ratio =
            (cfi ? epub.locations.percentageFromCfi(cfi) : null) ?? location?.start?.percentage ?? 0;
          exact = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
        }
        // Without the index, keep showing the stored figure rather than a guess.
        return { shown: exact ?? book.progress ?? 0, exact };
      };


      rendition.on("relocated", (location: any) => {
        const { shown, exact } = percentFor(location);
        setPercent(shown);
        const current = epub.navigation?.get(location.start.href);
        const label = current?.label?.trim() ?? "";
        setChapter(label);
        onProgress({
          progress: exact ?? book.progress ?? shown,
          location: location.start.cfi,
          chapter: label,
        });

        const anim = prefsRef.current.pageAnim;
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const el = hostRef.current;
        if (el && anim !== "none" && !reduceMotion) {
          const cls = anim === "slide" ? "page-anim-slide" : "page-anim-fade";
          el.classList.remove("page-anim-slide", "page-anim-fade");
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          el.offsetWidth;
          el.classList.add(cls);
        }
        relocatedResolveRef.current?.();
        relocatedResolveRef.current = null;
      });

      rendition.on("keyup", (e: KeyboardEvent) => {
        if (e.key === "ArrowRight") rendition.next();
        if (e.key === "ArrowLeft") rendition.prev();
      });

      // Taps inside the book document: used to jump to the spoken word.
      rendition.on("rendered", (_section: unknown, view: any) => {
        const doc: Document | undefined = view?.document ?? view?.contents?.document;
        doc?.addEventListener(
          "pointerdown",
          (e: PointerEvent) => docTapRef.current?.(e),
          true,
        );
      });


      annotations
        .filter((a) => a.type === "highlight" && a.location)
        .forEach((a) => {
          try {
            rendition.annotations.highlight(a.location, {}, undefined, "aurum-hl", {
              fill: a.color,
              "fill-opacity": "0.35",
            });
          } catch {
            /* ignore */
          }
        });

      // A restored index needs no rebuild; otherwise build it once, restate the
      // percentage for the page on screen, and cache it for the next open.
      const indexReady = epub.locations?.length()
        ? Promise.resolve()
        : epub.locations.generate(1200).then(async () => {
            try {
              await updateBook(book.id, { locationsIndex: epub.locations.save() });
            } catch {
              /* index cache is best-effort */
            }
          });

      void indexReady
        .then(() => {
          if (destroyed) return;
          const loc = rendition.location;
          if (!loc?.start?.cfi) return;
          const { shown, exact } = percentFor(loc);
          setPercent(shown);
          if (exact !== null) {
            const label = epub.navigation?.get(loc.start.href)?.label?.trim() ?? "";
            onProgress({ progress: exact, location: loc.start.cfi, chapter: label });
          }
        })
        .catch(() => undefined);

      // Re-flowing after a rotation or resize invalidates the character map the
      // follow-along highlighter built, so drop it and re-check the page.
      rendition.on("resized", () => {
        spokenRef.current?.clear();
        spokenDocRef.current = null;
        spokenRangeRef.current = null;
        pagingRef.current = false;
        recheckPageRef.current?.();
      });


    })();

    return () => {
      destroyed = true;
      try {
        renditionRef.current?.destroy();
        bookRef.current?.destroy();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) return;
    const colors = THEME_COLORS[prefs.theme];
    const alphas = highlightAlphas(prefs.highlightIntensity);
    const font = resolveFont(prefs, book.fontOverride);

    rendition.themes.register("aurum", {
      body: {
        background: colors.bg,
        color: colors.fg,
        "font-family": `${font} !important`,
        "line-height": `${prefs.lineHeight} !important`,
        "padding-left": `${prefs.margin}px !important`,
        "padding-right": `${prefs.margin}px !important`,
        ...(prefs.dyslexic
          ? { "letter-spacing": "0.02em !important", "word-spacing": "0.12em !important" }
          : {}),
      },
      p: {
        "line-height": `${prefs.lineHeight} !important`,
        "font-family": `${font} !important`,
        ...(prefs.dyslexic
          ? { "letter-spacing": "0.02em !important", "word-spacing": "0.12em !important" }
          : {}),
      },
      a: { color: "#c9a227 !important" },
      // Follow-along narration: the spoken word glows, its passage stays tinted.
      "::highlight(aurum-spoken)": {
        background: `rgba(201,162,39,${alphas.word.toFixed(2)})`,
        color: `${colors.fg} !important`,
      },
      "::highlight(aurum-passage)": {
        background: `rgba(201,162,39,${alphas.passage.toFixed(2)})`,
      },

    });

    rendition.themes.select("aurum");
    rendition.themes.fontSize(`${prefs.fontSize}%`);
  }, [prefs, ready, book.fontOverride]);

  const addBookmark = useCallback(async () => {
    const location = renditionRef.current?.currentLocation?.();
    const cfi = location?.start?.cfi ?? "";
    await putAnnotation({
      id: uid(),
      bookId: book.id,
      type: "bookmark",
      color: "#c9a227",
      text: "",
      note: "",
      location: cfi,
      label: chapter || `${percent}%`,
      createdAt: Date.now(),
    });
    onAnnotationsChanged();
    toast.success("Bookmark saved");
  }, [book.id, chapter, percent, onAnnotationsChanged]);

  const highlightSelection = useCallback(
    async (color: string) => {
      const rendition = renditionRef.current;
      const contents = rendition?.getContents?.()?.[0];
      const selection = contents?.window?.getSelection?.();
      const text = selection?.toString?.().trim() ?? "";
      if (!text) {
        toast.error("Select some text first");
        return;
      }
      const range = selection.getRangeAt(0);
      const cfi = contents.cfiFromRange(range);
      rendition.annotations.highlight(cfi, {}, undefined, "aurum-hl", {
        fill: color,
        "fill-opacity": "0.35",
      });
      await putAnnotation({
        id: uid(),
        bookId: book.id,
        type: "highlight",
        color,
        text,
        note: "",
        location: cfi,
        label: chapter,
        createdAt: Date.now(),
      });
      selection.removeAllRanges();
      onAnnotationsChanged();
      toast.success("Highlight saved");
    },
    [book.id, chapter, onAnnotationsChanged],
  );

  async function runSearch(term: string) {
    const epub = bookRef.current;
    if (!epub || term.trim().length < 3) return;
    const spineItems: any[] = [];
    epub.spine.each((item: any) => spineItems.push(item));
    const found: { cfi: string; excerpt: string }[] = [];
    for (const item of spineItems) {
      try {
        await item.load(epub.load.bind(epub));
        const hits = item.find(term);
        item.unload();
        for (const h of hits) found.push({ cfi: h.cfi, excerpt: h.excerpt });
        if (found.length > 40) break;
      } catch {
        /* ignore */
      }
    }
    setResults(found);
  }

  /** Plain text of the section currently on screen, for read-aloud. */
  const getSectionText = useCallback(async () => {
    const rendition = renditionRef.current;
    const contents = rendition?.getContents?.()?.[0];
    const doc = contents?.document ?? contents?.content?.ownerDocument;
    const text: string | undefined = doc?.body?.textContent ?? contents?.content?.textContent;
    return text?.trim() || null;
  }, []);

  /** Advance to the next page; resolves true if it moved, false at book's end. */
  const advanceForSpeech = useCallback(async () => {
    const rendition = renditionRef.current;
    if (!rendition) return false;
    const before = rendition.location?.start?.cfi;
    const done = new Promise<void>((resolve) => {
      relocatedResolveRef.current = resolve;
    });
    await rendition.next();
    await Promise.race([done, new Promise((r) => setTimeout(r, 800))]);
    const after = rendition.location?.start?.cfi;
    return Boolean(after && after !== before);
  }, []);

  /** Document of the section currently rendered in the epub.js iframe. */
  const currentDoc = useCallback((): Document | undefined => {
    const contents = renditionRef.current?.getContents?.()?.[0];
    return (contents?.document ?? contents?.content?.ownerDocument) as Document | undefined;
  }, []);

  /**
   * True when a range sits outside the page currently shown.
   *
   * Geometry alone is unreliable here: in paginated mode the book document is
   * as wide as all of its columns, so an off-screen word still reports a rect
   * inside the iframe's window. Comparing CFIs against the rendered page's
   * start/end is layout-independent, with geometry kept as a fallback.
   */
  const isOffPage = useCallback((range: Range) => {
    const rendition = renditionRef.current;
    const contents = rendition?.getContents?.()?.[0];
    const loc = rendition?.location;
    try {
      const cmp = cfiRef.current;
      const cfi = contents?.cfiFromRange?.(range);
      const start = loc?.start?.cfi;
      const end = loc?.end?.cfi;
      if (cmp && cfi && start && end) {
        return cmp.compare(cfi, start) < 0 || cmp.compare(cfi, end) > 0;
      }

    } catch {
      /* fall through to geometry */
    }
    const win = spokenDocRef.current?.defaultView;
    if (!win) return false;
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;
    const container = rendition?.manager?.container as HTMLElement | undefined;
    const left = container ? container.scrollLeft : 0;
    const width = container ? container.clientWidth : win.innerWidth;
    return rect.left >= left + width - 2 || rect.right <= left + 2;
  }, []);


  /** Move the reader to a range's exact spot in the text. */
  const jumpToRange = useCallback((range: Range, opts?: { paging?: boolean }) => {
    const rendition = renditionRef.current;
    const contents = rendition?.getContents?.()?.[0];
    try {
      const cfi = contents?.cfiFromRange?.(range);
      if (!cfi) return false;
      if (opts?.paging) pagingRef.current = true;
      void Promise.resolve(rendition.display(cfi)).finally(() => {
        window.setTimeout(() => {
          pagingRef.current = false;
        }, 300);
      });
      return true;
    } catch {
      pagingRef.current = false;
      return false;
    }
  }, []);

  /** Locate each spoken passage in the rendered page so words can be followed. */
  const handleSpokenPassage = useCallback(
    (passage: string | null) => {
      const highlighter = (spokenRef.current ??= new SpokenHighlighter());
      lastPassageRef.current = passage;
      if (!passage) {
        highlighter.paint(null);
        highlighter.setPassage(null);
        spokenDocRef.current = null;
        return;
      }
      const doc = currentDoc();
      if (doc && spokenDocRef.current !== doc) {
        highlighter.attach(doc);
        spokenDocRef.current = doc;
      }
      highlighter.setPassage(passage);
      // Turn the page as soon as narration moves to a passage that isn't shown,
      // so pages keep flowing even without word-level follow-along.
      if (pagingRef.current) return;
      const range = highlighter.passageRange();
      if (range && isOffPage(range)) jumpToRange(range, { paging: true });
    },
    [currentDoc, isOffPage, jumpToRange],
  );

  /**
   * Re-run the paging decision for the passage being narrated. Used after a
   * re-flow (rotation, resize, font change) and after a manual page turn, so
   * narration and the visible page never drift apart.
   */
  const recheckPage = useCallback(() => {
    const passage = lastPassageRef.current;
    if (!passage) return;
    window.setTimeout(() => handleSpokenPassage(passage), 120);
  }, [handleSpokenPassage]);
  recheckPageRef.current = recheckPage;

  // Rotations and window resizes that epub.js does not report itself.
  useEffect(() => {
    const onResize = () => recheckPageRef.current?.();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);




  /**
   * Character offset of the word under a tap, measured against the same
   * section text narration is chunked from (`doc.body.textContent`, trimmed).
   */
  const offsetAtPoint = useCallback((doc: Document, x: number, y: number): number | null => {
    const any = doc as any;
    let node: Text | null = null;
    let nodeOffset = 0;
    if (typeof any.caretRangeFromPoint === "function") {
      const r = any.caretRangeFromPoint(x, y);
      if (r?.startContainer?.nodeType === 3) {
        node = r.startContainer as Text;
        nodeOffset = r.startOffset;
      }
    } else if (typeof any.caretPositionFromPoint === "function") {
      const pos = any.caretPositionFromPoint(x, y);
      if (pos?.offsetNode?.nodeType === 3) {
        node = pos.offsetNode as Text;
        nodeOffset = pos.offset;
      }
    }
    if (!node || !doc.body) return null;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let total = 0;
    let found = false;
    let n = walker.nextNode() as Text | null;
    while (n) {
      if (n === node) {
        total += Math.min(nodeOffset, n.data.length);
        found = true;
        break;
      }
      total += n.data.length;
      n = walker.nextNode() as Text | null;
    }
    if (!found) return null;
    const raw = doc.body.textContent ?? "";
    const trimmed = raw.trim();
    let idx = Math.max(0, total - (raw.length - raw.trimStart().length));
    if (idx >= trimmed.length) return null;
    // Back up to the start of the tapped word so narration begins cleanly.
    while (idx > 0 && !/\s/.test(trimmed[idx - 1] ?? " ")) idx -= 1;
    return idx;
  }, []);

  /**
   * Taps inside the book: on the spoken word it jumps the reader there,
   * anywhere else it starts narrating from exactly that word.
   */
  const handleDocPointerDown = useCallback(
    (event: PointerEvent | MouseEvent) => {
      const x = event.clientX;
      const y = event.clientY;
      const range = spokenRangeRef.current;
      if (range) {
        const pad = 6;
        const hit = [...range.getClientRects()].some(
          (r) =>
            x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad,
        );
        if (hit) {
          event.preventDefault();
          event.stopPropagation();
          jumpToRange(range);
          return;
        }
      }
      if (!prefsRef.current.tapToRead) return;
      const doc = (event.target as Node | null)?.ownerDocument ?? currentDoc();
      if (!doc) return;
      const selection = doc.getSelection?.();
      if (selection && !selection.isCollapsed) return;
      const offset = offsetAtPoint(doc, x, y);
      if (offset === null) return;
      const controls = readAloudRef.current;
      if (!controls) return;
      event.preventDefault();
      event.stopPropagation();
      controls.startFrom(offset);
    },
    [currentDoc, jumpToRange, offsetAtPoint],
  );
  docTapRef.current = handleDocPointerDown;



  /** Highlight the word being spoken and turn the page once it moves off-screen. */
  const handleSpokenWord = useCallback(
    (span: { start: number; end: number } | null) => {
      const highlighter = spokenRef.current;
      if (!highlighter) return;
      // Paint only when the follow-along glow is on; paging always tracks the word.
      const glow = prefsRef.current.highlightWords;
      const range = glow ? highlighter.paint(span) : span ? highlighter.rangeFor(span) : null;
      spokenRangeRef.current = span && range && glow ? range : null;
      if (!span || !range || pagingRef.current) return;
      if (!isOffPage(range)) return;
      jumpToRange(range, { paging: true });
    },
    [isOffPage, jumpToRange],
  );




  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: THEME_COLORS[prefs.theme].bg }}>
      <header className="flex items-center justify-between gap-2 border-b border-gold/15 bg-background/95 px-safe-sm pb-2 pt-safe-sm">
        <button onClick={onBack} aria-label="Back to library" className="flex size-11 items-center justify-center text-gold">
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground">
          <span className="sr-only">{book.title}</span>
          <span aria-hidden="true">{chapter || book.title}</span>
        </h1>
        <div className="flex items-center gap-1 text-gold">
          <button onClick={() => setPanel("toc")} aria-label="Table of contents" className="flex size-11 items-center justify-center">
            <List className="size-[18px]" />
          </button>
          <button onClick={() => setPanel("search")} aria-label="Search in book" className="flex size-11 items-center justify-center">
            <Search className="size-[18px]" />
          </button>
          <button onClick={() => void addBookmark()} aria-label="Add bookmark" className="flex size-11 items-center justify-center">
            <Bookmark className="size-[18px]" />
          </button>
          <button onClick={() => setPanel("settings")} aria-label="Reading settings" className="flex size-11 items-center justify-center">
            <Palette className="size-[18px]" />
          </button>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <div ref={hostRef} className="h-full w-full" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: `rgba(0,0,0,${Math.min(prefs.brightness, 100) / 100})` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: `rgba(255,159,10,${(Math.min(prefs.warmth, 100) / 100) * 0.5})` }}
        />
        <button
          aria-label="Previous page"
          onClick={() => renditionRef.current?.prev()}
          className="absolute inset-y-0 left-0 w-[18%]"
        />
        <button
          aria-label="Next page"
          onClick={() => renditionRef.current?.next()}
          className="absolute inset-y-0 right-0 w-[18%]"
        />
      </div>

      <footer className="flex items-center gap-3 border-t border-gold/15 bg-background/95 px-safe py-2">
        <button onClick={() => renditionRef.current?.prev()} aria-label="Previous" className="flex size-11 items-center justify-center text-gold">
          <ChevronLeft className="size-4" />
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-gradient-gold" style={{ width: `${percent}%` }} />
        </div>
        <span className="w-9 text-right text-[11px] text-gold/80">{percent}%</span>
        <button onClick={() => renditionRef.current?.next()} aria-label="Next" className="flex size-11 items-center justify-center text-gold">
          <ChevronRight className="size-4" />
        </button>
      </footer>

      <div className="px-safe-sm pb-safe-sm flex flex-wrap items-center justify-center gap-2 border-t border-gold/10 bg-background/95 py-2">
        {["#c9a227", "#4fa3a5", "#b5563f", "#7a6bbf"].map((c) => (
          <button
            key={c}
            aria-label={`Highlight with ${c}`}
            onClick={() => void highlightSelection(c)}
            className="size-6 rounded-full border border-gold/30"
            style={{ background: c }}
          />
        ))}
        <button
          onClick={() => setPanel("notes")}
          className="ml-2 min-h-11 rounded-full border border-gold/25 px-3 text-[11px] uppercase tracking-widest text-gold/80"
        >
          Notes ({annotations.length})
        </button>
        <button
          aria-label="Define selected word"
          onClick={() => {
            // Selection lives inside the epub.js iframe document.
            const contents = renditionRef.current?.getContents?.()?.[0];
            const text = String(contents?.window?.getSelection?.() ?? "").trim();
            if (!text) {
              toast.info("Select a word first, then tap Define");
              return;
            }
            setLookup(text.split(/\s+/).slice(0, 2).join(" "));
          }}
          className="min-h-11 rounded-full border border-gold/25 px-3 text-[11px] uppercase tracking-widest text-gold/80"
        >
          <BookA className="mr-1 inline size-3" />
          Define
        </button>

        {goalHud}

        {ready ? (
          <ReadAloudBar
            getSectionText={getSectionText}
            onSectionEnd={advanceForSpeech}
            rate={prefs.speechRate}
            onPassage={handleSpokenPassage}
            onWord={handleSpokenWord}
            mediaTitle={book.title}
            mediaArtist={book.author}
            controls={readAloudRef}
          />

        ) : null}
      </div>

      {lookup !== null ? (
        <DictionarySheet word={lookup} onClose={() => setLookup(null)} />
      ) : null}

      {panel === "settings" ? (

        <ReaderSettings
          prefs={prefs}
          onChange={onPrefs}
          onClose={() => setPanel(null)}
          showTapToRead
        />
      ) : null}


      {panel === "toc" || panel === "search" || panel === "notes" ? (
        <div className="fixed inset-0 z-50 flex">
          <button
            aria-label="Close panel"
            onClick={() => setPanel(null)}
            className="absolute inset-0 bg-black/70"
          />
          <div className="pt-safe-sm pb-safe px-safe-sm pr-safe relative ml-auto h-full w-[86%] max-w-sm overflow-y-auto border-l border-gold/25 bg-card">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl capitalize text-gold">{panel}</h3>
              <button onClick={() => setPanel(null)} aria-label="Close" className="flex size-11 items-center justify-center">
                <X className="size-5 text-muted-foreground" />
              </button>
            </div>

            {panel === "toc" ? (
              <ul className="mt-4 space-y-1">
                {toc.map((t, i) => (
                  <li key={`${t.href}-${i}`}>
                    <button
                      onClick={() => {
                        renditionRef.current?.display(t.href);
                        setPanel(null);
                      }}
                      className="w-full border-b border-border/50 py-2.5 text-left text-sm text-foreground"
                    >
                      {t.label || "Untitled"}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {panel === "search" ? (
              <div className="mt-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSearch(query);
                  }}
                >
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search in this book"
                    placeholder="Search in this book"
                    className="w-full rounded-full border border-gold/25 bg-secondary/60 px-4 py-2 text-sm outline-none"
                  />
                </form>
                <ul className="mt-3 space-y-2">
                  {results.map((r, i) => (
                    <li key={`${r.cfi}-${i}`}>
                      <button
                        onClick={() => {
                          renditionRef.current?.display(r.cfi);
                          setPanel(null);
                        }}
                        className="w-full rounded-lg border border-border/60 p-2.5 text-left text-xs text-muted-foreground"
                      >
                        {r.excerpt}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {panel === "notes" ? (
              <ul className="mt-4 space-y-2">
                {annotations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bookmarks or highlights yet.</p>
                ) : null}
                {annotations.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => {
                        if (a.location) renditionRef.current?.display(a.location);
                        setPanel(null);
                      }}
                      className="w-full rounded-lg border-l-2 bg-secondary/50 p-3 text-left"
                      style={{ borderColor: a.color }}
                    >
                      <p className="text-[10px] uppercase tracking-widest text-gold/70">
                        {a.type} · {a.label}
                      </p>
                      {a.text ? <p className="mt-1 text-sm text-foreground">{a.text}</p> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
