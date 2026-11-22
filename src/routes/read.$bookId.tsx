import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  EpubReader,
  DEFAULT_PREFS,
  type ReaderPrefs,
} from "@/components/reader/EpubReader";
import { PdfReader } from "@/components/reader/PdfReader";
import { CbzReader } from "@/components/reader/CbzReader";
import { TxtReader } from "@/components/reader/TxtReader";
import { BrandMark } from "@/components/BrandMark";
import { ImportButton } from "@/components/ImportButton";
import { ReaderGoalHud } from "@/components/reader/ReaderGoalHud";
import { useDailyGoal } from "@/hooks/useSettings";
import {
  computeStreak,
  minutesOnDay,
  startOfDay,
  type StreakRecovery,
} from "@/lib/goals";
import { ActiveTimer } from "@/lib/active-time";
import { celebrate } from "@/lib/celebrate";
import { BOOK_OPEN } from "@/lib/transitions";
import { announce } from "@/lib/announce";
import { clearLastRead, rememberLastRead } from "@/lib/resume";
import {
  getBook,
  getFile,
  getSetting,
  listAnnotations,
  listBooks,
  setSetting,
  updateBook,
  type Annotation,
  type BookMeta,
} from "@/lib/db";

export const Route = createFileRoute("/read/$bookId")({
  head: () => ({
    meta: [
      { title: "Reading — Aurum" },
      {
        name: "description",
        content: "A calm, offline reading view for your EPUB and PDF books.",
      },
      { property: "og:title", content: "Reading — Aurum" },
      {
        property: "og:description",
        content: "A calm, offline reading view in Aurum.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReaderPage,
});

function ReaderPage() {
  const { bookId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { minutes: dailyGoal } = useDailyGoal();
  const [book, setBook] = useState<BookMeta | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [missingFile, setMissingFile] = useState(false);
  const [liveProgress, setLiveProgress] = useState(0);
  const [dayContext, setDayContext] = useState({
    baseMinutesToday: 0,
    streakBefore: 0,
    savesStreakToday: false,
  });
  const openedAt = useRef(Date.now());
  // Counts only time spent reading: pauses while hidden, caps idle gaps.
  const timer = useRef(new ActiveTimer(Date.now()));
  const baseReadingTime = useRef<number | null>(null);
  const sessionId = useRef(
    Math.random().toString(36).slice(2) + Date.now().toString(36),
  );
  const sessionStartProgress = useRef<number | null>(null);
  const latest = useRef<{
    progress: number;
    location: string;
    chapter: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const [b, a, p, file] = await Promise.all([
        getBook(bookId),
        listAnnotations(bookId),
        getSetting<ReaderPrefs>("readerPrefs", DEFAULT_PREFS),
        getFile(bookId),
      ]);
      setMissingFile(!file);
      setBook(b ?? null);
      baseReadingTime.current = b?.readingTime ?? 0;
      setAnnotations(a);
      setPrefs({ ...DEFAULT_PREFS, ...p });
      setLiveProgress(b?.progress ?? 0);
      setLoaded(true);
      if (b) {
        await updateBook(bookId, {
          lastOpened: Date.now(),
          status: b.status === "finished" ? "finished" : "reading",
        });
        await rememberLastRead(bookId);
      }
    })();
  }, [bookId]);

  // Snapshot today's totals before this session so the in-reader indicator can
  // add live minutes without re-reading the database on every tick.
  useEffect(() => {
    (async () => {
      const all = await listBooks();
      const today = startOfDay(Date.now());
      const dayKeys = new Set(all.flatMap((b) => b.readDays.map(startOfDay)));
      const recoveries = await getSetting<StreakRecovery[]>(
        "streakRecoveries",
        [],
      );
      const before = computeStreak(
        all,
        dayKeys,
        dailyGoal,
        Date.now(),
        recoveries,
      );
      const baseMinutesToday = minutesOnDay(all, today);
      setDayContext({
        baseMinutesToday,
        streakBefore: before.current,
        savesStreakToday: !dayKeys.has(today) || baseMinutesToday === 0,
      });
    })();
  }, [bookId, dailyGoal]);

  const refreshAnnotations = useCallback(() => {
    void listAnnotations(bookId).then(setAnnotations);
  }, [bookId]);

  const onPrefs = useCallback((next: ReaderPrefs) => {
    setPrefs(next);
    void setSetting("readerPrefs", next);
  }, []);

  const announcedChapter = useRef("");
  const announcedPercent = useRef(-1);
  const announceTimer = useRef<number | null>(null);
  const onProgress = useCallback(
    (p: { progress: number; location: string; chapter: string }) => {
      latest.current = p;
      timer.current.activity(Date.now());
      setLiveProgress(p.progress);
      // Mirror page turns into the live region for screen-reader users:
      // chapter changes announce at once; plain page turns are debounced so
      // flipping quickly collapses into a single announcement of the landing
      // spot instead of a stream of percentages.
      const percent = Math.round(p.progress);
      if (p.chapter && p.chapter !== announcedChapter.current) {
        announcedChapter.current = p.chapter;
        announcedPercent.current = percent;
        announce(`${p.chapter} · ${percent}% through the book`);
      } else if (percent !== announcedPercent.current) {
        announcedPercent.current = percent;
        if (announceTimer.current) window.clearTimeout(announceTimer.current);
        announceTimer.current = window.setTimeout(() => {
          announce(
            p.chapter
              ? `${p.chapter} · ${percent}% through the book`
              : `${percent}% through the book`,
          );
        }, 900);
      }
    },
    [],
  );

  const persist = useCallback(async () => {
    // Nothing was read while the book's file was missing.
    if (!book || missingFile) return;
    const now = Date.now();
    const activeMs = timer.current.elapsed(now);
    const today = new Date(now).setHours(0, 0, 0, 0);
    const p = latest.current;
    if (sessionStartProgress.current === null)
      sessionStartProgress.current = book.progress ?? 0;
    const session = {
      id: sessionId.current,
      start: openedAt.current,
      end: now,
      progressStart: sessionStartProgress.current,
      progressEnd: p?.progress ?? book.progress ?? 0,
      chapter: p?.chapter ?? book.chapter ?? "",
      activeMs,
    };
    // Build the patch from the stored record, not the copy loaded when the
    // reader opened, so edits made meanwhile (metadata, the EPUB locations
    // index) are kept.
    let justFinished = false;
    await updateBook(book.id, (cur) => {
      justFinished = cur.status !== "finished" && (p?.progress ?? 0) >= 98;
      const prior = (cur.sessions ?? []).filter((s) => s.id !== session.id);
      return {
        readingTime: (baseReadingTime.current ?? cur.readingTime) + activeMs,
        readDays: cur.readDays.includes(today)
          ? cur.readDays
          : [...cur.readDays, today],
        sessions: [...prior, session].slice(-400),
        ...(p
          ? {
              progress: p.progress,
              location: p.location,
              chapter: p.chapter,
              ...(p.progress >= 98
                ? {
                    status: "finished" as const,
                    finishedAt: cur.finishedAt ?? now,
                  }
                : {}),
            }
          : {}),
      };
    });
    if (justFinished)
      celebrate({ title: "Book finished", subtitle: book.title });
    // Keep library/stats queries in sync so the stats page is current the moment
    // the reader is closed.
    void qc.invalidateQueries({ queryKey: ["books"] });
  }, [book, missingFile, qc]);

  // Taps, keys and scrolling count as reading; hiding the app pauses the clock.
  useEffect(() => {
    const onActivity = () => timer.current.activity(Date.now());
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        timer.current.pause(Date.now());
        void persist();
      } else {
        timer.current.resume(Date.now());
      }
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persist]);

  useEffect(() => {
    const interval = window.setInterval(() => void persist(), 15000);
    const onHide = () => void persist();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", onHide);
      void persist();
    };
  }, [persist]);

  const back = () => {
    // Leaving on purpose means the next launch should open the library, not this book.
    void persist()
      .then(clearLastRead)
      .then(() => {
        // Share the new position with other devices, if sync is set up.
        void import("@/lib/sync")
          .then((m) => m.autoSync())
          .then(() => qc.invalidateQueries({ queryKey: ["syncStatus"] }));
        return navigate({ to: "/" });
      });
  };

  if (!loaded) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background"
        style={{ viewTransitionName: BOOK_OPEN }}
      >
        <BrandMark size={64} label="Aurum logo" />
        <p className="font-display text-2xl text-gradient-gold">Aurum</p>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">
          This book is no longer in your library.
        </p>
        <button
          onClick={() => void navigate({ to: "/" })}
          className="text-gold underline"
        >
          Back to library
        </button>
      </div>
    );
  }

  if (missingFile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <BrandMark size={48} label="Aurum logo" />
        <p className="font-display text-2xl text-ivory">{book.title}</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          This book was synced from another device, but its file isn&apos;t on
          this one yet. Import the same file here and it opens at your synced
          place, with your notes.
        </p>
        <ImportButton
          label="Import the book file"
          onDone={() =>
            void getFile(bookId).then((f) => {
              if (f) {
                timer.current = new ActiveTimer(Date.now());
                setMissingFile(false);
              }
            })
          }
        />
        <button
          onClick={() => void navigate({ to: "/" })}
          className="text-sm text-gold underline"
        >
          Back to library
        </button>
      </div>
    );
  }

  const goalHud = (
    <ReaderGoalHud
      book={book}
      progress={liveProgress}
      baseMinutesToday={dayContext.baseMinutesToday}
      sessionMs={(now) => timer.current.elapsed(now)}
      dailyGoal={dailyGoal}
      streakBefore={dayContext.streakBefore}
      savesStreakToday={dayContext.savesStreakToday}
    />
  );

  const shared = {
    book,
    goalHud,
    prefs,
    onPrefs,
    annotations,
    onAnnotationsChanged: refreshAnnotations,
    onProgress,
    onBack: back,
  };

  return (
    <>
      {book.format === "pdf" ? (
        <PdfReader {...shared} />
      ) : book.format === "cbz" || book.format === "cbr" ? (
        <CbzReader {...shared} />
      ) : book.format === "txt" ? (
        <TxtReader {...shared} />
      ) : (
        <EpubReader {...shared} />
      )}
    </>
  );
}
