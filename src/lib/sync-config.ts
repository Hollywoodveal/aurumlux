/**
 * Sync settings, kept separate from the sync engine so screens can show the
 * sync status without loading it.
 */
import { getSetting, setSetting } from "./db";

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
