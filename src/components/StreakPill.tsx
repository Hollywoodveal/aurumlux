import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Flame } from "lucide-react";
import { computeStreak, startOfDay, type StreakRecovery } from "@/lib/goals";
import type { BookMeta } from "@/lib/db";
import { cn } from "@/lib/utils";

type Props = {
  books: BookMeta[];
  dailyGoal: number;
  recoveries: StreakRecovery[];
};

/** Compact streak + daily-goal pill on the library home; taps through to stats. */
export function StreakPill({ books, dailyGoal, recoveries }: Props) {
  const streak = useMemo(() => {
    const dayKeys = new Set<number>();
    for (const b of books)
      for (const d of b.readDays) dayKeys.add(startOfDay(d));
    return computeStreak(books, dayKeys, dailyGoal, Date.now(), recoveries);
  }, [books, dailyGoal, recoveries]);

  if (books.length === 0) return null;

  const label = streak.atRisk
    ? "Streak at risk — read today"
    : streak.current > 0
      ? `${streak.current}-day streak`
      : "Start your streak";

  return (
    <Link
      to="/stats"
      aria-label={`Reading streak: ${label}. ${streak.todayMinutes} of ${dailyGoal} minutes today. View statistics.`}
      className={cn(
        "mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-xs",
        streak.atRisk
          ? "border-gold/60 bg-gold/10 text-gold"
          : "border-gold/25 bg-secondary/50 text-ivory/90",
      )}
    >
      <Flame
        className={cn(
          "size-4 shrink-0",
          streak.current > 0 || streak.atRisk ? "text-gold" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className={streak.todayHit ? "text-gold" : "text-muted-foreground"}>
        {streak.todayMinutes}/{dailyGoal} min today
      </span>
    </Link>
  );
}
