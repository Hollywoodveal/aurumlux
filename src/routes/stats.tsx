import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Award,
  BookOpen,
  ChevronLeft,
  Flame,
  Lock,
  ShieldCheck,
  Target,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useHydrated } from "@/hooks/useHydrated";
import { useAnnotations, useBooks } from "@/hooks/useLibrary";
import { useDailyGoal, useStreakRecoveries } from "@/hooks/useSettings";
import {
  RECOVERY_MIN_MINUTES,
  RECOVERY_WINDOW_DAYS,
  bookGoalStatus,
  computeStreak,
  evaluateMilestones,
  recoveryState,
  splitMilestones,
} from "@/lib/goals";
import type { BookMeta, ReadingSession } from "@/lib/db";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: "Reading statistics — Aurum" },
      {
        name: "description",
        content:
          "A calm view of your reading: books finished, pages read, a calendar heat map, genre breakdown and a tap-to-filter author cloud — all computed on your device.",
      },
      { property: "og:title", content: "Reading statistics — Aurum" },
      {
        property: "og:description",
        content:
          "Calendar heat map, genre breakdown and a tappable author cloud from your private Aurum library.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StatsPage,
});

const DAY = 86400000;
const WEEKS = 26;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEVEL_BG = [
  "oklch(0.26 0.008 60 / 85%)",
  "oklch(0.52 0.06 87 / 65%)",
  "oklch(0.66 0.095 87 / 80%)",
  "oklch(0.78 0.12 87 / 90%)",
  "oklch(0.88 0.14 87)",
];

function startOfDay(ms: number) {
  return new Date(ms).setHours(0, 0, 0, 0);
}

