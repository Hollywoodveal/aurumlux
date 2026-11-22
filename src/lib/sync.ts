/**
 * Optional sync through the reader's own WebDAV storage (Nextcloud, ownCloud,
 * Synology, Koofr, a NAS, …). Off by default.
 *
 * Only reading data travels: positions, reading history, bookmarks, highlights
 * and notes — the same encrypted bundle as the manual transfer file. Book files
 * stay on each device. The bundle is encrypted on the device with a passphrase
 * before upload, so the storage provider only ever sees ciphertext.
 *
 * A sync downloads the remote file, merges it into this device, then uploads
 * the merged result. Writes use the file's ETag so two devices syncing at once
 * can't overwrite each other: the loser re-merges and tries again.
 */
import {
  buildSyncBundle,
  decryptBundle,
  encryptBundle,
  mergeSyncBundle,
  type MergeReport,
  type SyncBundle,
} from "./backup";
import { getSetting, setSetting } from "./db";
import { basicAuth, fetchExternal } from "./net";

export type SyncConfig = {
  enabled: boolean;
  /** WebDAV folder, e.g. https://cloud.example.com/remote.php/dav/files/me/Aurum/ */
  folderUrl: string;
  username: string;
  password: string;
  passphrase: string;
  /** Sync when the app opens and after closing a book. */
  auto: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
};

export const SYNC_FILE = "aurum-sync.aurum";
const KEY = "syncConfig";

export const DEFAULT_SYNC: SyncConfig = {
  enabled: false,
  folderUrl: "",
  username: "",
  password: "",
  passphrase: "",
  auto: true,
  lastSyncAt: null,
  lastError: null,
};

export async function getSyncConfig(): Promise<SyncConfig> {
  return {
    ...DEFAULT_SYNC,
    ...(await getSetting<Partial<SyncConfig>>(KEY, {})),
  };
}

export async function saveSyncConfig(config: SyncConfig) {
  await setSetting(KEY, config);
}

/** The sync file's URL inside the configured folder. */
export function syncFileUrl(folderUrl: string) {
  const base = folderUrl.trim().replace(/\/+$/, "");
  return `${base}/${SYNC_FILE}`;
}

export function validateSyncConfig(c: SyncConfig): string | null {
  if (!/^https:\/\//i.test(c.folderUrl.trim()))
    return "Enter your WebDAV folder address, starting with https://";
  if (c.passphrase.length < 8)
    return "Choose an encryption passphrase of at least 8 characters";
  return null;
}

function friendly(status: number) {
  if (status === 401 || status === 403)
    return "The sync server didn't accept the username or password.";
  if (status === 404 || status === 409)
    return "That folder doesn't exist on the sync server. Create it first, then try again.";
  if (status === 507) return "The sync server is out of space.";
  return `The sync server returned an error (${status}).`;
}

export type SyncResult = MergeReport & { uploaded: boolean };

let running: Promise<SyncResult> | null = null;

/** Sync now. Concurrent calls share one run. */
export function syncNow(): Promise<SyncResult> {
  running ??= runSync().finally(() => {
    running = null;
  });
  return running;
}

async function runSync(): Promise<SyncResult> {
  const config = await getSyncConfig();
  const problem = validateSyncConfig(config);
  if (problem) throw new Error(problem);
  const url = syncFileUrl(config.folderUrl);
  const authorization = config.username
    ? basicAuth(config.username, config.password)
    : undefined;
  const auth = authorization ? { authorization } : {};

  const report: SyncResult = {
    positions: 0,
    added: 0,
    removed: 0,
    annotations: 0,
    uploaded: false,
  };

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // 1. Pull and merge whatever the other devices last wrote.
      const { response } = await fetchExternal(url, auth);
      let etag: string | null = null;
      if (response.ok) {
        etag = response.headers.get("etag");
        let bundle: SyncBundle;
        try {
          bundle = await decryptBundle(
            await response.text(),
            config.passphrase,
          );
        } catch {
          throw new Error(
            "The sync file couldn't be opened with this passphrase. Use the same passphrase on every device.",
          );
        }
        const merged = await mergeSyncBundle(bundle);
        report.positions += merged.positions;
        report.added += merged.added;
        report.removed += merged.removed;
        report.annotations += merged.annotations;
      } else if (response.status !== 404) {
        throw new Error(friendly(response.status));
      }

      // 2. Push the merged library back.
      const payload = await encryptBundle(
        await buildSyncBundle(),
        config.passphrase,
      );
      const put = await fetchExternal(url, {
        ...auth,
        method: "PUT",
        body: payload,
        headers: etag ? { "if-match": etag } : { "if-none-match": "*" },
      });
      // Someone else wrote in between: merge their version and retry.
      if (put.response.status === 412) continue;
      if (!put.response.ok) throw new Error(friendly(put.response.status));
      report.uploaded = true;
      break;
    }
    if (!report.uploaded)
      throw new Error(
        "Another device kept syncing at the same time. Try again.",
      );
    await saveSyncConfig({
      ...config,
      lastSyncAt: Date.now(),
      lastError: null,
    });
    return report;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await saveSyncConfig({ ...config, lastError: message });
    throw e instanceof Error ? e : new Error(message);
  }
}

/** Sync in the background if the reader turned on automatic sync. */
export async function autoSync(): Promise<SyncResult | null> {
  const config = await getSyncConfig();
  if (!config.enabled || !config.auto || validateSyncConfig(config))
    return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return null;
  try {
    return await syncNow();
  } catch {
    return null; // the error is saved on the config and shown in Settings
  }
}
