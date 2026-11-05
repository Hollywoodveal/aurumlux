import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { applySwUpdate, onSwUpdateAvailable } from "@/lib/pwa";

/**
 * "New version, tap to refresh" bar. A freshly installed service worker waits
 * instead of taking over mid-session, so the reader chooses when the app
 * reloads — never a surprise swap while a book is open.
 */
export function UpdatePrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => onSwUpdateAvailable(() => setShow(true)), []);

  if (!show) return null;

  return (
    <div className="fixed inset-x-3 z-40 bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-gold/30 bg-card/95 p-4 shadow-lux backdrop-blur">
      <div className="rounded-full border border-gold/30 p-2 text-gold">
        <RefreshCw className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg leading-tight text-ivory">
          New version ready
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          A newer Aurum is downloaded and waiting. Refresh when you're ready —
          your place in every book is saved.
        </p>
        <button
          type="button"
          onClick={() => applySwUpdate()}
          className="mt-3 rounded-full bg-gradient-gold px-4 py-1.5 text-xs uppercase tracking-[0.16em] text-primary-foreground"
        >
          Refresh
        </button>
      </div>
      <button
        type="button"
        onClick={() => setShow(false)}
        aria-label="Dismiss update prompt"
      >
        <X className="size-4 text-muted-foreground" />
      </button>
    </div>
  );
}
