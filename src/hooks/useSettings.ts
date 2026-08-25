import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSetting, setSetting } from "@/lib/db";
import { DEFAULT_DAILY_GOAL, startOfDay, type StreakRecovery } from "@/lib/goals";

const isClient = typeof window !== "undefined";

export function useDailyGoal() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["setting", "dailyGoalMinutes"],
    queryFn: () => getSetting<number>("dailyGoalMinutes", DEFAULT_DAILY_GOAL),
    enabled: isClient,
    initialData: DEFAULT_DAILY_GOAL,
  });
  const set = useMutation({
    mutationFn: (minutes: number) => setSetting("dailyGoalMinutes", minutes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["setting", "dailyGoalMinutes"] }),
  });
  return { minutes: query.data ?? DEFAULT_DAILY_GOAL, set };
}

const RECOVERY_KEY = "streakRecoveries";

export function useStreakRecoveries() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["setting", RECOVERY_KEY],
    queryFn: () => getSetting<StreakRecovery[]>(RECOVERY_KEY, []),
    enabled: isClient,
    initialData: [] as StreakRecovery[],
  });
  const list = query.data ?? [];

  const redeem = useMutation({
    mutationFn: async ({ day, minutes }: { day: number; minutes: number }) => {
      const current = await getSetting<StreakRecovery[]>(RECOVERY_KEY, []);
      const key = startOfDay(day);
      if (current.some((r) => startOfDay(r.day) === key)) return current;
      const next = [...current, { day: key, usedAt: Date.now(), minutes }];
      await setSetting(RECOVERY_KEY, next);
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["setting", RECOVERY_KEY] }),
  });

  const undo = useMutation({
    mutationFn: async (day: number) => {
      const current = await getSetting<StreakRecovery[]>(RECOVERY_KEY, []);
      const next = current.filter((r) => startOfDay(r.day) !== startOfDay(day));
      await setSetting(RECOVERY_KEY, next);
      return next;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["setting", RECOVERY_KEY] }),
  });

  return { list, redeem, undo };
}
