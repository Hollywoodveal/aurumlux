import { useEffect, useState } from "react";

/**
 * True only after the client has hydrated. Use it to gate UI whose output
 * depends on the current date/time or device storage, which the server cannot
 * render identically.
 */
export function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
