import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const SEEN_KEY = "aurum:tapzones-seen";

/**
 * One-time overlay on a reader's first open showing where to tap to turn
 * pages. Disappears on any tap, or by itself after a few seconds.
 */
export function TapZoneHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      return;
    }
    setShow(true);
    const t = window.setTimeout(() => setShow(false), 6000);
    return () => window.clearTimeout(t);
  }, []);

  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => setShow(false)}
      aria-label="Dismiss page-turn hint"
      className="animate-in fade-in absolute inset-0 z-20 flex bg-black/45 text-left"
    >
      <span className="flex w-[18%] flex-col items-center justify-center gap-2 border-r border-dashed border-gold/50 bg-gold/10 text-gold">
        <ChevronLeft className="size-6" aria-hidden />
        <span className="px-1 text-center text-[10px] uppercase tracking-[0.14em]">
          Previous
        </span>
      </span>
      <span className="flex flex-1 items-center justify-center px-4">
        <span className="rounded-2xl border border-gold/30 bg-card/95 px-4 py-3 text-center shadow-lux">
          <span className="block font-display text-lg text-ivory">
            Tap the edges to turn pages
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Arrow keys work too. Tap anywhere to start reading.
          </span>
        </span>
      </span>
      <span className="flex w-[18%] flex-col items-center justify-center gap-2 border-l border-dashed border-gold/50 bg-gold/10 text-gold">
        <ChevronRight className="size-6" aria-hidden />
        <span className="px-1 text-center text-[10px] uppercase tracking-[0.14em]">
          Next
        </span>
      </span>
    </button>
  );
}
