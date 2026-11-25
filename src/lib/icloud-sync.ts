/**
 * iCloud sync, inside the iOS app only. Reading positions, history,
 * bookmarks, highlights and notes go to the app's private iCloud Drive folder
 * and are merged on every device signed in to the same Apple Account. Book
 * files stay on each device, as with WebDAV sync.
 *
 * The app needs Apple's iCloud capability, which only paid Apple Developer
 * accounts can add; until then `icloudStatus` reports it unavailable.
 */
import {
  buildSyncBundle,
  mergeSyncBundle,
  type MergeReport,
  type SyncBundle,
} from "./backup";
import { getSetting, setSetting } from "./db";
import { callNative, callNativeStrict, isNativeApp } from "./native";

export type ICloudStatus = { available: boolean; signedIn: boolean };
export type ICloudConfig = {
  enabled: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
};

const KEY = "icloudSync";
const DEFAULT: ICloudConfig = {
  enabled: false,
  lastSyncAt: null,
  lastError: null,
};

export async function getICloudConfig(): Promise<ICloudConfig> {
  return { ...DEFAULT, ...(await getSetting<Partial<ICloudConfig>>(KEY, {})) };
}

export async function saveICloudConfig(config: ICloudConfig) {
  await setSetting(KEY, config);
}

export async function icloudStatus(): Promise<ICloudStatus> {
  if (!isNativeApp()) return { available: false, signedIn: false };
  return (
    (await callNative<ICloudStatus>("icloudStatus")) ?? {
      available: false,
      signedIn: false,
    }
  );
}

function isBundle(value: unknown): value is SyncBundle {
  const v = value as Partial<SyncBundle> | null;
  return Boolean(v && v.app === "aurum" && v.kind === "sync");
}

let running: Promise<MergeReport> | null = null;

/** Sync with iCloud now. Concurrent calls share one run. */
export function syncICloud(): Promise<MergeReport> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<MergeReport> {
  const config = await getICloudConfig();
  const report: MergeReport = {
    positions: 0,
    added: 0,
    removed: 0,
    annotations: 0,
  };
  try {
    let written = false;
    for (let attempt = 0; attempt < 3 && !written; attempt += 1) {
      // 1. Merge what the other devices last wrote.
      const remote = await callNativeStrict<{
        text: string;
        version: string;
      } | null>("icloudRead");
      if (remote?.text) {
        const parsed: unknown = JSON.parse(remote.text);
        if (!isBundle(parsed))
          throw new Error("The iCloud sync file isn't from Aurum.");
        const merged = await mergeSyncBundle(parsed);
        report.positions += merged.positions;
        report.added += merged.added;
        report.removed += merged.removed;
        report.annotations += merged.annotations;
      }
      // 2. Write the merged library back, unless another device beat us to it.
      try {
        await callNativeStrict("icloudWrite", {
          text: JSON.stringify(await buildSyncBundle()),
          ifVersion: remote?.version ?? null,
        });
        written = true;
      } catch (error) {
        if (!(error instanceof Error) || !/conflict/i.test(error.message))
          throw error;
      }
    }
    if (!written)
      throw new Error(
        "Another device kept syncing at the same time. Try again.",
      );
    await saveICloudConfig({
      ...config,
      lastSyncAt: Date.now(),
      lastError: null,
    });
    return report;
  } catch (e) {
    const message = e instanceof Error ? e.message : "iCloud sync failed";
    await saveICloudConfig({ ...config, lastError: message });
    throw e instanceof Error ? e : new Error(message);
  }
}

/** Sync quietly if iCloud sync is on (app open, leaving the app). */
export async function autoSyncICloud(): Promise<MergeReport | null> {
  if (!isNativeApp()) return null;
  const config = await getICloudConfig();
  if (!config.enabled) return null;
  try {
    return await syncICloud();
  } catch {
    return null; // shown in Settings
  }
}
