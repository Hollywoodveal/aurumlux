import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getSetting, setSetting } from "@/lib/db";
import { restoreMissingCovers } from "@/lib/importer";

const DONE_KEY = "coverRescanVersion";
/** Bump when cover detection improves, to re-check older imports once. */
const VERSION = 1;

async function run(qc: ReturnType<typeof useQueryClient>) {
  const found = await restoreMissingCovers();
  await setSetting(DONE_KEY, VERSION);
  if (found > 0) {
    void qc.invalidateQueries({ queryKey: ["books"] });
  }
  return found;
}

/**
 * Runs once in the background after an update that improves cover detection,
 * so books imported earlier pick up covers that were missed. Renders nothing.
 */
export function AutoCoverRescan({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      if ((await getSetting<number>(DONE_KEY, 0)) >= VERSION || cancelled)
        return;
      const found = await run(qc);
      if (found > 0 && !cancelled)
        toast.success(
          `Found covers for ${found} book${found === 1 ? "" : "s"} in your library`,
        );
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [enabled, qc]);
  return null;
}

/** Settings button: look inside every coverless book's file for a cover. */
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
          const found = await run(qc);
          toast.success(
            found > 0
              ? `Found covers for ${found} book${found === 1 ? "" : "s"}`
              : "No missing covers were found in your book files",
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
      Find missing covers
    </button>
  );
}
