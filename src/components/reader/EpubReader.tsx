/* eslint-disable @typescript-eslint/no-explicit-any */
import type React from "react";
import { chapterLeftLabel, PagePace } from "@/lib/chapter-pace";
import { TapZoneHint } from "@/components/reader/TapZoneHint";
import { BOOK_OPEN } from "@/lib/transitions";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookA,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Eraser,
  List,
  Languages,
  Palette,
  Search,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  getFile,
  putAnnotation,
  uid,
  updateBook,
  type Annotation,
  type BookMeta,
} from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PREFS,
  DYSLEXIC_FONT,
  READER_FONTS,
  highlightAlphas,
  resolveFont,
  resolveReaderTheme,
  THEME_COLORS,
  type ReaderPrefs,
  type ReaderTheme,
  type ReaderThemeChoice,
} from "@/lib/reader-prefs";
import { useAppTheme } from "@/hooks/useAppTheme";
import {
  ReadAloudBar,
  speechSupported,
  type ReadAloudControls,
} from "@/components/reader/ReadAloudBar";
import { DictionarySheet } from "@/components/reader/DictionarySheet";
import { NoteComposer } from "@/components/reader/NoteComposer";
import { SpokenHighlighter } from "@/lib/spoken-highlight";
import { useCoverUrl } from "@/hooks/useLibrary";
import {
  callNative,
  currentHinge,
  hasNative,
  haptic,
  isNativeApp,
  onNativeEvent,
} from "@/lib/native";
import {
  ReadingAssistant,
  type AssistantTab,
} from "@/components/reader/ReadingAssistant";
import { INK_COLORS, InkController } from "@/lib/ink";
import {
  canSnapshot,
  prepareFlip,
  snapshotElement,
  snapshotError,
  type Flip,
  type Snapshot,
} from "@/lib/page-flip";

export { DEFAULT_PREFS };
export type { ReaderPrefs, ReaderTheme, ReaderThemeChoice };

