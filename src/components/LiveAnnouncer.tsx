import { useEffect, useRef, useState } from "react";
import { onAnnounce } from "@/lib/announce";

/** The single aria-live region behind `announce()`; visually hidden. */
export function LiveAnnouncer() {
  const [message, setMessage] = useState("");
  const timer = useRef<number | null>(null);

  useEffect(
    () =>
      onAnnounce((next) => {
        // Clear first so a repeated identical message is announced again.
        setMessage("");
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setMessage(next), 40);
      }),
    [],
  );

  return (
    <div aria-live="polite" role="status" className="sr-only">
      {message}
    </div>
  );
}
