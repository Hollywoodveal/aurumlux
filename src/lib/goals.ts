import type { BookMeta } from "@/lib/db";

export const DAY_MS = 86400000;
export const DEFAULT_DAILY_GOAL = 20;
/** Minimum minutes of reading required on a break day to redeem a streak save. */
export const RECOVERY_MIN_MINUTES = 5;
/** Days that must pass between two streak saves. */
export const RECOVERY_COOLDOWN_DAYS = 7;
/** How far back a missed day can be and still be recoverable. */
export const RECOVERY_WINDOW_DAYS = 2;

export type StreakRecovery = {
  /** Start-of-day key of the missed day that was covered. */
  day: number;
  /** When the save was redeemed. */
  usedAt: number;
  /** Minutes read on the recovery day, i.e. the break-day session. */
  minutes: number;
};

export function startOfDay(ms: number) {
  return new Date(ms).setHours(0, 0, 0, 0);
}

/** Minutes read on a given day, derived from tracked reading sessions. */
export function minutesOnDay(books: BookMeta[], day: number) {
  const key = startOfDay(day);
  let total = 0;
  books.forEach((b) =>
    (b.sessions ?? []).forEach((s) => {
      if (startOfDay(s.start) !== key) return;
      total += Math.max(1, Math.round((s.end - s.start) / 60000));
    }),
  );
  return total;
}

export type StreakInfo = {
  current: number;
  best: number;
  activeDays: number;
  /** Days in the current streak that also hit the daily minutes goal. */
  goalDays: number;
  todayMinutes: number;
  todayHit: boolean;
  /** True when today has no reading yet but yesterday did — the streak is at risk. */
  atRisk: boolean;
  /** Recovered (saved) days that count inside the current streak. */
  recoveredInStreak: number;
};

export function computeStreak(
  books: BookMeta[],
  dayKeys: Set<number>,
  dailyGoal: number,
  now = Date.now(),
  recoveries: StreakRecovery[] = [],
): StreakInfo {
  const today = startOfDay(now);
  const saved = new Set(recoveries.map((r) => startOfDay(r.day)));
  const counts = (day: number) => dayKeys.has(day) || saved.has(day);

  let current = 0;
  let recoveredInStreak = 0;
  while (counts(today - current * DAY_MS)) {
    if (!dayKeys.has(today - current * DAY_MS)) recoveredInStreak += 1;
    current += 1;
  }

  const sorted = [...new Set([...dayKeys, ...saved])].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  sorted.forEach((d, i) => {
    run = i > 0 && d - (sorted[i - 1] ?? 0) === DAY_MS ? run + 1 : 1;
    if (run > best) best = run;
  });

  let goalDays = 0;
  for (let i = 0; i < current; i += 1) {
    if (minutesOnDay(books, today - i * DAY_MS) >= dailyGoal) goalDays += 1;
  }

  const todayMinutes = minutesOnDay(books, today);
  return {
    current,
    best,
    activeDays: dayKeys.size,
    goalDays,
    todayMinutes,
    todayHit: todayMinutes >= dailyGoal,
    atRisk: !dayKeys.has(today) && counts(today - DAY_MS),
    recoveredInStreak,
  };
}

export type RecoveryState = {
  /** The missed day that can be saved, if any. */
  missedDay: number | null;
  /** Length of the streak that ended at the missed day. */
  streakAtStake: number;
  minutesToday: number;
  minutesNeeded: number;
  /** Ready to redeem right now. */
  eligible: boolean;
  /** Break-day session done, but a cooldown blocks the save. */
  cooldownDaysLeft: number;
  lastUsedAt: number | null;
  used: StreakRecovery[];
  reason:
    | "none"
    | "eligible"
    | "needs-session"
    | "cooldown"
    | "already-saved"
    | "too-old";
};

/**
 * Streak recovery: a missed day inside the recovery window can be forgiven once
 * the reader completes a short "break-day" session today.
 */
export function recoveryState(
  books: BookMeta[],
  dayKeys: Set<number>,
  recoveries: StreakRecovery[] = [],
  now = Date.now(),
  minutesNeeded = RECOVERY_MIN_MINUTES,
): RecoveryState {
  const today = startOfDay(now);
  const saved = new Set(recoveries.map((r) => startOfDay(r.day)));
  const counts = (day: number) => dayKeys.has(day) || saved.has(day);
  const minutesToday = minutesOnDay(books, today);
  const lastUsedAt = recoveries.reduce<number | null>(
    (max, r) => (max === null || r.usedAt > max ? r.usedAt : max),
    null,
  );
  const cooldownDaysLeft =
    lastUsedAt === null
      ? 0
      : Math.max(
          0,
          RECOVERY_COOLDOWN_DAYS - Math.floor((today - startOfDay(lastUsedAt)) / DAY_MS),
        );

  const base = {
    minutesToday,
    minutesNeeded,
    cooldownDaysLeft,
    lastUsedAt,
    used: [...recoveries].sort((a, b) => b.usedAt - a.usedAt),
  };

  // Today isn't "missed" until it ends, so start the search at the first past day
  // that has no reading, then measure the streak that preceded it.
  let offset = counts(today) ? 0 : 1;
  while (counts(today - offset * DAY_MS)) offset += 1;
  const missedDay = today - offset * DAY_MS;
  let streakAtStake = 0;
  while (counts(missedDay - (streakAtStake + 1) * DAY_MS)) streakAtStake += 1;

  if (streakAtStake === 0) {
    return { ...base, missedDay: null, streakAtStake, eligible: false, reason: "none" };
  }

  if (offset > RECOVERY_WINDOW_DAYS) {
    return { ...base, missedDay, streakAtStake, eligible: false, reason: "too-old" };
  }
  if (cooldownDaysLeft > 0) {
    return { ...base, missedDay, streakAtStake, eligible: false, reason: "cooldown" };
  }
  if (minutesToday < minutesNeeded) {
    return { ...base, missedDay, streakAtStake, eligible: false, reason: "needs-session" };
  }
  return { ...base, missedDay, streakAtStake, eligible: true, reason: "eligible" };
}


