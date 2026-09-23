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
import { ReaderGoalHud } from "@/components/reader/ReaderGoalHud";
import { useDailyGoal } from "@/hooks/useSettings";
import {
  computeStreak,
  minutesOnDay,
  startOfDay,
  type StreakRecovery,
} from "@/lib/goals";
import { clearLastRead, rememberLastRead } from "@/lib/resume";
import {
  getBook,
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
  const [liveProgress, setLiveProgress] = useState(0);
  const [dayContext, setDayContext] = useState({
    baseMinutesToday: 0,
    streakBefore: 0,
    savesStreakToday: false,
  });
  const openedAt = useRef(Date.now());
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
      const [b, a, p] = await Promise.all([
        getBook(bookId),
        listAnnotations(bookId),
        getSetting<ReaderPrefs>("readerPrefs", DEFAULT_PREFS),
      ]);
      setBook(b ?? null);
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

  const onProgress = useCallback(
    (p: { progress: number; location: string; chapter: string }) => {
      latest.current = p;
      setLiveProgress(p.progress);
    },
    [],
  );

  const persist = useCallback(async () => {
    if (!book) return;
    const elapsed = Date.now() - openedAt.current;
    const today = new Date().setHours(0, 0, 0, 0);
    const days = book.readDays.includes(today)
      ? book.readDays
      : [...book.readDays, today];
    const p = latest.current;
    if (sessionStartProgress.current === null)
      sessionStartProgress.current = book.progress ?? 0;
    const session = {
      id: sessionId.current,
      start: openedAt.current,
      end: Date.now(),
      progressStart: sessionStartProgress.current,
      progressEnd: p?.progress ?? book.progress ?? 0,
      chapter: p?.chapter ?? book.chapter ?? "",
    };
    const prior = (book.sessions ?? []).filter((s) => s.id !== session.id);
    await updateBook(book.id, {
      readingTime: book.readingTime + elapsed,
      readDays: days,
      sessions: [...prior, session].slice(-400),
      ...(p
        ? {
            progress: p.progress,
            location: p.location,
            chapter: p.chapter,
            ...(p.progress >= 98
              ? {
                  status: "finished" as const,
                  finishedAt: book.finishedAt ?? Date.now(),
                }
              : {}),
          }
        : {}),
    });
    // Keep library/stats queries in sync so the stats page is current the moment
    // the reader is closed.
    void qc.invalidateQueries({ queryKey: ["books"] });
  }, [book, qc]);

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
      .then(() => navigate({ to: "/" }));
  };

  if (!loaded) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
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

  const goalHud = (
    <ReaderGoalHud
      book={book}
      progress={liveProgress}
      baseMinutesToday={dayContext.baseMinutesToday}
      sessionStart={openedAt.current}
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
