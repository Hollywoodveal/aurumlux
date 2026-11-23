import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getSetting, setSetting } from "@/lib/db";
import { restoreMissingCovers, type RepairSummary } from "@/lib/importer";

const DONE_KEY = "coverRescanVersion";
/** Bump when the repair improves, to re-check older imports once. */
const VERSION = 3;

/** One line per kind of fix, only for the kinds that actually fixed something. */
function describeRepair(summary: RepairSummary): string | null {
  const parts: string[] = [];
  if (summary.covers > 0)
    parts.push(
      `found covers for ${summary.covers} book${summary.covers === 1 ? "" : "s"}`,
    );
  if (summary.pages > 0)
    parts.push(
      `fixed page counts for ${summary.pages} book${summary.pages === 1 ? "" : "s"}`,
    );
  if (summary.details > 0)
    parts.push(
      `filled in details for ${summary.details} book${summary.details === 1 ? "" : "s"}`,
    );
  if (parts.length === 0) {
    // Say how many books were checked, so a run that finds nothing is not
    // mistaken for a run that never looked.
    if (summary.checked > 0)
      return `Checked ${summary.checked} book${summary.checked === 1 ? "" : "s"}, nothing could be fixed from their files`;
    return null;
  }
  const joined = parts.join(", ");
  return joined[0]?.toUpperCase() + joined.slice(1);
}

async function run(qc: ReturnType<typeof useQueryClient>) {
  const summary = await restoreMissingCovers();
  await setSetting(DONE_KEY, VERSION);
  if (summary.covers + summary.pages + summary.details > 0) {
    void qc.invalidateQueries({ queryKey: ["books"] });
  }
  return summary;
}

/**
 * Runs once in the background after an update that improves the library
 * repair, so books imported earlier pick up covers, page counts and details
 * that were missed. Renders nothing.
 */
export function AutoCoverRescan({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      if ((await getSetting<number>(DONE_KEY, 0)) >= VERSION || cancelled)
        return;
      const summary = await run(qc);
      const message = describeRepair(summary);
      if (message && !cancelled) toast.success(message);
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [enabled, qc]);
  return null;
}

/** Settings button: look inside book files for covers, page counts and details they missed at import. */
export function CoverRescanButton() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const summary = await run(qc);
          toast.success(
            describeRepair(summary) ?? "No repairs needed in your book files",
          );
        } finally {
          setBusy(false);
        }
      }}
      className="btn btn-outline mt-3"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <ImageIcon className="size-4" />
      )}
      Find missing covers and details
    </button>
  );
}
