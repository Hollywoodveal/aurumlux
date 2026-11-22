import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  FolderPlus,
  Heart,
  Layers,
  Pencil,
  Share2,
  Target,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { BookBadge } from "@/components/BookBadge";
import { CoverImage } from "@/components/CoverImage";
import { MetadataDialog } from "@/components/MetadataDialog";
import { StarRating } from "@/components/StarRating";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAnnotations, useBookMutations } from "@/hooks/useLibrary";
import {
  buildNotesMarkdown,
  notesFileName,
  shareOrDownload,
} from "@/lib/export-notes";
import type { BookMeta, ReadingStatus } from "@/lib/db";
import {
  bookGoalStatus,
  buildExternalSessionPatch,
  estimateMinutesLeft,
  formatMinutesLeft,
  fromDateInput,
  startOfDay,
  toDateInput,
} from "@/lib/goals";
import { DYSLEXIC_FONT, READER_FONTS } from "@/lib/reader-prefs";
import { celebrate } from "@/lib/celebrate";
import { prepareBookOpen } from "@/lib/transitions";
import { useCoverColor } from "@/hooks/useCoverColor";
import { cn } from "@/lib/utils";

const STATUSES: { value: ReadingStatus; label: string }[] = [
  { value: "want", label: "Want to read" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
];

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function BookDetails({
  book,
  onClose,
}: {
  book: BookMeta;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { save, remove } = useBookMutations();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logPages, setLogPages] = useState("");
  const [logMinutes, setLogMinutes] = useState("");
  const [logDate, setLogDate] = useState(toDateInput(Date.now()));
  const { data: allNotes } = useAnnotations();
  const notes = allNotes.filter((a) => a.bookId === book.id);
  const sheetRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const glow = useCoverColor(book);
  const drag = useRef<{ startY: number; dy: number } | null>(null);

  // Drag the handle down to dismiss, like a native sheet.
  const onDragStart = (e: ReactPointerEvent) => {
    drag.current = { startY: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: ReactPointerEvent) => {
    if (!drag.current || !sheetRef.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.startY);
    sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`;
    sheetRef.current.style.transition = "none";
  };
  const onDragEnd = () => {
    const dy = drag.current?.dy ?? 0;
    drag.current = null;
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = "transform 200ms ease-out";
    if (dy > 110) {
      el.style.transform = "translateY(100%)";
      window.setTimeout(onClose, 180);
    } else {
      el.style.transform = "";
    }
  };

  const goal = bookGoalStatus(book);
  const minutesLeft = estimateMinutesLeft(book);
  const timeLeftText =
    minutesLeft === null
      ? goal.projectedDays
        ? ` · about ${goal.projectedDays} day${goal.projectedDays === 1 ? "" : "s"} to finish`
        : ""
      : ` · ≈ ${formatMinutesLeft(minutesLeft)} left at your pace`;

  const setRating = (rating: number) => {
    save.mutate({ id: book.id, patch: { rating } });
    toast.success(rating ? `Rated ${rating} of 5` : "Rating cleared");
  };

  const setStatus = (status: ReadingStatus) => {
    if (status === "finished" && book.status !== "finished")
      celebrate({ title: "Book finished", subtitle: book.title });
    save.mutate({
      id: book.id,
      patch: {
        status,
        ...(status === "finished"
          ? { finishedAt: book.finishedAt ?? Date.now(), progress: 100 }
          : {}),
      },
    });
  };

  /** Log reading done on another device (e.g. a Kindle) so streaks, goals, and pace stay current. */
  const logSession = async () => {
    const amount = logPages === "" ? NaN : Number(logPages);
    const minutes = Number(logMinutes);
    const day = fromDateInput(logDate) ?? startOfDay(Date.now());
    const progressGiven =
      book.pageCount > 0 ? amount > 0 : amount > 0 && amount <= 100;
    if (!progressGiven && !(minutes > 0)) {
      toast.info(
        book.pageCount > 0
          ? "Enter pages read, or minutes, or both"
          : "Enter progress %, or minutes, or both",
      );
      return;
    }
    const patch = buildExternalSessionPatch(book, {
      pages: book.pageCount > 0 && amount > 0 ? amount : undefined,
      progressTo:
        book.pageCount <= 0 && amount > 0 && amount <= 100 ? amount : undefined,
      minutes: minutes > 0 ? minutes : 0,
      day,
    });
    await save.mutateAsync({ id: book.id, patch });
    setLogPages("");
    setLogMinutes("");
    setLogDate(toDateInput(Date.now()));
    setLogOpen(false);
    toast.success(
      patch.status === "finished"
        ? "Logged — and that's a finish!"
        : `Logged · now ${Math.round(patch.progress ?? book.progress)}% through`,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 z-0 bg-scrim backdrop-blur-sm"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${book.title}`}
        className="animate-rise relative z-10 max-h-[88svh] w-full overflow-y-auto overflow-x-hidden rounded-t-3xl border-t border-gold/25 bg-card px-safe pb-safe pt-4 shadow-lux sm:max-w-md sm:rounded-3xl sm:pb-6"
      >
        {glow ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-72"
            style={{
              background: `radial-gradient(120% 80% at 30% 0%, rgb(${glow} / 0.38), transparent 70%)`,
            }}
          />
        ) : null}
        {/* Blurred cover wash behind the top of the sheet. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden opacity-30"
        >
          <CoverImage book={book} className="scale-125 blur-2xl" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/70 to-card" />
        </div>
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="relative -mt-2 mb-2 flex cursor-grab touch-none justify-center py-2"
          aria-hidden
        >
          <div className="h-1 w-12 rounded-full bg-gold/40" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground"
        >
          <X className="size-5" />
        </button>

        <div className="relative flex gap-4">
          <div
            ref={coverRef}
            className="h-[168px] w-[112px] shrink-0 overflow-hidden rounded-md hairline-gold shadow-lux"
          >
            <CoverImage book={book} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl leading-tight text-ivory">
              {book.title}
            </h2>
            {book.subtitle ? (
              <p className="mt-1 text-sm italic text-muted-foreground">
                {book.subtitle}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-gold/90">
              {book.author || "Unknown author"}
            </p>
            <BookBadge book={book} className="mt-1.5" />
            {book.series ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {book.series}
              </p>
            ) : null}
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {book.format.toUpperCase()} · {book.pageCount || "?"} pages ·{" "}
              {fmtSize(book.fileSize)}
            </p>
            <StarRating
              value={book.rating}
              onChange={setRating}
              className="mt-1 -ml-3"
            />
          </div>
        </div>

        <div className="relative mt-5 flex gap-2">
          <Button
            className="h-12 flex-1 bg-gradient-gold text-base text-primary-foreground shadow-lux"
            onClick={() => {
              void navigate({
                to: "/read/$bookId",
                params: { bookId: book.id },
                viewTransition: prepareBookOpen(coverRef.current),
              });
            }}
          >
            <BookOpen className="size-4" />
            {book.progress > 0
              ? `Continue · ${Math.round(book.progress)}%`
              : "Read"}
          </Button>
          <Button
            variant="outline"
            aria-label="Toggle favorite"
            className={cn(
              "h-12 border-gold/30",
              book.favorite && "bg-gold/15 text-gold",
            )}
            onClick={() =>
              save.mutate({ id: book.id, patch: { favorite: !book.favorite } })
            }
          >
            <Heart className={cn("size-4", book.favorite && "fill-current")} />
          </Button>
          <Button
            variant="outline"
            aria-label="Edit metadata"
            className="h-12 border-gold/30"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" />
          </Button>
          {notes.length > 0 ? (
            <Button
              variant="outline"
              aria-label={`Export ${notes.length} highlights and notes`}
              title="Export highlights & notes"
              className="h-12 border-gold/30"
              onClick={async () => {
                const how = await shareOrDownload(
                  buildNotesMarkdown([book], notes, { bookId: book.id }),
                  notesFileName(book),
                );
                if (how === "downloaded") toast.success("Notes exported");
              }}
            >
              <Share2 className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="mt-4 flex gap-2">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatus(s.value)}
              className={cn(
                "flex-1 rounded-full border px-3 py-2 text-xs tracking-wide transition-colors",
                book.status === s.value
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-border text-muted-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {book.progress > 0 ? (
          <div className="mt-4">
            <div className="h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-gradient-gold"
                style={{ width: `${book.progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {Math.round(book.progress)}% complete
              {book.chapter ? ` · ${book.chapter}` : ""}
              {book.readingTime
                ? ` · ${Math.round(book.readingTime / 60000)} min read`
                : ""}
            </p>
          </div>
        ) : null}

        <section className="mt-4 rounded-xl border border-gold/20 bg-secondary/30 p-3">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-gold/70">
              <BookOpen className="size-3.5" /> Read on your Kindle?
            </span>
            <span className="text-xs text-muted-foreground">
              {logOpen ? "Hide" : "Log it"}
            </span>
          </button>
          {logOpen && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Log a session from another device and your streak, daily goal,
                and pace stay current.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {book.pageCount > 0 ? "Pages read" : "Progress now (%)"}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder={book.pageCount > 0 ? "e.g. 40" : "e.g. 65"}
                    value={logPages}
                    onChange={(e) => setLogPages(e.target.value)}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Minutes (optional)
                  </span>
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="e.g. 30"
                    value={logMinutes}
                    onChange={(e) => setLogMinutes(e.target.value)}
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Day
                </span>
                <Input
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                />
              </label>
              <Button
                className="w-full bg-gradient-gold text-xs text-primary-foreground"
                onClick={() => void logSession()}
              >
                Log session
              </Button>
            </div>
          )}
        </section>

        <section className="mt-5 rounded-xl border border-gold/20 bg-secondary/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-gold/70">
              <Target className="size-3.5" /> Reading goal
            </h3>
            {goal.hasGoal && !goal.done ? (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]",
                  goal.overdue
                    ? "border-destructive/50 text-destructive"
                    : goal.onTrack
                      ? "border-gold/50 text-gold"
                      : "border-border text-muted-foreground",
                )}
              >
                {goal.overdue
                  ? "Past due"
                  : goal.onTrack
                    ? "On track"
                    : "Behind"}
              </span>
            ) : null}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Finish by
              </span>
              <input
                type="date"
                aria-label="Finish this book by date"
                value={toDateInput(book.goalTargetDate)}
                onChange={(e) =>
                  save.mutate({
                    id: book.id,
                    patch: { goalTargetDate: fromDateInput(e.target.value) },
                  })
                }
                className="mt-1 w-full rounded-lg border border-gold/25 bg-background px-2 py-1.5 text-sm text-ivory"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Minutes / day
              </span>
              <input
                type="number"
                min={0}
                step={5}
                inputMode="numeric"
                aria-label="Daily minutes target for this book"
                value={book.goalDailyMinutes ?? ""}
                placeholder="0"
                onChange={(e) =>
                  save.mutate({
                    id: book.id,
                    patch: {
                      goalDailyMinutes: Math.max(
                        0,
                        Number(e.target.value) || 0,
                      ),
                    },
                  })
                }
                className="mt-1 w-full rounded-lg border border-gold/25 bg-background px-2 py-1.5 text-sm text-ivory"
              />
            </label>
          </div>

          {goal.hasGoal ? (
            <>
              {goal.dailyMinutes > 0 ? (
                <div className="mt-3">
                  <div className="h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-gradient-gold"
                      style={{
                        width: `${Math.min(100, (goal.minutesToday / goal.dailyMinutes) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    <span className="text-gold">
                      {goal.minutesToday}/{goal.dailyMinutes} min
                    </span>{" "}
                    today
                  </p>
                </div>
              ) : null}
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {goal.done
                  ? "Goal complete — this one is finished."
                  : goal.daysLeft !== null
                    ? `${goal.remaining.toFixed(0)}% left · ${
                        goal.daysLeft < 0
                          ? `${Math.abs(goal.daysLeft)} days past due`
                          : `${goal.daysLeft} day${goal.daysLeft === 1 ? "" : "s"} left`
                      } · need ~${(goal.requiredPerDay ?? 0).toFixed(1)}%/day, reading ~${goal.pacePerDay.toFixed(1)}%/day${timeLeftText}`
                    : `${goal.remaining.toFixed(0)}% left · reading ~${goal.pacePerDay.toFixed(1)}%/day${timeLeftText}`}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Set a finish date or a daily target and Aurum will track your pace
              on the stats page.
            </p>
          )}
        </section>

        <section className="mt-3 rounded-xl border border-gold/20 bg-secondary/30 p-3">
          <label
            htmlFor={`font-${book.id}`}
            className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-gold/80"
          >
            <Type className="size-3.5" /> Typeface for this book
          </label>
          <select
            id={`font-${book.id}`}
            value={book.fontOverride ?? ""}
            onChange={(e) =>
              save.mutate({
                id: book.id,
                patch: { fontOverride: e.target.value || null },
              })
            }
            className="mt-2 w-full rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold/50"
          >
            <option value="">Use my reader default</option>
            {READER_FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
            <option value={DYSLEXIC_FONT}>
              Readable (Atkinson Hyperlegible)
            </option>
          </select>
        </section>

        <section className="mt-3 rounded-xl border border-gold/20 bg-secondary/30 p-3">
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-gold/80">
            <Layers className="size-3.5" /> Collections
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(book.collections ?? []).map((name) => (
              <button
                key={name}
                type="button"
                aria-label={`Remove from ${name}`}
                onClick={() =>
                  save.mutate({
                    id: book.id,
                    patch: {
                      collections: (book.collections ?? []).filter(
                        (c) => c !== name,
                      ),
                    },
                  })
                }
                className="flex min-h-9 items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 text-[11px] text-gold"
              >
                {name} <X className="size-3" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const name = window.prompt("Collection name")?.trim();
                if (!name) return;
                save.mutate({
                  id: book.id,
                  patch: {
                    collections: [
                      ...new Set([...(book.collections ?? []), name]),
                    ],
                  },
                });
              }}
              className="flex min-h-9 items-center gap-1.5 rounded-full border border-gold/25 px-3 text-[11px] text-gold/80"
            >
              <FolderPlus className="size-3" /> Add
            </button>
          </div>
        </section>

        {book.description ? (
          <p className="mt-4 max-h-40 overflow-y-auto text-sm leading-relaxed text-muted-foreground">
            {book.description}
          </p>
        ) : null}

        {book.notes ? (
          <p className="mt-4 rounded-lg border border-gold/20 bg-secondary/60 p-3 text-sm italic text-muted-foreground">
            {book.notes}
          </p>
        ) : null}

        <div className="mt-6">
          {confirming ? (
            <div className="rounded-xl border border-destructive/40 p-3">
              <p className="text-sm">Delete this book and all of its notes?</p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={() => setConfirming(false)}
                >
                  Keep
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={async () => {
                    await remove.mutateAsync(book.id);
                    toast.success("Book removed");
                    onClose();
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-destructive/80"
            >
              <Trash2 className="size-3.5" /> Delete book
            </button>
          )}
        </div>
      </div>

      <MetadataDialog book={book} open={editing} onOpenChange={setEditing} />
    </div>
  );
}
