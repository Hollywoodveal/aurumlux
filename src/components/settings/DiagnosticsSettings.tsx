import { useEffect, useState } from "react";
import { toast } from "sonner";
import { buildReport, clearErrors, readErrors } from "@/lib/diagnostics";
import { shareOrDownload } from "@/lib/export-notes";

/** Share or clear the on-device problem log (Settings › Privacy). */
export function DiagnosticsSettings() {
  const [count, setCount] = useState(0);
  useEffect(() => setCount(readErrors().length), []);

  return (
    <div>
      <p className="mt-1 text-sm text-muted-foreground">
        If Aurum misbehaves, it notes the error here, on this device only.
        Nothing is sent anywhere unless you share a report yourself. Reports
        hold error messages and device details, never your books or notes.
      </p>
      <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
        {count === 0
          ? "No problems recorded."
          : `${count} problem${count === 1 ? "" : "s"} recorded.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-outline text-xs uppercase tracking-[0.16em]"
          onClick={async () => {
            const report = await buildReport();
            const stamp = new Date().toISOString().slice(0, 10);
            await shareOrDownload(
              report,
              `aurum-problem-report-${stamp}.json`,
              "application/json",
            );
          }}
        >
          Share a problem report
        </button>
        {count > 0 ? (
          <button
            type="button"
            className="btn btn-outline text-xs uppercase tracking-[0.16em]"
            onClick={() => {
              clearErrors();
              setCount(0);
              toast.success("Problem log cleared");
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
