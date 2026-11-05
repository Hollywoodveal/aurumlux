/**
 * Screen-reader announcements. Readers and read-aloud are highly visual, so
 * page turns and narration state changes are mirrored into a polite live
 * region (mounted once in the root layout) for assistive technology.
 */

const EVENT = "aurum:announce";

export function announce(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function onAnnounce(fn: (message: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