const PAGE_ANIMS: ReaderPrefs["pageAnim"][] = ["turn", "slide", "fade", "none"];

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
  const appTheme = useAppTheme();

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <button
        aria-label="Close settings"
        onClick={onClose}
        className="absolute inset-0 bg-scrim"
      />
      <div className="animate-rise pb-safe px-safe relative max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border-t border-gold/25 bg-card py-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl text-gold">Reading</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 items-center justify-center"
          >
            <X className="size-5 text-muted-foreground" />
          </button>
        </div>

        <p className="mt-5 text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Page colour
        </p>
        <div className="mt-2 flex gap-2">
          {(["auto", "light", "sepia", "dark"] as ReaderThemeChoice[]).map(
            (t) => {
              // "Auto" previews whatever the app theme currently resolves to.
              const preview = THEME_COLORS[resolveReaderTheme(t, appTheme)];
              return (
                <button
                  key={t}
                  onClick={() => onChange({ ...prefs, theme: t })}
                  className={cn(
                    "min-h-11 flex-1 rounded-lg border py-2 text-sm capitalize",
                    prefs.theme === t
                      ? "border-gold/60 ring-1 ring-gold/40"
                      : "border-border",
                  )}
                  style={{ background: preview.bg, color: preview.fg }}
                >
                  {t}
                </button>
              );
            },
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Auto follows the theme you picked in Settings.
        </p>

        {showFonts ? (
          <>
            <p className="mt-5 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Font
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {READER_FONTS.filter((f) => f.value !== DYSLEXIC_FONT).map(
                (f) => (
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
                ),
              )}
            </div>
          </>
        ) : null}

        {[
          {
            key: "fontSize" as const,
            label: "Font size",
            min: 70,
            max: 180,
            step: 5,
          },
          {
            key: "lineHeight" as const,
            label: "Line spacing",
            min: 1.2,
            max: 2.4,
            step: 0.1,
          },
          {
            key: "margin" as const,
            label: "Margins",
            min: 0,
            max: 60,
            step: 4,
          },
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
              onChange={(e) =>
                onChange({ ...prefs, [s.key]: Number(e.target.value) })
              }
              className="mt-2 w-full accent-[oklch(0.82_0.132_87)]"
            />
          </div>
        ))}

        <p className="mt-6 text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Comfort
        </p>
        {[
          {
            key: "brightness" as const,
            label: "Dim screen",
            min: 0,
            max: 60,
            step: 5,
          },
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
              onChange={(e) =>
                onChange({ ...prefs, [s.key]: Number(e.target.value) })
              }
              className="mt-2 w-full accent-[oklch(0.82_0.132_87)]"
            />
          </div>
        ))}

        <p className="mt-6 text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Page turn
        </p>
        <div className="mt-2 flex gap-2">
          {PAGE_ANIMS.map((a) => (
            <button
              key={a}
              onClick={() => onChange({ ...prefs, pageAnim: a })}
              className={cn(
                "min-h-11 flex-1 rounded-lg border py-2 text-sm capitalize",
                prefs.pageAnim === a
                  ? "border-gold/60 text-gold"
                  : "border-border text-muted-foreground",
              )}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Book typography
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Gold drop caps and small-caps chapter titles
            </p>
          </div>
          <button
            onClick={() =>
              onChange({ ...prefs, bookTypography: !prefs.bookTypography })
            }
            aria-pressed={prefs.bookTypography}
            aria-label="Toggle book typography"
            className={cn(
              "min-h-11 min-w-11 rounded-full border px-4 text-xs uppercase tracking-widest",
              prefs.bookTypography
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-border text-muted-foreground",
            )}
          >
            {prefs.bookTypography ? "On" : "Off"}
          </button>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Cover on open
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Start at the cover, then tap to open the book
            </p>
          </div>
          <button
            onClick={() => onChange({ ...prefs, showCover: !prefs.showCover })}
            aria-pressed={prefs.showCover}
            aria-label="Toggle cover on open"
            className={cn(
              "min-h-11 min-w-11 rounded-full border px-4 text-xs uppercase tracking-widest",
              prefs.showCover
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-border text-muted-foreground",
            )}
          >
            {prefs.showCover ? "On" : "Off"}
          </button>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Readable font
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Atkinson Hyperlegible, wider spacing
            </p>
          </div>
          <button
            onClick={() => onChange({ ...prefs, dyslexic: !prefs.dyslexic })}
            aria-pressed={prefs.dyslexic}
            aria-label="Toggle readable font"
            className={cn(
              "min-h-11 min-w-11 rounded-full border px-4 text-xs uppercase tracking-widest",
              prefs.dyslexic
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-border text-muted-foreground",
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
              onChange={(e) =>
                onChange({ ...prefs, speechRate: Number(e.target.value) })
              }
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
            onClick={() =>
              onChange({ ...prefs, highlightWords: !prefs.highlightWords })
            }
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
              onClick={() =>
                onChange({ ...prefs, tapToRead: !prefs.tapToRead })
              }
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
              onChange={(e) =>
                onChange({
                  ...prefs,
                  highlightIntensity: Number(e.target.value),
                })
              }
              className="mt-2 w-full accent-[oklch(0.82_0.132_87)]"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

let snapshotProblemShown = false;
/** Says once why a page turn couldn't use the real page, so it can be fixed. */
function reportSnapshotProblem() {
  if (snapshotProblemShown) return;
  snapshotProblemShown = true;
  toast.error(
    `Page turn animation couldn't photograph the page (${snapshotError() ?? "no reason given"}). Turning without it.`,
  );
}

/** Every page-transition class, so one can be swapped for another cleanly. */
const PAGE_ANIM_CLASSES = [
  "page-anim-slide",
  "page-anim-fade",
  "page-turn-away",
  "page-turn-back",
  "page-turn-settle",
];
/** Matches the page-turn-away animation in styles.css. */
const PAGE_TURN_MS = 260;
/** The turning leaf over a two-page spread, and its lift time (styles.css). */
const SHEET_CLASSES = [
  "sheet-lift-next",
  "sheet-land-next",
  "sheet-lift-prev",
  "sheet-land-prev",
];
const SHEET_LIFT_MS = 230;
/**
 * Reader width at which pages show side by side, like an open book. 560
 * catches the iPhone Duo's inner screen held upright (about 626 points wide,
 * the fold running down the middle like a book's spine) while its outer
 * screen (about 466) and ordinary iPhones held upright stay one page.
 */
const MIN_SPREAD_WIDTH = 560;

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
  onProgress: (p: {
    progress: number;
    location: string;
    chapter: string;
  }) => void;
  onBack: () => void;
  /** Live daily-target control, docked into the bottom bar. */
  goalHud?: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);
  // Page colour actually painted: the per-book override, or the app theme when "auto".
  const readerTheme = resolveReaderTheme(prefs.theme, useAppTheme());
  const readerThemeRef = useRef(readerTheme);
  readerThemeRef.current = readerTheme;

  /** What a photo of the spread depends on: the page, the size and the look. */
  const snapKey = useCallback(() => {
    const r = stageRef.current?.getBoundingClientRect();
    const cfi = renditionRef.current?.location?.start?.cfi ?? "";
    return `${cfi}|${r?.width}x${r?.height}|${readerThemeRef.current}|${JSON.stringify(prefsRef.current)}`;
  }, []);

  /** Photograph the spread shortly after it settles, so a tap turns at once. */
  const snapTimerRef = useRef<number | undefined>(undefined);
  const scheduleSnapRef = useRef<() => void>(() => undefined);
  scheduleSnapRef.current = () => {
    window.clearTimeout(snapTimerRef.current);
    // Photos only matter for the Turn animation; skip the work otherwise.
    if (
      !canSnapshot() ||
      hasNative("curl") ||
      prefsRef.current.pageAnim !== "turn"
    )
      return;
    snapTimerRef.current = window.setTimeout(async () => {
      const stage = stageRef.current;
      const busy =
        pendingTurnRef.current ||
        flipRef.current ||
        activeFlipRef.current ||
        coverShownRef.current ||
        flipLayerRef.current?.style.visibility === "visible";
      if (!stage || busy) return;
      const key = snapKey();
      const snap = await snapshotElement(stage);
      if (snap && key === snapKey() && !pendingTurnRef.current) {
        snapRef.current = { key, snap };
      }
    }, 700);
  };
  useEffect(() => () => window.clearTimeout(snapTimerRef.current), []);
  const [toc, setToc] = useState<{ label: string; href: string }[]>([]);
  const [panel, setPanel] = useState<
    null | "toc" | "settings" | "search" | "notes"
  >(null);
  /** Word sent to the dictionary sheet, or null when it is closed. */
  const [lookup, setLookup] = useState<string | null>(null);
  /** Apple Intelligence reading help (iOS app). */
  const [assistant, setAssistant] = useState<AssistantTab | null>(null);
  const showAssistant = isNativeApp() && hasNative("ai");
  /** Apple Pencil ink: the controller, its canvas, and the tools' state. */
  const inkRef = useRef<InkController | null>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const [inkMode, setInkMode] = useState(false);
  const [inkTool, setInkTool] = useState<{ color: string; erasing: boolean }>({
    color: INK_COLORS[0] ?? "#d6b05c",
    erasing: false,
  });

  const [chapter, setChapter] = useState("");
  const [percent, setPercent] = useState(book.progress);
  const [chapterLeft, setChapterLeft] = useState<string | null>(null);
  const paceRef = useRef(new PagePace());
  const [results, setResults] = useState<{ cfi: string; excerpt: string }[]>(
    [],
  );
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);

  /**
   * iPhone Duo half-folded on a table, like a laptop: the page sits on the
   * top half and big controls fill the bottom half.
   */
  const [tabletop, setTabletop] = useState(false);
  useEffect(() => {
    if (!isNativeApp()) return;
    const check = () => {
      const h = currentHinge();
      setTabletop(
        Boolean(
          h &&
          h.status === "partiallyOpen" &&
          h.angle >= 45 &&
          h.angle <= 150 &&
          window.innerWidth > window.innerHeight,
        ),
      );
    };
    check();
    const off = onNativeEvent((e) => {
      if (e.type === "hinge") check();
    });
    window.addEventListener("resize", check);
    return () => {
      off();
      window.removeEventListener("resize", check);
    };
  }, []);
  // The page area changed size without the window changing: re-lay pages.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        renditionRef.current?.resize?.();
      } catch {
        /* not laid out yet */
      }
      inkRef.current?.redraw();
    });
    return () => cancelAnimationFrame(id);
  }, [tabletop]);

  // Apple Pencil ink: set up once the page area exists.
  useEffect(() => {
    const canvas = inkCanvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ink = new InkController({
      canvas,
      stage,
      bookId: book.id,
      pageKey: () => renditionRef.current?.location?.start?.cfi ?? null,
      onModeChange: setInkMode,
    });
    inkRef.current = ink;
    const ro = new ResizeObserver(() => ink.redraw());
    ro.observe(stage);
    return () => {
      ro.disconnect();
      ink.destroy();
      inkRef.current = null;
    };
  }, [book.id]);

  // Coming back to a book after a few days: offer a "previously" recap.
  const offeredRecap = useRef(false);
  useEffect(() => {
    if (!ready || !showAssistant || offeredRecap.current) return;
    const away = Date.now() - (book.lastOpened || Date.now());
    if (away < 2 * 86400000 || book.progress < 2) return;
    offeredRecap.current = true;
    void import("@/lib/intelligence")
      .then((m) => m.aiStatus())
      .then((s) => {
        if (!s.available) return;
        toast(`Welcome back to ${book.title}`, {
          description: "Want a quick recap of where you left off?",
          duration: 9000,
          action: { label: "Recap", onClick: () => setAssistant("recap") },
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, showAssistant]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Direction of a page-turn animation waiting for its page to render. */
  const pendingTurnRef = useRef<"next" | "prev" | null>(null);
  const turnRef = useRef<(dir: "next" | "prev") => void>(() => undefined);
  /** Two pages side by side (wide screens), and the leaf that turns over them. */
  const [spread, setSpread] = useState(false);
  const spreadRef = useRef(false);
  spreadRef.current = spread;
  const sheetRef = useRef<HTMLDivElement>(null);
  /** The page stage, the layer the photographed leaf turns on, and the flip
   *  waiting for its new pages. */
  const stageRef = useRef<HTMLDivElement>(null);
  const flipLayerRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<Flip | null>(null);
  const activeFlipRef = useRef<Flip | null>(null);
  /** A native page curl is covering the page (iOS app). */
  const nativeCurlRef = useRef(false);
  /** Turns a prepared leaf, once. */
  const startFlipRef = useRef<(flip: Flip) => void>(() => undefined);
  startFlipRef.current = (flip: Flip) => {
    if (flipRef.current !== flip) return;
    flipRef.current = null;
    activeFlipRef.current = flip;
    void flip.start().then(() => {
      if (activeFlipRef.current === flip) activeFlipRef.current = null;
      scheduleSnapRef.current();
    });
  };
  /** Photo of the spread as it is now, taken ahead of the next tap. */
  const snapRef = useRef<{ key: string; snap: Snapshot } | null>(null);
  const coverShownRef = useRef(false);
  const coverUrl = useCoverUrl(book);
  const [coverShown, setCoverShown] = useState(() => prefs.showCover);
  const [coverOpening, setCoverOpening] = useState(false);
  coverShownRef.current = coverShown && prefs.showCover && Boolean(coverUrl);

  /**
   * Drag-to-turn (iOS app): the app owns the outer fifth of each side of the
   * page, where a drag curls the page under your finger and a tap turns it.
   * The zones are switched off whenever something covers the page.
   */
  const curlZonesOn =
    hasNative("curlDrag") &&
    ready &&
    prefs.pageAnim === "turn" &&
    !panel &&
    lookup === null &&
    !assistant &&
    !inkMode &&
    !(coverShown && prefs.showCover && coverUrl);
  const publishCurlZones = useCallback(() => {
    if (!hasNative("curlDrag")) return;
    const stage = stageRef.current;
    const loc = renditionRef.current?.location;
    if (!curlZonesOnRef.current || !stage) {
      void callNative("curlZones", { enabled: false });
      return;
    }
    const r = stage.getBoundingClientRect();
    void callNative("curlZones", {
      enabled: true,
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
      spread: spreadRef.current,
      atStart: Boolean(loc?.atStart),
      atEnd: Boolean(loc?.atEnd),
      paper: THEME_COLORS[readerThemeRef.current].bg,
    });
  }, []);
  const publishCurlZonesRef = useRef(publishCurlZones);
  publishCurlZonesRef.current = publishCurlZones;
  const curlZonesOnRef = useRef(curlZonesOn);
  curlZonesOnRef.current = curlZonesOn;
  useEffect(() => {
    publishCurlZones();
  }, [curlZonesOn, spread, tabletop, publishCurlZones]);
  useEffect(() => {
    if (!hasNative("curlDrag")) return;
    const stage = stageRef.current;
    const ro = stage ? new ResizeObserver(() => publishCurlZones()) : null;
    if (stage) ro?.observe(stage);
    const off = onNativeEvent((e) => {
      const rendition = renditionRef.current;
      if (e.type === "edgeTap") {
        void turnRef.current(e.dir);
      } else if (e.type === "curlDrag" && rendition) {
        // The page is being dragged: move to the next page underneath so the
        // app can show it as the page curls away.
        haptic();
        nativeCurlRef.current = true;
        pendingTurnRef.current = e.dir;
        const moved = e.dir === "next" ? rendition.next() : rendition.prev();
        void Promise.resolve(moved)
          .catch(() => undefined)
          .then(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          )
          .then(() => callNative("curlDragReady"));
      } else if (e.type === "curlDragDone") {
        nativeCurlRef.current = false;
        pendingTurnRef.current = null;
        publishCurlZones();
      } else if (e.type === "curlDragCancel" && rendition) {
        // Let go without turning: go back to the page you were on.
        pendingTurnRef.current = e.dir === "next" ? "prev" : "next";
        const back = e.dir === "next" ? rendition.prev() : rendition.next();
        void Promise.resolve(back)
          .catch(() => undefined)
          .then(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          )
          .then(() => {
            nativeCurlRef.current = false;
            pendingTurnRef.current = null;
            void callNative("curlDragRestored");
            publishCurlZones();
          });
      }
    });
    return () => {
      off();
      ro?.disconnect();
      void callNative("curlZones", { enabled: false });
    };
  }, [publishCurlZones]);

  /** Turning back from the first page closes the book onto its cover. */
  const showCoverRef = useRef<() => boolean>(() => false);
  showCoverRef.current = () => {
    if (!prefs.showCover || !coverUrl) return false;
    setCoverOpening(false);
    setCoverShown(true);
    return true;
  };
  const openCover = useCallback(() => {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    haptic();
    if (reduce) setCoverShown(false);
    else setCoverOpening(true);
  }, []);
  const openCoverRef = useRef(openCover);
  openCoverRef.current = openCover;
  /** Follow-along narration state: word highlighter, its document, page-turn lock. */
  const spokenRef = useRef<SpokenHighlighter | null>(null);
  const spokenDocRef = useRef<Document | null>(null);
  const pagingRef = useRef(false);
  /** CFI comparator from epub.js, loaded with the book (kept out of SSR). */
  const cfiRef = useRef<{ compare: (a: string, b: string) => number } | null>(
    null,
  );
  /** Passage being narrated, kept so paging can be re-checked after a re-flow. */
  const lastPassageRef = useRef<string | null>(null);
  /** Latest "is the spoken passage still on this page?" check. */
  const recheckPageRef = useRef<(() => void) | null>(null);

  /** Range of the word currently being spoken, so a tap on it can jump there. */
  const spokenRangeRef = useRef<Range | null>(null);
  /** Latest in-document tap handler, read by the listener added on render. */
  const docTapRef = useRef<((e: PointerEvent | MouseEvent) => void) | null>(
    null,
  );
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
      const CFI = (
        epubjs as unknown as {
          EpubCFI?: new () => { compare: (a: string, b: string) => number };
        }
      ).EpubCFI;
      if (CFI) cfiRef.current = new CFI();

      if (destroyed) return;
      const epub = (ePub as any)(buffer);
      bookRef.current = epub;
      const rendition = epub.renderTo(hostRef.current, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        // Wide screens (an unfolded phone, landscape, a tablet) show two pages
        // side by side like an open book; narrow ones show one.
        spread: "auto",
        minSpreadWidth: MIN_SPREAD_WIDTH,
        // Books are untrusted input (especially ones imported from a link). With
        // scripts allowed, epub.js gives the iframe both allow-scripts and
        // allow-same-origin, so a book's JavaScript could read every book, note
        // and setting in this origin's IndexedDB. Keep book content script-free.
        allowScriptedContent: false,
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
      rendition.on("layout", (layout: any) => {
        if (!destroyed) setSpread(Boolean(layout?.spread));
      });
      await rendition.display(book.location || undefined);
      setSpread(rendition._layout?.divisor === 2);

      if (destroyed) return;
      setReady(true);

      const nav = await epub.loaded.navigation;
      setToc(
        (nav.toc ?? []).map((t: any) => ({
          label: String(t.label ?? "").trim(),
          href: t.href,
        })),
      );

      /**
       * Percentage through the whole book. Only the generated locations index
       * gives a stable figure; before it is ready the spine-index estimate is
       * shown but the stored progress is left untouched, so closing the reader
       * early can no longer overwrite the real number with a coarse guess.
       */
      const percentFor = (
        location: any,
      ): { shown: number; exact: number | null } => {
        const cfi = location?.start?.cfi;
        let exact: number | null = null;
        if (epub.locations?.length()) {
          const ratio =
            (cfi ? epub.locations.percentageFromCfi(cfi) : null) ??
            location?.start?.percentage ??
            0;
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
        paceRef.current.turn(Date.now());
        setChapterLeft(
          chapterLeftLabel(
            location.start?.displayed?.page,
            location.start?.displayed?.total,
            paceRef.current.msPerPage(),
          ),
        );
        onProgress({
          progress: exact ?? book.progress ?? shown,
          location: location.start.cfi,
          chapter: label,
        });

        const anim = prefsRef.current.pageAnim;
        const reduceMotion = window.matchMedia?.(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        const el = hostRef.current;
        const turned = pendingTurnRef.current;
        pendingTurnRef.current = null;
        const sheet = sheetRef.current;
        const flip = flipRef.current;
        // A photo turn may already be under way (started as soon as the new
        // page rendered); then this event has nothing more to animate.
        const flipping = Boolean(
          turned && (flip || activeFlipRef.current || nativeCurlRef.current),
        );
        if (turned && flip) {
          // The new pages are in place under the photo: turn the leaf.
          startFlipRef.current(flip);
        } else if (flipping) {
          // already turning
        } else if (turned && spreadRef.current && sheet) {
          // Over a spread the leaf finishes turning onto the other page.
          sheet.classList.remove(...SHEET_CLASSES);
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          sheet.offsetWidth;
          sheet.classList.add(
            turned === "next" ? "sheet-land-next" : "sheet-land-prev",
          );
        }
        if (el && anim !== "none" && !reduceMotion && !flipping) {
          // A tapped page turn finishes here: the new page settles into view
          // (forward) or swings back down onto the stack (back). Jumps from the
          // contents, search or read-aloud just fade in.
          const cls = turned
            ? turned === "next" || spreadRef.current
              ? "page-turn-settle"
              : "page-turn-back"
            : anim === "slide"
              ? "page-anim-slide"
              : "page-anim-fade";
          el.classList.remove(...PAGE_ANIM_CLASSES);
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          el.offsetWidth;
          el.classList.add(cls);
        }
        if (!flipping) scheduleSnapRef.current();
        inkRef.current?.redraw();
        if (!nativeCurlRef.current) publishCurlZonesRef.current();
        relocatedResolveRef.current?.();
        relocatedResolveRef.current = null;
      });

      rendition.on("keyup", (e: KeyboardEvent) => {
        if (e.key === "ArrowRight") turnRef.current("next");
        if (e.key === "ArrowLeft") turnRef.current("prev");
      });

      // Taps inside the book document: used to jump to the spoken word.
      rendition.on("rendered", (_section: unknown, view: any) => {
        // Name the book frame for screen readers.
        view?.iframe?.setAttribute?.("title", `${book.title} — book text`);
        const doc: Document | undefined =
          view?.document ?? view?.contents?.document;
        doc?.addEventListener(
          "pointerdown",
          (e: PointerEvent) => {
            // The Apple Pencil writes on the page; a finger does the rest.
            if (inkRef.current?.fromFrame(e, view?.iframe ?? null)) return;
            docTapRef.current?.(e);
          },
          true,
        );
      });

      annotations
        .filter((a) => a.type === "highlight" && a.location)
        .forEach((a) => {
          try {
            rendition.annotations.highlight(
              a.location,
              {},
              undefined,
              "aurum-hl",
              {
                fill: a.color,
                "fill-opacity": "0.35",
              },
            );
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
              await updateBook(book.id, {
                locationsIndex: epub.locations.save(),
              });
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
            const label =
              epub.navigation?.get(loc.start.href)?.label?.trim() ?? "";
            onProgress({
              progress: exact,
              location: loc.start.cfi,
              chapter: label,
            });
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
    const colors = THEME_COLORS[readerTheme];
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
          ? {
              "letter-spacing": "0.02em !important",
              "word-spacing": "0.12em !important",
            }
          : {}),
      },
      p: {
        "line-height": `${prefs.lineHeight} !important`,
        "font-family": `${font} !important`,
        ...(prefs.dyslexic
          ? {
              "letter-spacing": "0.02em !important",
              "word-spacing": "0.12em !important",
            }
          : {}),
      },
      a: { color: "#c9a227 !important" },
      ...(prefs.bookTypography
        ? {
            "h1, h2, h3": {
              "font-variant": "small-caps",
              "letter-spacing": "0.06em",
              "font-weight": "600",
              "text-align": "center",
            },
            // The first paragraph after a chapter heading opens with a drop cap.
            "h1 + p::first-letter, h2 + p::first-letter, h3 + p::first-letter":
              {
                float: "left",
                "font-size": "3.4em",
                "line-height": "0.82",
                "padding-top": "0.06em",
                "padding-right": "0.08em",
                color: "#c9a227",
                "font-weight": "600",
              },
          }
        : {}),
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
  }, [prefs, readerTheme, ready, book.fontOverride]);

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
    const text: string | undefined =
      doc?.body?.textContent ?? contents?.content?.textContent;
    return text?.trim() || null;
  }, []);

  /**
   * Turn the page from a tap, swipe key or arrow. With the "turn" animation
   * the current page lifts off its left edge and turns away before the next
   * one is shown; going back, the previous page swings down onto the stack.
   */
  const turnPage = useCallback(
    async (dir: "next" | "prev") => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      // On the cover, "next" opens the book.
      if (coverShownRef.current) {
        if (dir === "next") openCoverRef.current();
        return;
      }
      const go = () =>
        void (dir === "next" ? rendition.next() : rendition.prev());
      const el = hostRef.current;
      const reduceMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const loc = rendition.location;
      const atEdge = dir === "next" ? loc?.atEnd : loc?.atStart;
      if (!atEdge) haptic();
      if (dir === "prev" && loc?.atStart && showCoverRef.current()) {
        haptic();
        return;
      }
      // Tapping again mid-turn: finish that turn and move on straight away.
      if (nativeCurlRef.current) {
        void callNative("curlCancel");
        nativeCurlRef.current = false;
        pendingTurnRef.current = null;
        go();
        return;
      }
      const turning = activeFlipRef.current;
      if (turning) {
        turning.cancel();
        activeFlipRef.current = null;
      }
      if (
        turning ||
        prefsRef.current.pageAnim !== "turn" ||
        reduceMotion ||
        !el ||
        atEdge ||
        pendingTurnRef.current
      ) {
        go();
        return;
      }
      pendingTurnRef.current = dir;
      el.classList.remove(...PAGE_ANIM_CLASSES);
      const sheet = sheetRef.current;
      const stage = stageRef.current;
      const layer = flipLayerRef.current;

      // In the iOS app: Apple's own page curl, drawn natively over the page.
      if (hasNative("curl") && stage) {
        nativeCurlRef.current = true;
        const r = stage.getBoundingClientRect();
        const covered = await callNative<boolean>("curlBegin", {
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          spread: spreadRef.current,
        });
        const moved = dir === "next" ? rendition.next() : rendition.prev();
        if (covered) {
          try {
            await moved;
          } catch {
            /* the page didn't move; the curl still clears itself */
          }
          // Let the new page paint before the app photographs it.
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          if (nativeCurlRef.current)
            await callNative("curlFinish", { forward: dir === "next" });
        }
        nativeCurlRef.current = false;
        pendingTurnRef.current = null;
        return;
      }

      // In the app: lay a photo of the page over it, render the new page
      // underneath, then turn the photographed leaf, curling like paper
      // (relocated handler). One page turning back keeps the swing-down.
      const photoTurn = Boolean(
        canSnapshot() &&
        stage &&
        layer &&
        (spreadRef.current || dir === "next"),
      );
      const snap =
        photoTurn && stage
          ? snapRef.current?.key === snapKey()
            ? snapRef.current.snap
            : await snapshotElement(stage)
          : null;
      snapRef.current = null;
      if (photoTurn && !snap) reportSnapshotProblem();
      if (snap && stage && layer && pendingTurnRef.current === dir) {
        const flip = prepareFlip(
          layer,
          snap,
          dir,
          THEME_COLORS[readerThemeRef.current].bg,
          spreadRef.current ? "spread" : "single",
        );
        flipRef.current = flip;
        // Only change the page once the photo is actually on screen, so the
        // new page never flashes before the turn.
        await flip.ready;
        const moved = dir === "next" ? rendition.next() : rendition.prev();
        // Turn as soon as the new page has rendered underneath.
        void Promise.resolve(moved).then(
          () => startFlipRef.current(flip),
          () => undefined,
        );
      } else if (pendingTurnRef.current !== dir) {
        go();
      } else if (spreadRef.current && sheet) {
        // Two pages: a leaf lifts off one page, the spread changes while it is
        // edge-on, and it lands on the other page (see the relocated handler).
        sheet.classList.remove(...SHEET_CLASSES);
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        sheet.offsetWidth;
        sheet.classList.add(
          dir === "next" ? "sheet-lift-next" : "sheet-lift-prev",
        );
        window.setTimeout(go, SHEET_LIFT_MS);
      } else if (dir === "next") {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        el.offsetWidth;
        el.classList.add("page-turn-away");
        window.setTimeout(go, PAGE_TURN_MS);
      } else {
        go();
      }
      // If the page never moves (end of the book, a load error), put it back.
      window.setTimeout(() => {
        if (pendingTurnRef.current !== dir) return;
        pendingTurnRef.current = null;
        el.classList.remove(...PAGE_ANIM_CLASSES);
        sheetRef.current?.classList.remove(...SHEET_CLASSES);
        flipRef.current?.cancel();
        flipRef.current = null;
      }, 1500);
    },
    [snapKey],
  );
  turnRef.current = turnPage;

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
    return (contents?.document ?? contents?.content?.ownerDocument) as
      Document | undefined;
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
  const jumpToRange = useCallback(
    (range: Range, opts?: { paging?: boolean }) => {
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
    },
    [],
  );

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
  const offsetAtPoint = useCallback(
    (doc: Document, x: number, y: number): number | null => {
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
    },
    [],
  );

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
            x >= r.left - pad &&
            x <= r.right + pad &&
            y >= r.top - pad &&
            y <= r.bottom + pad,
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
      const range = glow
        ? highlighter.paint(span)
        : span
          ? highlighter.rangeFor(span)
          : null;
      spokenRangeRef.current = span && range && glow ? range : null;
      if (!span || !range || pagingRef.current) return;
      if (!isOffPage(range)) return;
      jumpToRange(range, { paging: true });
    },
    [isOffPage, jumpToRange],
  );

  return (
    <div
      id="main-content"
      role="main"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: THEME_COLORS[readerTheme].bg,
        viewTransitionName: BOOK_OPEN,
      }}
    >
      <div
        role="toolbar"
        aria-label="Reader controls"
        hidden={tabletop}
        className="flex items-center justify-between gap-2 border-b border-gold/15 bg-background/95 px-safe-sm pb-2 pt-safe-sm"
      >
        <button
          onClick={onBack}
          aria-label="Back to library"
          className="flex size-11 items-center justify-center text-gold"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground">
          <span className="sr-only">{book.title}</span>
          <span aria-hidden="true">{chapter || book.title}</span>
        </h1>
        <div className="flex items-center gap-1 text-gold">
          <button
            onClick={() => setPanel("toc")}
            aria-label="Table of contents"
            className="flex size-11 items-center justify-center"
          >
            <List className="size-[18px]" />
          </button>
          {showAssistant ? (
            <button
              onClick={() => setAssistant("recap")}
              aria-label="Reading assistant: recap, who's who and questions"
              className="flex size-11 items-center justify-center"
            >
              <Sparkles className="size-[18px]" />
            </button>
          ) : null}
          <button
            onClick={() => setPanel("search")}
            aria-label="Search in book"
            className="flex size-11 items-center justify-center"
          >
            <Search className="size-[18px]" />
          </button>
          <button
            onClick={() => void addBookmark()}
            aria-label="Add bookmark"
            className="flex size-11 items-center justify-center"
          >
            <Bookmark className="size-[18px]" />
          </button>
          <button
            onClick={() => setPanel("settings")}
            aria-label="Reading settings"
            className="flex size-11 items-center justify-center"
          >
            <Palette className="size-[18px]" />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={cn(
          "relative overflow-hidden [perspective:1800px]",
          tabletop ? "h-[50dvh] flex-none" : "flex-1",
        )}
        onPointerDownCapture={(e) => inkRef.current?.fromStage(e.nativeEvent)}
      >
        <div ref={hostRef} className="page-stage h-full w-full" />
        {spread ? (
          <>
            {/* Gutter shadow and page edges so a spread reads as an open book. */}
            <div aria-hidden="true" className="book-gutter" />
            <div aria-hidden="true" className="book-edge book-edge-left" />
            <div aria-hidden="true" className="book-edge book-edge-right" />
          </>
        ) : null}
        <div ref={sheetRef} aria-hidden="true" className="page-sheet" />
        <canvas
          ref={inkCanvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: `rgba(0,0,0,${Math.min(prefs.brightness, 100) / 100})`,
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: `rgba(255,159,10,${(Math.min(prefs.warmth, 100) / 100) * 0.5})`,
          }}
        />
        <div ref={flipLayerRef} aria-hidden="true" className="flip-layer" />
        <button
          aria-label="Previous page"
          onClick={() => {
            if (!inkRef.current?.isActive) void turnPage("prev");
          }}
          className="absolute inset-y-0 left-0 w-[18%]"
        />
        <button
          aria-label="Next page"
          onClick={() => {
            if (!inkRef.current?.isActive) void turnPage("next");
          }}
          className="absolute inset-y-0 right-0 w-[18%]"
        />
        {inkMode ? (
          <div
            role="toolbar"
            aria-label="Pencil ink"
            className="absolute left-3 top-3 z-30 flex items-center gap-1.5 rounded-full border border-gold/30 bg-card/95 px-2 py-1.5 shadow-lux"
          >
            {INK_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Ink colour ${c}`}
                aria-pressed={!inkTool.erasing && inkTool.color === c}
                onClick={() => {
                  const ink = inkRef.current;
                  if (ink) {
                    ink.color = c;
                    ink.erasing = false;
                  }
                  setInkTool({ color: c, erasing: false });
                }}
                className={cn(
                  "size-7 rounded-full border-2",
                  !inkTool.erasing && inkTool.color === c
                    ? "border-ivory"
                    : "border-transparent",
                )}
                style={{ background: c }}
              />
            ))}
            <button
              aria-label="Eraser"
              aria-pressed={inkTool.erasing}
              onClick={() => {
                const erasing = !inkTool.erasing;
                if (inkRef.current) inkRef.current.erasing = erasing;
                setInkTool((t) => ({ ...t, erasing }));
              }}
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-gold",
                inkTool.erasing && "bg-gold/15",
              )}
            >
              <Eraser className="size-4" />
            </button>
            <button
              aria-label="Undo last stroke"
              onClick={() => inkRef.current?.undo()}
              className="flex size-9 items-center justify-center rounded-full text-gold"
            >
              <Undo2 className="size-4" />
            </button>
            <button
              onClick={() => {
                if (window.confirm("Clear all ink on this page?"))
                  inkRef.current?.clearPage();
              }}
              className="min-h-9 rounded-full px-2 text-[10px] uppercase tracking-widest text-gold/80"
            >
              Clear
            </button>
            <button
              onClick={() => inkRef.current?.setActive(false)}
              className="min-h-9 rounded-full bg-gold/15 px-3 text-[10px] uppercase tracking-widest text-gold"
            >
              Done
            </button>
          </div>
        ) : null}
        <TapZoneHint />
        {coverShown && prefs.showCover && coverUrl ? (
          <button
            type="button"
            aria-label={`Open ${book.title}`}
            onClick={openCover}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) setCoverShown(false);
            }}
            className={cn(
              "book-cover-stage absolute inset-0 z-20 flex [perspective:2000px]",
              spread ? "justify-end" : "justify-center",
              coverOpening && "is-opening",
            )}
            style={{ background: THEME_COLORS[readerTheme].bg }}
          >
            {spread ? (
              <span aria-hidden="true" className="book-endpaper">
                <span className="font-display text-2xl text-gold/80">
                  {book.title}
                </span>
                <span className="mt-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {book.author}
                </span>
              </span>
            ) : null}
            <span
              className={cn(
                "book-cover flex h-full items-center justify-center p-4",
                spread ? "w-1/2" : "w-full",
                coverOpening && "book-cover-opening",
              )}
            >
              <img
                src={coverUrl}
                alt=""
                className="max-h-full max-w-full rounded-r-md object-contain shadow-[0_20px_50px_-12px_rgb(0_0_0/0.8)]"
              />
            </span>
          </button>
        ) : null}
      </div>

      {tabletop ? (
        <div
          role="group"
          aria-label="Half-folded controls"
          className="flex flex-1 items-stretch gap-3 border-t border-gold/20 px-safe py-3"
        >
          <button
            onClick={() => void turnPage("prev")}
            aria-label="Previous page"
            className="flex flex-1 items-center justify-center rounded-2xl border border-gold/25 bg-secondary/40 text-gold"
          >
            <ChevronLeft className="size-8" />
          </button>
          <div className="flex w-40 flex-col items-center justify-center gap-2 text-center">
            <button
              onClick={onBack}
              className="text-[11px] uppercase tracking-[0.16em] text-gold/80"
            >
              Library
            </button>
            <p className="line-clamp-2 font-display text-sm text-ivory">
              {chapter || book.title}
            </p>
            <button
              onClick={() => setPanel("settings")}
              aria-label="Reading settings"
              className="flex size-11 items-center justify-center text-gold"
            >
              <Palette className="size-[18px]" />
            </button>
          </div>
          <button
            onClick={() => void turnPage("next")}
            aria-label="Next page"
            className="flex flex-1 items-center justify-center rounded-2xl border border-gold/25 bg-secondary/40 text-gold"
          >
            <ChevronRight className="size-8" />
          </button>
        </div>
      ) : null}

      <footer
        role="group"
        aria-label="Page navigation"
        className="flex items-center gap-3 border-t border-gold/15 bg-background/95 px-safe py-2"
      >
        <button
          onClick={() => void turnPage("prev")}
          aria-label="Previous"
          className="flex size-11 items-center justify-center text-gold"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="h-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-gradient-gold"
              style={{ width: `${percent}%` }}
            />
          </div>
          {chapterLeft ? (
            <p className="truncate text-center text-[10px] text-muted-foreground">
              {chapterLeft}
            </p>
          ) : null}
        </div>
        <span className="w-9 text-right text-[11px] text-gold/80">
          {percent}%
        </span>
        <button
          onClick={() => void turnPage("next")}
          aria-label="Next"
          className="flex size-11 items-center justify-center text-gold"
        >
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
            const text = String(
              contents?.window?.getSelection?.() ?? "",
            ).trim();
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
        {hasNative("translate") ? (
          <button
            aria-label="Translate selected text"
            onClick={() => {
              const contents = renditionRef.current?.getContents?.()?.[0];
              const text = String(
                contents?.window?.getSelection?.() ?? "",
              ).trim();
              if (!text) {
                toast.info(
                  "Select a word or sentence first, then tap Translate",
                );
                return;
              }
              void callNative("translate", { text: text.slice(0, 2000) });
            }}
            className="min-h-11 rounded-full border border-gold/25 px-3 text-[11px] uppercase tracking-widest text-gold/80"
          >
            <Languages className="mr-1 inline size-3" />
            Translate
          </button>
        ) : null}

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

      {assistant ? (
        <ReadingAssistant
          book={book}
          initialTab={assistant}
          getFraction={() =>
            Number(renditionRef.current?.location?.start?.percentage) ||
            book.progress / 100
          }
          onClose={() => setAssistant(null)}
        />
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
            className="absolute inset-0 bg-scrim"
          />
          <div className="pt-safe-sm pb-safe px-safe-sm pr-safe relative ml-auto h-full w-[86%] max-w-sm overflow-y-auto border-l border-gold/25 bg-card">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl capitalize text-gold">
                {panel}
              </h3>
              <button
                onClick={() => setPanel(null)}
                aria-label="Close"
                className="flex size-11 items-center justify-center"
              >
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
              <div className="mt-4 space-y-2">
                <NoteComposer
                  bookId={book.id}
                  location={
                    renditionRef.current?.currentLocation()?.start?.cfi ?? ""
                  }
                  label={chapter || `${percent}%`}
                  onAdded={onAnnotationsChanged}
                />
                <ul className="space-y-2">
                  {annotations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No bookmarks, highlights or notes yet.
                    </p>
                  ) : null}
                  {annotations.map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => {
                          if (a.location)
                            renditionRef.current?.display(a.location);
                          setPanel(null);
                        }}
                        className="w-full rounded-lg border-l-2 bg-secondary/50 p-3 text-left"
                        style={{ borderColor: a.color }}
                      >
                        <p className="text-[10px] uppercase tracking-widest text-gold/70">
                          {a.type} · {a.label}
                        </p>
                        {a.text ? (
                          <p className="mt-1 text-sm text-foreground">
                            {a.text}
                          </p>
                        ) : null}
                        {a.note ? (
                          <p className="mt-1 text-sm italic text-muted-foreground">
                            {a.note}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