function StatsPage() {
  const hydrated = useHydrated();
  const { data: books } = useBooks();

  const { data: annotations } = useAnnotations();
  const { minutes: dailyGoal, set: setDailyGoal } = useDailyGoal();
  const recoveries = useStreakRecoveries();
  const [openDay, setOpenDay] = useState<number | null>(null);

  const stats = useMemo(() => {
    const finished = books.filter((b) => b.status === "finished");
    const reading = books.filter((b) => b.status === "reading");
    const pages = books.reduce((sum, b) => sum + (b.pageCount * b.progress) / 100, 0);

    const dayCounts = new Map<number, number>();
    const dayBooks = new Map<number, { book: BookMeta; minutes: number }[]>();
    const daySessions = new Map<number, { book: BookMeta; session: ReadingSession }[]>();
    books.forEach((b) => {
      (b.sessions ?? []).forEach((session) => {
        const key = startOfDay(session.start);
        const list = daySessions.get(key) ?? [];
        list.push({ book: b, session });
        daySessions.set(key, list);
      });
    });
    daySessions.forEach((list) => list.sort((a, x) => a.session.start - x.session.start));
    books.forEach((b) => {
      const days = [...new Set(b.readDays.map(startOfDay))];
      const perDay = days.length > 0 ? b.readingTime / days.length / 60000 : 0;
      days.forEach((key) => {
        dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
        const list = dayBooks.get(key) ?? [];
        list.push({ book: b, minutes: Math.round(perDay) });
        dayBooks.set(key, list);
      });
    });


    const genres = new Map<string, number>();
    books.forEach((b) =>
      b.genre
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean)
        .forEach((g) => genres.set(g, (genres.get(g) ?? 0) + 1)),
    );

    const authors = new Map<string, number>();
    books.forEach((b) => {
      const a = b.author.split(",")[0]?.trim();
      if (a) authors.set(a, (authors.get(a) ?? 0) + 1);
    });

    const today = startOfDay(Date.now());
    let streak = 0;
    while (dayCounts.has(today - streak * DAY)) streak += 1;
    let best = 0;
    let run = 0;
    const sortedDays = [...dayCounts.keys()].sort((a, b) => a - b);
    sortedDays.forEach((d, i) => {
      run = i > 0 && d - (sortedDays[i - 1] ?? 0) === DAY ? run + 1 : 1;
      if (run > best) best = run;
    });

    const genreList = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const genreTotal = genreList.reduce((s, [, n]) => s + n, 0) || 1;

    return {
      finished,
      reading,
      pages: Math.round(pages),
      dayCounts,
      dayBooks,
      daySessions,
      genres: genreList,
      genreTotal,
      authors: [...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24),
      minutes: Math.round(books.reduce((s, b) => s + b.readingTime, 0) / 60000),
      streak,
      best,
      activeDays: dayCounts.size,
      dayKeys: new Set(dayCounts.keys()),
    };
  }, [books]);

  const streak = useMemo(
    () => computeStreak(books, stats.dayKeys, dailyGoal, Date.now(), recoveries.list),
    [books, stats.dayKeys, dailyGoal, recoveries.list],
  );

  const recovery = useMemo(
    () => recoveryState(books, stats.dayKeys, recoveries.list),
    [books, stats.dayKeys, recoveries.list],
  );

  const savedDays = useMemo(
    () => new Set(recoveries.list.map((r) => startOfDay(r.day))),
    [recoveries.list],
  );

  const milestones = useMemo(
    () =>
      splitMilestones(
        evaluateMilestones({
          finished: stats.finished.length,
          streak: Math.max(streak.current, streak.best),
          pages: stats.pages,
          minutes: stats.minutes,
          activeDays: streak.activeDays,
          annotations: annotations.length,
        }),
      ),
    [stats.finished.length, stats.pages, stats.minutes, streak, annotations.length],
  );

  const goals = useMemo(
    () =>
      books
        .map((book) => ({ book, goal: bookGoalStatus(book) }))
        .filter((entry) => entry.goal.hasGoal && !entry.goal.done)
        .sort((a, b) => (a.goal.daysLeft ?? 9999) - (b.goal.daysLeft ?? 9999)),
    [books],
  );

  const today = startOfDay(Date.now());
  const gridEnd = today + (6 - new Date(today).getDay()) * DAY;
  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => gridEnd - (WEEKS * 7 - 1 - i) * DAY);
  const maxDay = Math.max(1, ...stats.dayCounts.values());
  const maxAuthor = stats.authors[0]?.[1] ?? 1;

  const monthLabels = Array.from({ length: WEEKS }, (_, w) => {
    const first = cells[w * 7] ?? today;
    const prev = w === 0 ? null : cells[(w - 1) * 7];
    const m = new Date(first).getMonth();
    if (prev !== null && prev !== undefined && new Date(prev).getMonth() === m) return "";
    return MONTHS[m] ?? "";
  });

  // Everything below is derived from "today" and on-device data, so it can only
  // be rendered after hydration without an SSR text mismatch.
  if (!hydrated) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-3xl px-safe pt-safe">
        <header className="flex items-center gap-2">
          <Link to="/" aria-label="Back to library" className="rounded-full border border-gold/25 p-2 text-gold">
            <ChevronLeft className="size-4" />
          </Link>
          <h1 className="font-display text-3xl text-gradient-gold">Statistics</h1>
        </header>
      </main>
    );
  }

  return (

    <main className="mx-auto min-h-dvh w-full max-w-3xl pb-16 px-safe pt-safe">
      <header className="flex items-center gap-2">
        <Link to="/" aria-label="Back to library" className="rounded-full border border-gold/25 p-2 text-gold">
          <ChevronLeft className="size-4" />
        </Link>
        <h1 className="font-display text-3xl text-gradient-gold">Statistics</h1>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-3">
        {[
          ["Books", books.length],
          ["Finished", stats.finished.length],
          ["Reading now", stats.reading.length],
          ["Pages read", stats.pages],
          ["Minutes read", stats.minutes],
          ["Highlights & notes", annotations.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-gold/20 bg-card p-4">
            <p className="font-display text-3xl text-gold">{value}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {label}
            </p>
          </div>
        ))}
      </section>


      <section className="mt-8 rounded-2xl border border-gold/25 bg-card p-4 shadow-lux">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-gold/70">Streak</h2>
            <p className="mt-2 flex items-baseline gap-2">
              <Flame
                className={streak.current > 0 ? "size-6 text-gold" : "size-6 text-muted-foreground"}
              />
              <span className="font-display text-4xl text-gradient-gold">{streak.current}</span>
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                day{streak.current === 1 ? "" : "s"}
              </span>
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Best {streak.best} · {streak.goalDays} goal day{streak.goalDays === 1 ? "" : "s"} in a row
            </p>
          </div>

          <div className="w-32 shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Today</p>
            <p className="mt-1 font-display text-2xl text-gold">
              {streak.todayMinutes}
              <span className="text-sm text-muted-foreground">/{dailyGoal}m</span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className={streak.todayHit ? "h-full bg-gradient-gold" : "h-full bg-gold/50"}
                style={{ width: `${Math.min(100, (streak.todayMinutes / Math.max(1, dailyGoal)) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        <p
          className={
            streak.todayHit
              ? "mt-3 text-xs text-gold"
              : streak.atRisk
                ? "mt-3 text-xs text-destructive"
                : "mt-3 text-xs text-muted-foreground"
          }
        >
          {streak.todayHit
            ? "Today's goal is met — your streak is safe."
            : streak.atRisk
              ? `Your ${streak.current === 0 ? "" : `${streak.current}-day `}streak breaks tonight unless you read today.`
              : `Read ${Math.max(1, dailyGoal - streak.todayMinutes)} more minute${
                  dailyGoal - streak.todayMinutes === 1 ? "" : "s"
                } to hit today's goal.`}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Daily goal
          </span>
          {[10, 20, 30, 45, 60].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setDailyGoal.mutate(m)}
              className={
                m === dailyGoal
                  ? "flex min-h-11 min-w-11 items-center justify-center rounded-full border border-gold/60 bg-gold/12 px-3 py-1 text-[11px] text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  : "flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              }
            >
              {m}m
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-gold/20 bg-background/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-gold/70">
              <ShieldCheck className="size-3.5" /> Streak recovery
            </h3>
            {streak.recoveredInStreak > 0 ? (
              <span className="shrink-0 rounded-full border border-gold/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gold">
                {streak.recoveredInStreak} saved day{streak.recoveredInStreak === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          {recovery.missedDay === null ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Nothing to recover — no broken day in the last {RECOVERY_WINDOW_DAYS} days.
              Miss a day and you can save the streak with a {RECOVERY_MIN_MINUTES}-minute break-day
              session.
            </p>
          ) : (
            <>
              <p className="mt-2 text-xs text-muted-foreground">
                You missed{" "}
                <span className="text-ivory">
                  {new Date(recovery.missedDay).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                , ending a {recovery.streakAtStake}-day streak.
              </p>

              <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                <span className="text-muted-foreground">Break-day session today</span>
                <span className={recovery.minutesToday >= recovery.minutesNeeded ? "text-gold" : "text-muted-foreground"}>
                  {recovery.minutesToday}/{recovery.minutesNeeded} min
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-gradient-gold"
                  style={{
                    width: `${Math.min(100, (recovery.minutesToday / Math.max(1, recovery.minutesNeeded)) * 100)}%`,
                  }}
                />
              </div>

              <button
                type="button"
                disabled={!recovery.eligible || recoveries.redeem.isPending}
                onClick={() => {
                  if (recovery.missedDay === null) return;
                  recoveries.redeem.mutate(
                    { day: recovery.missedDay, minutes: recovery.minutesToday },
                    {
                      onSuccess: () =>
                        toast.success(
                          `Streak saved — ${recovery.streakAtStake + 1} days and counting.`,
                        ),
                    },
                  );
                }}
                className={
                  recovery.eligible
                    ? "mt-3 min-h-11 w-full rounded-lg bg-gradient-gold px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    : "mt-3 min-h-11 w-full rounded-lg border border-border px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                }
              >
                {recovery.reason === "cooldown"
                  ? `Recovery recharges in ${recovery.cooldownDaysLeft} day${recovery.cooldownDaysLeft === 1 ? "" : "s"}`
                  : recovery.reason === "too-old"
                    ? "Too long ago to recover"
                    : recovery.reason === "needs-session"
                      ? `Read ${recovery.minutesNeeded - recovery.minutesToday} more min to unlock`
                      : "Save my streak"}
              </button>
            </>
          )}

          {recovery.used.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-t border-gold/10 pt-2.5">
              {recovery.used.slice(0, 4).map((r) => (
                <li key={r.day} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-muted-foreground">
                    <span className="text-gold">Saved</span>{" "}
                    {new Date(r.day).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {r.minutes} min break-day session
                  </span>
                  <button
                    type="button"
                    aria-label={`Undo streak recovery for ${new Date(r.day).toLocaleDateString()}`}
                    onClick={() => recoveries.undo.mutate(r.day)}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    <Undo2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-gold/70">
          <Target className="size-3.5" /> Book goals
        </h2>
        {goals.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No book goals yet — open a book's details and set a finish date or daily target.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {goals.map(({ book, goal }) => (
              <li key={book.id} className="rounded-xl border border-gold/15 bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-1 font-display text-base text-ivory">{book.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{book.author}</p>
                  </div>
                  <span
                    className={
                      goal.overdue
                        ? "shrink-0 rounded-full border border-destructive/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-destructive"
                        : goal.onTrack
                          ? "shrink-0 rounded-full border border-gold/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gold"
                          : "shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                    }
                  >
                    {goal.overdue ? "Past due" : goal.onTrack ? "On track" : "Behind"}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-gradient-gold" style={{ width: `${book.progress}%` }} />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  <span className="text-gold">{Math.round(book.progress)}%</span> read
                  {goal.daysLeft !== null
                    ? goal.daysLeft < 0
                      ? ` · ${Math.abs(goal.daysLeft)} days past due`
                      : ` · ${goal.daysLeft} day${goal.daysLeft === 1 ? "" : "s"} left`
                    : ""}
                  {goal.requiredPerDay !== null
                    ? ` · need ~${goal.requiredPerDay.toFixed(1)}%/day`
                    : ""}
                  {goal.dailyMinutes > 0
                    ? ` · ${goal.minutesToday}/${goal.dailyMinutes} min today`
                    : ""}
                </p>
                <Link
                  to="/read/$bookId"
                  params={{ bookId: book.id }}
                  className="mt-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-gold"
                >
                  <BookOpen className="size-3.5" /> Continue
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-gold/70">
          <Award className="size-3.5" /> Milestones
        </h2>

        {milestones.next.length > 0 ? (
          <ul className="mt-3 space-y-2 rounded-xl border border-gold/15 bg-card p-4">
            {milestones.next.slice(0, 4).map((m) => (
              <li key={m.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-ivory">{m.label}</span>
                  <span className="text-[11px] text-gold">
                    {Math.floor(m.value).toLocaleString()} / {m.target.toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-gradient-gold" style={{ width: `${m.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {milestones.earned.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No badges yet — finish a book or start a streak to earn your first.
            </p>
          ) : (
            milestones.earned.map((m) => (
              <span
                key={m.id}
                title={m.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-gold/45 bg-gold/10 px-3 py-1 text-[11px] text-gold"
              >
                <Award className="size-3.5" /> {m.label}
              </span>
            ))
          )}
        </div>

        {milestones.next.length > 4 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {milestones.next.slice(4).map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground"
              >
                <Lock className="size-3 opacity-70" /> {m.label}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xs uppercase tracking-[0.2em] text-gold/70">Calendar heat map</h2>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Flame className="size-3.5 text-gold" />
            <span className="text-gold">{stats.streak}</span> day streak · best {stats.best} ·{" "}
            {stats.activeDays} active days
          </p>
        </div>
        <div className="no-scrollbar mt-3 overflow-x-auto rounded-xl border border-gold/15 bg-card p-3">
          <div className="min-w-max">
            <div className="mb-1 flex gap-[3px] pl-[22px]">
              {monthLabels.map((m, i) => (
                <span
                  key={`${m}-${i}`}
                  className="w-[11px] text-[9px] uppercase tracking-wider text-muted-foreground"
                >
                  {m}
                </span>
              ))}
            </div>
            <div className="flex gap-[6px]">
              <div className="grid grid-rows-7 gap-[3px] text-[9px] leading-[11px] text-muted-foreground">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <span key={`${d}-${i}`} className="h-[11px]">
                    {i % 2 === 1 ? d : ""}
                  </span>
                ))}
              </div>
              <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
                {cells.map((d) => {
                  const count = stats.dayCounts.get(d) ?? 0;
                  const level = count === 0 ? 0 : Math.max(1, Math.round((count / maxDay) * 4));
                  const future = d > today;
                  const saved = savedDays.has(d);
                  const dayMinutes = (stats.dayBooks.get(d) ?? []).reduce((s, e) => s + e.minutes, 0);
                  const dateLabel = new Date(d).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                  const label =
                    count === 0
                      ? `${dateLabel} — ${saved ? "streak saved, no reading" : "no reading"}`
                      : `${dateLabel} — ${dayMinutes} minute${dayMinutes === 1 ? "" : "s"} read, ${count} book${count === 1 ? "" : "s"}`;
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={future || (count === 0 && !saved)}
                      onClick={() => setOpenDay(d)}
                      aria-label={label}
                      title={label}
                      className="size-[11px] rounded-[2px] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-1 focus-visible:ring-offset-card disabled:cursor-default enabled:hover:scale-125"
                      style={{
                        background: future
                          ? "transparent"
                          : saved && count === 0
                            ? "oklch(0.34 0.03 87 / 90%)"
                            : LEVEL_BG[level],
                        boxShadow:
                          openDay === d
                            ? "0 0 0 1.5px oklch(0.88 0.14 87)"
                            : saved
                              ? "inset 0 0 0 1px oklch(0.82 0.13 87 / 75%)"
                              : level >= 3
                                ? "0 0 6px oklch(0.82 0.13 87 / 35%)"
                                : undefined,
                      }}
                    />
                  );
                })}

              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
              <span>Less</span>
              {LEVEL_BG.map((bg) => (
                <span key={bg} className="size-[9px] rounded-[2px]" style={{ background: bg }} />
              ))}
              <span>More</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Tap a day to see what you read · gold outline marks a saved streak day
        </p>
      </section>


      <section className="mt-8">
        <h2 className="text-xs uppercase tracking-[0.2em] text-gold/70">Genre breakdown</h2>
        {stats.genres.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No genres yet.</p>
        ) : (
          <div className="mt-3 rounded-xl border border-gold/15 bg-card p-4">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary">
              {stats.genres.map(([g, n], i) => (
                <span
                  key={g}
                  title={`${g} · ${n}`}
                  style={{
                    width: `${(n / stats.genreTotal) * 100}%`,
                    background: `oklch(${0.88 - i * 0.045} ${0.14 - i * 0.008} 87)`,
                  }}
                />
              ))}
            </div>
            <ul className="mt-4 space-y-2">
              {stats.genres.map(([g, n], i) => (
                <li key={g}>
                  <Link
                    to="/"
                    search={{ q: g }}
                    className="flex items-center gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-gold/8"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: `oklch(${0.88 - i * 0.045} ${0.14 - i * 0.008} 87)` }}
                    />
                    <span className="w-28 shrink-0 truncate text-xs text-ivory">{g}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                      <span
                        className="block h-full bg-gradient-gold"
                        style={{ width: `${(n / (stats.genres[0]?.[1] ?? 1)) * 100}%` }}
                      />
                    </span>
                    <span className="w-14 text-right text-[11px] text-gold">
                      {n} · {Math.round((n / stats.genreTotal) * 100)}%
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Tap a genre to filter your library
            </p>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xs uppercase tracking-[0.2em] text-gold/70">Author cloud</h2>
        {stats.authors.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No authors yet.</p>
        ) : (
          <div className="mt-3 rounded-xl border border-gold/15 bg-card p-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              {stats.authors.map(([a, n]) => (
                <Link
                  key={a}
                  to="/"
                  search={{ q: a }}
                  title={`${a} · ${n} book${n === 1 ? "" : "s"}`}
                  className="font-display leading-none transition-opacity hover:opacity-70"
                  style={{
                    fontSize: `${0.95 + (n / maxAuthor) * 1.5}rem`,
                    color: `oklch(${0.7 + (n / maxAuthor) * 0.15} ${0.05 + (n / maxAuthor) * 0.09} 87)`,
                  }}
                >
                  {a}
                </Link>
              ))}
            </div>
            <p className="mt-4 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Tap an author to filter your library
            </p>
          </div>
        )}
      </section>

      {openDay !== null ? (
        <DayPanel
          day={openDay}
          entries={stats.dayBooks.get(openDay) ?? []}
          sessions={stats.daySessions.get(openDay) ?? []}
          onClose={() => setOpenDay(null)}
        />
      ) : null}
    </main>
  );
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function DayPanel({
  day,
  entries,
  sessions,
  onClose,
}: {
  day: number;
  entries: { book: BookMeta; minutes: number }[];
  sessions: { book: BookMeta; session: ReadingSession }[];
  onClose: () => void;
}) {
  const sessionMinutes = sessions.reduce(
    (s, e) => s + Math.max(1, Math.round((e.session.end - e.session.start) / 60000)),
    0,
  );
  const totalMinutes = sessions.length > 0 ? sessionMinutes : entries.reduce((s, e) => s + e.minutes, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close day details"
        onClick={onClose}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
      />
      <div className="relative z-10 max-h-[80svh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-gold/25 bg-card px-safe pb-safe pt-5 shadow-lux">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gold/70">Reading day</p>
            <h3 className="mt-1 font-display text-2xl text-ivory">
              {new Date(day).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {entries.length} book{entries.length === 1 ? "" : "s"} ·{" "}
              <span className="text-gold">~{totalMinutes} min</span> reading time
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-gold/25 p-2 text-gold/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <X className="size-4" />
          </button>
        </div>

        {sessions.length > 0 ? (
          <section className="mt-5">
            <h4 className="text-[10px] uppercase tracking-[0.2em] text-gold/70">
              Sessions timeline
            </h4>
            <ol className="mt-3 space-y-3 border-l border-gold/20 pl-4">
              {sessions.map(({ book, session }, i) => {
                const minutes = Math.max(1, Math.round((session.end - session.start) / 60000));
                const gained = Math.max(0, session.progressEnd - session.progressStart);
                return (
                  <li key={session.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-gradient-gold shadow-[0_0_6px_oklch(0.82_0.13_87/45%)]" />
                    <p className="text-[11px] tracking-wide text-gold">
                      {i + 1}. {fmtTime(session.start)} – {fmtTime(session.end)}
                      <span className="text-muted-foreground"> · {minutes} min</span>
                    </p>
                    <p className="mt-0.5 line-clamp-1 font-display text-sm text-ivory">
                      {book.title}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {session.chapter ? `${session.chapter} · ` : ""}
                      {Math.round(session.progressStart)}% → {Math.round(session.progressEnd)}%
                      {gained >= 0.5 ? ` (+${Math.round(gained)}%)` : ""}
                    </p>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : (
          <p className="mt-5 text-[11px] text-muted-foreground">
            No session timings recorded for this day — sessions are tracked from now on.
          </p>
        )}

        <ul className="mt-5 space-y-3">
          {entries.map(({ book, minutes }) => (
            <li
              key={book.id}
              className="flex items-center gap-3 rounded-xl border border-gold/15 bg-secondary/40 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-display text-base leading-tight text-ivory">
                  {book.title}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{book.author}</p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-gradient-gold" style={{ width: `${book.progress}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-gold/70">
                  {Math.round(book.progress)}% · ~{minutes} min this day
                </p>
              </div>
              <Link
                to="/read/$bookId"
                params={{ bookId: book.id }}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3.5 py-2 text-xs text-gold"
              >
                <BookOpen className="size-3.5" />
                Read
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