export type Milestone = {
  id: string;
  group: string;
  label: string;
  target: number;
  value: number;
  earned: boolean;
  pct: number;
};

type MilestoneTotals = {
  finished: number;
  streak: number;
  pages: number;
  minutes: number;
  activeDays: number;
  annotations: number;
};

const TIERS: { group: string; key: keyof MilestoneTotals; unit: string; steps: number[] }[] = [
  { group: "Finished", key: "finished", unit: "books finished", steps: [1, 5, 10, 25, 50, 100] },
  { group: "Streak", key: "streak", unit: "day streak", steps: [3, 7, 14, 30, 60, 100] },
  { group: "Pages", key: "pages", unit: "pages read", steps: [100, 500, 1000, 5000, 10000] },
  { group: "Time", key: "minutes", unit: "minutes read", steps: [60, 300, 1200, 3000, 12000] },
  { group: "Devotion", key: "activeDays", unit: "reading days", steps: [5, 25, 60, 150, 365] },
  { group: "Margins", key: "annotations", unit: "notes & highlights", steps: [10, 50, 150, 500] },
];

export function evaluateMilestones(totals: MilestoneTotals): Milestone[] {
  return TIERS.flatMap(({ group, key, unit, steps }) => {
    const value = totals[key];
    return steps.map((target) => ({
      id: `${group}-${target}`,
      group,
      label: `${target.toLocaleString()} ${target === 1 ? unit.replace(/s\b/, "") : unit}`,
      target,
      value,
      earned: value >= target,
      pct: Math.min(100, (value / target) * 100),
    }));
  });
}

/** Earned badges, plus the nearest unearned badge in each group. */
export function splitMilestones(all: Milestone[]) {
  const earned = all.filter((m) => m.earned);
  const groups = [...new Set(all.map((m) => m.group))];
  const next = groups
    .map((g) => all.filter((m) => m.group === g && !m.earned).sort((a, b) => a.target - b.target)[0])
    .filter((m): m is Milestone => Boolean(m))
    .sort((a, b) => b.pct - a.pct);
  return { earned, next };
}

export type BookGoalStatus = {
  hasGoal: boolean;
  targetDate: number | null;
  dailyMinutes: number;
  /** Percent of the book still to read. */
  remaining: number;
  daysLeft: number | null;
  /** Percent per day needed from today to finish by the target date. */
  requiredPerDay: number | null;
  /** Recent observed pace, percent per day. */
  pacePerDay: number;
  projectedDays: number | null;
  minutesToday: number;
  onTrack: boolean;
  overdue: boolean;
  done: boolean;
};

export function bookGoalStatus(book: BookMeta, now = Date.now()): BookGoalStatus {
  const targetDate = book.goalTargetDate ?? null;
  const dailyMinutes = book.goalDailyMinutes ?? 0;
  const hasGoal = targetDate !== null || dailyMinutes > 0;
  const remaining = Math.max(0, 100 - book.progress);
  const done = book.status === "finished" || book.progress >= 100;

  const today = startOfDay(now);
  const daysLeft = targetDate === null ? null : Math.round((startOfDay(targetDate) - today) / DAY_MS);
  // A target date in the past (or today) means the whole remainder is due now.
  const requiredPerDay = daysLeft === null ? null : remaining / Math.max(1, daysLeft);

  const sessions = book.sessions ?? [];
  const recent = sessions.filter((s) => s.start >= now - 14 * DAY_MS);
  const activeDays = new Set(recent.map((s) => startOfDay(s.start))).size;
  const gained = recent.reduce((sum, s) => sum + Math.max(0, s.progressEnd - s.progressStart), 0);
  const pacePerDay = activeDays > 0 ? gained / activeDays : 0;
  const projectedDays = pacePerDay > 0 ? Math.ceil(remaining / pacePerDay) : null;

  const minutesToday = sessions
    .filter((s) => startOfDay(s.start) === today)
    .reduce((sum, s) => sum + Math.max(1, Math.round((s.end - s.start) / 60000)), 0);

  // Small tolerance so rounded display values don't contradict the on-track badge.
  const paceOk = requiredPerDay === null ? true : pacePerDay >= requiredPerDay * 0.95;
  const minutesOk = dailyMinutes === 0 ? true : minutesToday >= dailyMinutes;

  return {
    hasGoal,
    targetDate,
    dailyMinutes,
    remaining,
    daysLeft,
    requiredPerDay,
    pacePerDay,
    projectedDays,
    minutesToday,
    onTrack: done || (paceOk && minutesOk),
    overdue: !done && daysLeft !== null && daysLeft < 0,
    done,
  };
}

export function toDateInput(ms: number | null | undefined) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateInput(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59).getTime();
}
