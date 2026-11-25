import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getICloudConfig,
  icloudStatus,
  saveICloudConfig,
  syncICloud,
  type ICloudConfig,
  type ICloudStatus,
} from "@/lib/icloud-sync";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** iCloud sync between the reader's Apple devices (iOS app only). */
export function ICloudSyncSettings() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ICloudStatus | null>(null);
  const [config, setConfig] = useState<ICloudConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void icloudStatus().then(setStatus);
    void getICloudConfig().then(setConfig);
  }, []);

  async function run() {
    if (!config) return;
    setBusy(true);
    await saveICloudConfig({ ...config, enabled: true });
    try {
      const r = await syncICloud();
      void qc.invalidateQueries();
      const changes = [
        r.positions && plural(r.positions, "position"),
        r.added && plural(r.added, "new book"),
        r.removed && plural(r.removed, "removed book"),
        r.annotations && plural(r.annotations, "annotation"),
      ].filter(Boolean);
      toast.success(
        changes.length
          ? `Synced with iCloud · ${changes.join(", ")}`
          : "Synced with iCloud · up to date",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "iCloud sync failed");
    } finally {
      setConfig(await getICloudConfig());
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!config) return;
    const next = { ...config, enabled: false };
    setConfig(next);
    await saveICloudConfig(next);
    toast.info("iCloud sync turned off on this device");
  }

  if (!status || !config) return null;

  if (!status.available) {
    return (
      <p className="mt-1 text-sm text-muted-foreground">
        {status.signedIn
          ? "iCloud sync is built in, but this copy of the app can't use iCloud yet. Apple only lets apps use iCloud when they're signed with a paid Apple Developer account. Once the app has the iCloud capability, it turns on here. Until then, WebDAV sync below works between the app and the website."
          : "Sign in to iCloud in the Settings app and turn on iCloud Drive to sync with iCloud."}
      </p>
    );
  }

  return (
    <div>
      <p className="mt-1 text-sm text-muted-foreground">
        Keep reading positions, history, bookmarks, highlights and notes in step
        on every iPhone and iPad signed in to your Apple Account. Book files
        stay on each device: import a book on each one and it picks up the
        synced position.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void run()}
          disabled={busy}
          className="btn btn-gold"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {config.enabled ? "Sync now" : "Turn on iCloud sync"}
        </button>
        {config.enabled ? (
          <button
            onClick={() => void turnOff()}
            disabled={busy}
            className="btn btn-outline"
          >
            Turn off
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
        {config.lastError
          ? `Last sync failed: ${config.lastError}`
          : config.lastSyncAt
            ? `Last synced ${new Date(config.lastSyncAt).toLocaleString()}`
            : "Not synced yet."}
      </p>
    </div>
  );
}
