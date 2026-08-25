import { useEffect, useState } from "react";
import { ChevronDown, Flame, ShieldCheck, Target } from "lucide-react";
import { RECOVERY_MIN_MINUTES, bookGoalStatus } from "@/lib/goals";
import type { BookMeta } from "@/lib/db";

type Props = {
  book: BookMeta;
  /** Live progress percent reported by the reader. */
  progress: number;
  /** Minutes read today across the library, excluding this session. */
  baseMinutesToday: number;
  /** When the current session started. */
  sessionStart: number;
  dailyGoal: number;
  /** Streak length before today's reading is counted. */
  streakBefore: number;
  /** True when today had no reading before this session began. */
  savesStreakToday: boolean;
};

/** Live reading-goal indicator: ticks every 15s so stats feel instant. */
export function ReaderGoalHud({
  book,
  progress,
  baseMinutesToday,
  sessionStart,
  dailyGoal,
  streakBefore,
  savesStreakToday,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  const sessionMinutes = Math.max(0, Math.floor((now - sessionStart) / 60000));
  const minutesToday = baseMinutesToday + sessionMinutes;
  const goalPct = Math.min(100, (minutesToday / Math.max(1, dailyGoal)) * 100);
  const hit = minutesToday >= dailyGoal;
  const breakDayDone = minutesToday >= RECOVERY_MIN_MINUTES;

  const goal = bookGoalStatus({ ...book, progress }, now);
  const bookPct = goal.hasGoal && goal.requiredPerDay !== null
    ? Math.min(100, (goal.pacePerDay / Math.max(0.01, goal.requiredPerDay)) * 100)
    : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Reading goal progress"
        aria-expanded={open}
        className="flex min-h-11 items-center rounded-full border border-gold/25 bg-secondary/50 px-3 text-left"
      >

        <div className="flex items-center gap-2">
          {hit ? (
            <Flame className="size-3.5 shrink-0 text-gold" />
          ) : (
            <Target className="size-3.5 shrink-0 text-gold/70" />
          )}
          <div className="min-w-[3.9rem]">
            <p className="text-[10px] uppercase leading-none tracking-widest text-muted-foreground">
              <span className={hit ? "text-gold" : "text-ivory"}>{minutesToday}</span>/{dailyGoal}m
            </p>
            <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={hit ? "h-full bg-gradient-gold" : "h-full bg-gold/45"}
                style={{ width: `${goalPct}%` }}
              />
            </div>
          </div>
          <ChevronDown
            className={open ? "size-3 rotate-180 text-muted-foreground" : "size-3 text-muted-foreground"}
          />
        </div>
      </button>

      {open ? (
        <div className="absolute bottom-12 left-1/2 z-50 w-[min(20rem,80vw)] -translate-x-1/2 space-y-1.5 rounded-2xl border border-gold/25 bg-popover/95 p-3 text-[11px] text-muted-foreground shadow-lux backdrop-blur-md">
          <p>
            Book progress: <span className="text-gold">{Math.round(progress)}%</span>
          </p>
            <p>
              This session: <span className="text-gold">{sessionMinutes} min</span>
              {goal.hasGoal || book.pageCount > 0
                ? ` · ~${Math.round((book.pageCount * progress) / 100)} of ${book.pageCount} pages`
                : ""}
            </p>
            {goal.hasGoal ? (
              <>
                <p>
                  {goal.remaining.toFixed(0)}% left
                  {goal.daysLeft !== null
                    ? goal.daysLeft < 0
                      ? ` · ${Math.abs(goal.daysLeft)} days past due`
                      : ` · ${goal.daysLeft} day${goal.daysLeft === 1 ? "" : "s"} left`
                    : ""}
                  {goal.requiredPerDay !== null ? ` · need ~${goal.requiredPerDay.toFixed(1)}%/day` : ""}
                </p>
                {bookPct !== null ? (
                  <div className="h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={goal.onTrack ? "h-full bg-gradient-gold" : "h-full bg-gold/40"}
                      style={{ width: `${bookPct}%` }}
                    />
                  </div>
                ) : null}
                <p className={goal.onTrack ? "text-gold" : "text-muted-foreground"}>
                  {goal.onTrack ? "On track for your finish date." : "Behind your goal pace."}
                </p>
              </>
            ) : (
              <p>No goal set for this book — add one from its details sheet.</p>
            )}
            {savesStreakToday ? (
              <p className={breakDayDone ? "flex items-center gap-1.5 text-gold" : "flex items-center gap-1.5"}>
                <ShieldCheck className="size-3.5" />
                {breakDayDone
                  ? `Break-day session complete (${RECOVERY_MIN_MINUTES}+ min) — streak recovery unlocked.`
                  : `${RECOVERY_MIN_MINUTES - minutesToday} more min unlocks streak recovery.`}
              </p>
            ) : null}
          {streakBefore > 0 && !hit ? (
            <p>
              {streakBefore}-day streak · keep it alive by hitting {dailyGoal} min.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
