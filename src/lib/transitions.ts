/**
 * Book-opening transition: the tapped cover grows into the reader using the
 * View Transitions API (Safari 18+, Chrome). Browsers without it, and people
 * with Reduce Motion on, just navigate.
 */
export const BOOK_OPEN = "book-open";

export function canAnimateTransitions() {
  if (typeof document === "undefined") return false;
  if (!("startViewTransition" in document)) return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Tag the cover element so the browser morphs it into the reader (which
 * carries the same view-transition-name), and return whether to request a
 * view transition when navigating.
 */
export function prepareBookOpen(cover: HTMLElement | null | undefined) {
  if (!cover || !canAnimateTransitions()) return false;
  // Only one element may hold the name at a time.
  document.querySelectorAll<HTMLElement>("[data-book-open]").forEach((el) => {
    el.style.viewTransitionName = "";
    delete el.dataset["bookOpen"];
  });
  cover.style.viewTransitionName = BOOK_OPEN;
  cover.dataset["bookOpen"] = "1";
  return true;
}
