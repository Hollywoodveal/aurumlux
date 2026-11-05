import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSetting, setSetting } from "@/lib/db";

const KEY = "onboardingSeen";
const isClient = typeof window !== "undefined";

export function useOnboarding() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["setting", KEY],
    queryFn: () => getSetting<boolean>(KEY, false),
    enabled: isClient,
    initialData: true, // assume seen until the real value loads, so it never flashes
  });

  const set = useMutation({
    mutationFn: (seen: boolean) => setSetting(KEY, seen),
    onSuccess: (_data, seen) => {
      // Mirror for components outside the query tree (the install banner
      // holds off until the tour is done) and notify any live listeners.
      try {
        if (seen) {
          localStorage.setItem("aurum:onboarding-seen", "1");
          window.dispatchEvent(new Event("aurum:onboarding-complete"));
        } else {
          localStorage.removeItem("aurum:onboarding-seen");
        }
      } catch {
        /* storage unavailable */
      }
      qc.invalidateQueries({ queryKey: ["setting", KEY] });
    },
  });

  return {
    seen: query.data ?? true,
    loaded: query.isFetched,
    complete: () => set.mutate(true),
    replay: () => set.mutate(false),
  };
}
