import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/settings/Switch";
import { syncNow } from "@/lib/sync";
import {
  DEFAULT_SYNC,
  getSyncConfig,
  saveSyncConfig,
  validateSyncConfig,
  type SyncConfig,
} from "@/lib/sync-config";

const field =
  "mt-1.5 w-full rounded-xl border border-gold/20 bg-secondary/60 px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-gold/50";
const label = "mt-3 block text-[11px] uppercase tracking-[0.16em] text-gold/70";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Settings panel for optional WebDAV sync between the reader's devices. */
export function SyncSettings() {
  const qc = useQueryClient();
  const [config, setConfig] = useState<SyncConfig>(DEFAULT_SYNC);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getSyncConfig().then(setConfig);
  }, []);

  const update = (patch: Partial<SyncConfig>) =>
    setConfig((c) => ({ ...c, ...patch }));

  async function run() {
    const problem = validateSyncConfig(config);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    const next = { ...config, enabled: true };
    await saveSyncConfig(next);
    try {
      const r = await syncNow();
      void qc.invalidateQueries();
      const changes = [
        r.positions && plural(r.positions, "position"),
        r.added && plural(r.added, "new book"),
        r.removed && plural(r.removed, "removed book"),
        r.annotations && plural(r.annotations, "annotation"),
      ].filter(Boolean);
      toast.success(
        changes.length
          ? `Synced · ${changes.join(", ")}`
          : "Synced · up to date",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setConfig(await getSyncConfig());
      setBusy(false);
    }
  }

  async function turnOff() {
    const next = { ...config, enabled: false };
    setConfig(next);
    await saveSyncConfig(next);
    void qc.invalidateQueries({ queryKey: ["syncStatus"] });
    toast.info("Sync turned off on this device");
  }

  return (
    <div>
      <p className="mt-1 text-sm text-muted-foreground">
        Keep reading positions, history, bookmarks, highlights and notes in step
        across your devices through your own WebDAV storage — Nextcloud,
        ownCloud, Synology, Koofr and others. Everything is encrypted on this
        device with your passphrase before it&apos;s uploaded. Book files
        aren&apos;t uploaded: import a book on each device and it picks up the
        synced position.
      </p>

      <label htmlFor="sync-url" className={label}>
        WebDAV folder
      </label>
      <input
        id="sync-url"
        inputMode="url"
        value={config.folderUrl}
        onChange={(e) => update({ folderUrl: e.target.value })}
        placeholder="https://cloud.example.com/remote.php/dav/files/you/Aurum/"
        className={field}
      />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="sync-user" className={label}>
            Username
          </label>
          <input
            id="sync-user"
            autoComplete="username"
            value={config.username}
            onChange={(e) => update({ username: e.target.value })}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="sync-pw" className={label}>
            App password
          </label>
          <input
            id="sync-pw"
            type="password"
            autoComplete="current-password"
            value={config.password}
            onChange={(e) => update({ password: e.target.value })}
            className={field}
          />
        </div>
      </div>

      <label htmlFor="sync-phrase" className={label}>
        Encryption passphrase
      </label>
      <input
        id="sync-phrase"
        type="password"
        autoComplete="off"
        value={config.passphrase}
        onChange={(e) => update({ passphrase: e.target.value })}
        placeholder="Same on every device · at least 8 characters"
        className={field}
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-ivory">
          Sync when Aurum opens and after reading
        </span>
        <Switch
          checked={config.auto}
          label="Sync automatically"
          onChange={(auto) => {
            const next = { ...config, auto };
            setConfig(next);
            void saveSyncConfig(next);
          }}
        />
      </div>

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
          {config.enabled ? "Sync now" : "Turn on & sync"}
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
      <p className="mt-2 text-xs text-muted-foreground">
        Your sign-in details are saved only on this device. Sync requests pass
        through Aurum&apos;s relay on Cloudflare, because most storage servers
        block direct requests from web apps. The relay stores nothing, and the
        file it carries is already encrypted.
      </p>
    </div>
  );
}
