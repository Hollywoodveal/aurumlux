import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, FolderPlus, Heart, Layers, Pencil, Target, Trash2, Type, X } from "lucide-react";
import { toast } from "sonner";
import { CoverImage } from "@/components/CoverImage";
import { MetadataDialog } from "@/components/MetadataDialog";
import { StarRating } from "@/components/StarRating";
import { Button } from "@/components/ui/button";
import { useBookMutations } from "@/hooks/useLibrary";
import type { BookMeta, ReadingStatus } from "@/lib/db";
import { bookGoalStatus, fromDateInput, toDateInput } from "@/lib/goals";
import { DYSLEXIC_FONT, READER_FONTS } from "@/lib/reader-prefs";
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
  const goal = bookGoalStatus(book);

  const setRating = (rating: number) => {
    save.mutate({ id: book.id, patch: { rating } });
    toast.success(rating ? `Rated ${rating} of 5` : "Rating cleared");
  };

  const setStatus = (status: ReadingStatus) =>
    save.mutate({
      id: book.id,
      patch: {
        status,
        ...(status === "finished"
          ? { finishedAt: book.finishedAt ?? Date.now(), progress: 100 }
          : {}),
      },
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 z-0 bg-scrim backdrop-blur-sm"
      />
      <div className="animate-rise relative z-10 max-h-[88svh] w-full overflow-y-auto rounded-t-3xl border-t border-gold/25 bg-card px-safe pb-safe pt-4 shadow-lux sm:max-w-md sm:rounded-3xl sm:pb-6">
        <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-gold/30" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground"
        >
          <X className="size-5" />
        </button>

        <div className="flex gap-4">
          <div className="h-[168px] w-[112px] shrink-0 overflow-hidden rounded-md hairline-gold shadow-lux">
            <CoverImage book={book} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl leading-tight text-ivory">{book.title}</h2>
            {book.subtitle ? (
              <p className="mt-1 text-sm italic text-muted-foreground">{book.subtitle}</p>
            ) : null}
            <p className="mt-1 text-sm text-gold/90">{book.author || "Unknown author"}</p>
            {book.series ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{book.series}</p>
            ) : null}
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {book.format.toUpperCase()} · {book.pageCount || "?"} pages · {fmtSize(book.fileSize)}
            </p>
            <StarRating value={book.rating} onChange={setRating} className="mt-1 -ml-0.5" />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            className="flex-1 bg-gradient-gold text-primary-foreground"
            onClick={() => {
              void navigate({ to: "/read/$bookId", params: { bookId: book.id } });
            }}
          >
            <BookOpen className="size-4" />
            {book.progress > 0 ? `Continue · ${Math.round(book.progress)}%` : "Read"}
          </Button>
          <Button
            variant="outline"
            aria-label="Toggle favorite"
            className={cn("border-gold/30", book.favorite && "bg-gold/15 text-gold")}
            onClick={() => save.mutate({ id: book.id, patch: { favorite: !book.favorite } })}
          >
            <Heart className={cn("size-4", book.favorite && "fill-current")} />
          </Button>
          <Button
            variant="outline"
            aria-label="Edit metadata"
            className="border-gold/30"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" />
          </Button>
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
              <div className="h-full bg-gradient-gold" style={{ width: `${book.progress}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {Math.round(book.progress)}% complete
              {book.chapter ? ` · ${book.chapter}` : ""}
              {book.readingTime ? ` · ${Math.round(book.readingTime / 60000)} min read` : ""}
            </p>
          </div>
        ) : null}


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
                {goal.overdue ? "Past due" : goal.onTrack ? "On track" : "Behind"}
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
                    patch: { goalDailyMinutes: Math.max(0, Number(e.target.value) || 0) },
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
                      } · need ~${(goal.requiredPerDay ?? 0).toFixed(1)}%/day, reading ~${goal.pacePerDay.toFixed(1)}%/day`
                    : `${goal.remaining.toFixed(0)}% left · reading ~${goal.pacePerDay.toFixed(1)}%/day${
                        goal.projectedDays ? ` · about ${goal.projectedDays} days to finish` : ""
                      }`}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Set a finish date or a daily target and Aurum will track your pace on the stats page.
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
              save.mutate({ id: book.id, patch: { fontOverride: e.target.value || null } })
            }
            className="mt-2 w-full rounded-lg border border-gold/20 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-gold/50"
          >
            <option value="">Use my reader default</option>
            {READER_FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
            <option value={DYSLEXIC_FONT}>Readable (Atkinson Hyperlegible)</option>
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
                      collections: (book.collections ?? []).filter((c) => c !== name),
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
                  patch: { collections: [...new Set([...(book.collections ?? []), name])] },
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
                <Button variant="ghost" className="flex-1" onClick={() => setConfirming(false)}>
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
