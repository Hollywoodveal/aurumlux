import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getSyncConfig } from "@/lib/sync-config";
import { cn } from "@/lib/utils";

/**
 * Header indicator for optional sync, shown only once sync is turned on.
 * Gold dot: up to date. Red dot: the last sync failed (tap to fix).
 * Tapping when healthy syncs now.
 */
export function SyncDot() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { data: config } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: getSyncConfig,
    enabled: typeof window !== "undefined",
  });
  if (!config?.enabled) return null;

  const failed = Boolean(config.lastError);
  const label = failed
    ? `Sync failed: ${config.lastError}. Tap to fix.`
    : config.lastSyncAt
      ? `Synced ${new Date(config.lastSyncAt).toLocaleString()}. Tap to sync now.`
      : "Sync is on. Tap to sync now.";

  const onTap = async () => {
    if (failed) {
      void navigate({ to: "/settings", search: { tab: "sync" } });
      return;
    }
    setBusy(true);
    try {
      const { syncNow } = await import("@/lib/sync");
      const r = await syncNow();
      const changes = r.positions + r.added + r.removed + r.annotations;
      toast.success(
        changes
          ? `Synced · ${changes} update${changes === 1 ? "" : "s"}`
          : "Up to date",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
      void qc.invalidateQueries();
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onTap()}
      aria-label={label}
      title={label}
      className="icon-btn relative"
    >
      <RefreshCw className={cn("size-[18px]", busy && "animate-spin")} />
      <span
        aria-hidden
        className={cn(
          "absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-background",
          failed ? "bg-destructive" : "bg-gold",
        )}
      />
    </button>
  );
}
