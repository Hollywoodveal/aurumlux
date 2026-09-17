/* eslint-disable @typescript-eslint/no-explicit-any */
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, ChevronLeft, Palette, X } from "lucide-react";
import { toast } from "sonner";
import { getFile, putAnnotation, uid, type Annotation, type BookMeta } from "@/lib/db";
import { ReaderSettings, type ReaderPrefs } from "./EpubReader";
import { ReadAloudBar } from "./ReadAloudBar";
import { THEME_COLORS, resolveFont, resolveReaderTheme, withPrefDefaults } from "@/lib/reader-prefs";
import { useAppTheme } from "@/hooks/useAppTheme";

/** Find a whitespace-normalised passage inside the raw text, from `from` onward. */
function findPassage(hay: string, passage: string, from: number): number {
  const words = passage
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return -1;
  const re = new RegExp(words.join("\\s+"));
  const m = re.exec(hay.slice(from));
  return m ? from + m.index : -1;
}


export function TxtReader({
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
  const [text, setText] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "settings" | "notes">(null);
  const [percent, setPercent] = useState(book.progress);
  const scrollRef = useRef<HTMLDivElement>(null);
  const paraRef = useRef<HTMLParagraphElement>(null);
  const restored = useRef(false);
  const textRef = useRef<string | null>(null);
  /** Where narration is up to in the raw text, so pages follow the voice. */
  const spokenCursor = useRef(0);

  textRef.current = text;

  const fullPrefs = withPrefDefaults(prefs);
  const theme = THEME_COLORS[resolveReaderTheme(fullPrefs.theme, useAppTheme())] ?? THEME_COLORS.dark;
  const font = resolveFont(fullPrefs, book.fontOverride);

  /** Scroll a character range into comfortable view (auto page-turn while reading). */
  const revealRange = useCallback((start: number, end: number) => {
    const para = paraRef.current;
    const box = scrollRef.current;
    const node = para?.firstChild;
    if (!para || !box || !node) return;
    const len = node.textContent?.length ?? 0;
    if (start >= len) return;
    const range = document.createRange();
    range.setStart(node, Math.max(0, Math.min(start, len)));
    range.setEnd(node, Math.max(0, Math.min(end, len)));
    const rect = range.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (rect.height === 0) return;
    if (rect.top < view.top + 32 || rect.bottom > view.bottom - 32) {
      box.scrollTop += rect.top - view.top - box.clientHeight * 0.3;
    }
  }, []);

  /** Narrate from the reader's current position in the file. */
  const getSectionText = useCallback(async () => {
    const full = textRef.current;
    const box = scrollRef.current;
    if (!full) return null;
    const max = box ? box.scrollHeight - box.clientHeight : 0;
    const ratio = box && max > 0 ? box.scrollTop / max : 0;
    const from = Math.floor(ratio * full.length);
    spokenCursor.current = from;
    return full.slice(from);
  }, []);

  const onPassage = useCallback(
    (passage: string | null) => {
      const full = textRef.current;
      if (!passage || !full) return;
      const at = findPassage(full, passage, spokenCursor.current);
      if (at < 0) return;
      spokenCursor.current = at + Math.max(1, Math.floor(passage.length * 0.8));
      revealRange(at, at + Math.min(passage.length, 80));
    },
    [revealRange],
  );


  useEffect(() => {
    let destroyed = false;
    (async () => {
      const blob = await getFile(book.id);
      if (!blob || destroyed) return;
      const content = await blob.text();
      if (!destroyed) setText(content);
    })();
    return () => {
      destroyed = true;
    };
  }, [book.id]);

  // Restore scroll position from the stored ratio once content is rendered.
  useEffect(() => {
    if (text === null || restored.current) return;
    const el = scrollRef.current;
    if (!el) return;
    restored.current = true;
    const ratio = Number(book.location) || 0;
    requestAnimationFrame(() => {
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) el.scrollTop = ratio * max;
    });
  }, [text, book.location]);

  const report = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const ratio = max > 0 ? el.scrollTop / max : 0;
    const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
    setPercent(pct);
    onProgress({ progress: pct, location: ratio.toFixed(4), chapter: "" });
  }, [onProgress]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(report);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [report]);

  async function addBookmark() {
    const el = scrollRef.current;
    const max = el ? el.scrollHeight - el.clientHeight : 0;
    const ratio = el && max > 0 ? el.scrollTop / max : 0;
    await putAnnotation({
      id: uid(),
      bookId: book.id,
      type: "bookmark",
      color: "#c9a227",
      text: "",
      note: "",
      location: ratio.toFixed(4),
      label: `${Math.round(ratio * 100)}%`,
      createdAt: Date.now(),
    });
    onAnnotationsChanged();
    toast.success("Bookmark saved");
  }

  function jumpTo(ratio: number) {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = ratio * max;
  }

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
          <button onClick={() => void addBookmark()} aria-label="Add bookmark" className="flex size-11 items-center justify-center">
            <Bookmark className="size-[18px]" />
          </button>
          <button onClick={() => setPanel("settings")} aria-label="Reading settings" className="flex size-11 items-center justify-center">
            <Palette className="size-[18px]" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ color: theme.fg }}>
        {text === null ? (
          <p className="py-20 text-center text-sm text-muted-foreground">Opening text…</p>
        ) : (
          <p
            ref={paraRef}
            className="mx-auto max-w-2xl whitespace-pre-wrap py-8"
            style={{
              fontFamily: font,
              fontSize: `${fullPrefs.fontSize}%`,
              lineHeight: fullPrefs.lineHeight,
              paddingLeft: `${fullPrefs.margin}px`,
              paddingRight: `${fullPrefs.margin}px`,
            }}
          >
            {text}
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-gold/15 bg-background/95 px-safe pb-safe-sm py-2">
        <div className="flex w-full items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-gradient-gold" style={{ width: `${percent}%` }} />
          </div>
          <span className="w-9 text-right text-[11px] text-gold/80">{percent}%</span>
          <button
            onClick={() => setPanel("notes")}
            className="rounded-full border border-gold/25 px-3 py-1 text-[11px] uppercase tracking-widest text-gold/80"
          >
            Notes ({annotations.length})
          </button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2">
          <ReadAloudBar
            getSectionText={getSectionText}
            onSectionEnd={async () => false}
            rate={fullPrefs.speechRate}
            onPassage={onPassage}
            mediaTitle={book.title}
            mediaArtist={book.author}
          />
          {goalHud}
        </div>
      </footer>


      {panel === "settings" ? (
        <ReaderSettings prefs={prefs} onChange={onPrefs} onClose={() => setPanel(null)} />
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
                      jumpTo(Number(a.location) || 0);
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
