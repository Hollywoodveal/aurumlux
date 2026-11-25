import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { allAnnotations, getCover, getSetting, listBooks } from "@/lib/db";
import {
  DEFAULT_DAILY_GOAL,
  computeStreak,
  estimateMinutesLeft,
  startOfDay,
  type StreakRecovery,
} from "@/lib/goals";
import { pickContinueBook } from "@/lib/continue-book";
import { detectFormat, findDuplicate, importFile } from "@/lib/importer";
import {
  callNative,
  connectNative,
  isNativeApp,
  onNativeEvent,
  type NativeEvent,
} from "@/lib/native";

const SUPPORTED = ["epub", "pdf", "cbz", "txt"];

/** A small JPEG of the cover for the widget (widgets have tight memory). */
async function widgetCover(id: string): Promise<string> {
  const blob = await getCover(id);
  if (!blob) return "";
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return "";
  }
}

let lastCoverFor: string | null = null;
let lastSpotlight = "";

/** Sends the widgets and iPhone search what they show. Cheap to call often. */
export async function publishNativeSnapshots() {
  if (!isNativeApp()) return;
  const [books, dailyGoal, recoveries] = await Promise.all([
    listBooks(),
    getSetting<number>("dailyGoalMinutes", DEFAULT_DAILY_GOAL),
    getSetting<StreakRecovery[]>("streakRecoveries", []),
  ]);

  // Widgets: current book, progress and streak.
  const dayKeys = new Set<number>();
  for (const b of books) for (const d of b.readDays) dayKeys.add(startOfDay(d));
  const streak = computeStreak(
    books,
    dayKeys,
    dailyGoal,
    Date.now(),
    recoveries,
  );
  const book = pickContinueBook(books);
  const widget: Record<string, unknown> = {
    book: book
      ? {
          id: book.id,
          title: book.title,
          author: book.author,
          progress: Math.round(book.progress),
          minutesLeft: estimateMinutesLeft(book),
        }
      : null,
    streak: streak.current,
    todayMinutes: streak.todayMinutes,
    dailyGoal,
  };
  const coverKey = book ? `${book.id}:${book.hasCover}` : "";
  if (coverKey !== lastCoverFor) {
    widget.cover = book?.hasCover ? await widgetCover(book.id) : "";
    lastCoverFor = coverKey;
  }
  await callNative("widget", widget);

  // Spotlight: titles, authors, highlights and notes.
  const titles = new Map(books.map((b) => [b.id, b.title]));
  const notes = (await allAnnotations())
    .filter((a) => a.type !== "bookmark" && titles.has(a.bookId))
    .slice(-2000)
    .map((a) => ({
      id: a.id,
      bookId: a.bookId,
      bookTitle: titles.get(a.bookId) ?? "",
      text: a.text.slice(0, 500),
      note: a.note.slice(0, 500),
    }));
  const payload = {
    books: books.map((b) => ({ id: b.id, title: b.title, author: b.author })),
    notes,
  };
  const signature = JSON.stringify(payload);
  if (signature !== lastSpotlight) {
    lastSpotlight = signature;
    await callNative("spotlight", payload);
  }
}

/**
 * Connects the web app to the iPhone app: books opened from Files and other
 * apps, widget and Siri taps, Spotlight results, and keeping the widgets and
 * search up to date. Renders nothing; does nothing in a browser.
 */
export function NativeBridge() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!isNativeApp()) return;

    const openBook = (id: string) => {
      void navigateRef.current({ to: "/read/$bookId", params: { bookId: id } });
    };

    const importFiles = async (
      files: { id: string; name: string; url: string }[],
    ) => {
      let added = 0;
      let lastId: string | null = null;
      for (const f of files) {
        try {
          const fmt = detectFormat(f.name) ?? "";
          if (!SUPPORTED.includes(fmt)) {
            toast.error(`${f.name}: EPUB, PDF, CBZ and TXT are supported`);
            continue;
          }
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(`Couldn't open ${f.name}`);
          const file = new File([await res.blob()], f.name, {
            type: res.headers.get("content-type") ?? "",
          });
          const { hash, existing } = await findDuplicate(file);
          if (existing) {
            toast.info(`${existing.title} is already in your library`);
            lastId = existing.id;
            continue;
          }
          const book = await importFile(file, hash);
          lastId = book.id;
          added += 1;
        } catch (error) {
          console.error(error);
          toast.error(
            error instanceof Error ? error.message : `Couldn't open ${f.name}`,
          );
        } finally {
          void callNative("releaseInbox", { id: f.id });
        }
      }
      void qc.invalidateQueries();
      if (added > 0)
        toast.success(
          `${added} book${added > 1 ? "s" : ""} added to your library`,
        );
      // One book: open it straight away, like tapping it in Files expects.
      if (files.length === 1 && lastId) openBook(lastId);
      void publishNativeSnapshots();
    };

    const off = onNativeEvent((event: NativeEvent) => {
      switch (event.type) {
        case "openFiles":
          void importFiles(event.files);
          break;
        case "continueReading":
          void listBooks().then((books) => {
            const book = pickContinueBook(books);
            if (book) openBook(book.id);
            else void navigateRef.current({ to: "/" });
          });
          break;
        case "openBook":
          openBook(event.id);
          break;
        case "navigate":
          void navigateRef.current({ to: event.to as "/" });
          break;
        default:
          break;
      }
    });

    const icloud = () =>
      void import("@/lib/icloud-sync")
        .then((m) => m.autoSyncICloud())
        .then((r) => {
          if (r && r.positions + r.added + r.removed + r.annotations > 0)
            void qc.invalidateQueries();
        });

    void connectNative().then(() => {
      void publishNativeSnapshots();
      icloud();
    });

    // Leaving the app is when the widgets most need to be current; coming
    // back is when another device may have synced.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void publishNativeSnapshots();
        icloud();
      } else {
        icloud();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [qc]);

  // After closing a book or changing screens, refresh the widgets.
  useEffect(() => {
    if (!isNativeApp()) return;
    const id = window.setTimeout(() => void publishNativeSnapshots(), 1500);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return null;
}
