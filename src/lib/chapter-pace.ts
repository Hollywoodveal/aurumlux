/**
 * "Time left in chapter" for the EPUB reader, from pages left in the current
 * chapter and the reader's own recent pace between page turns.
 */
const MIN_TURN_MS = 3_000; // faster than this is flicking, not reading
const MAX_TURN_MS = 5 * 60_000; // slower than this is a break
const SAMPLES = 15;

export class PagePace {
  private last: number | null = null;
  private turns: number[] = [];

  /** Record a page turn; returns nothing. */
  turn(now: number) {
    if (this.last !== null) {
      const gap = now - this.last;
      if (gap >= MIN_TURN_MS && gap <= MAX_TURN_MS) {
        this.turns.push(gap);
        if (this.turns.length > SAMPLES) this.turns.shift();
      }
    }
    this.last = now;
  }

  /** Median milliseconds per page, once there are enough turns to trust. */
  msPerPage(): number | null {
    if (this.turns.length < 3) return null;
    const sorted = [...this.turns].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
  }
}

/** e.g. "6 pages left in chapter · about 4 min", or null when unknown. */
export function chapterLeftLabel(
  page: number | undefined,
  total: number | undefined,
  msPerPage: number | null,
): string | null {
  if (!page || !total || total < 2) return null;
  const left = Math.max(0, total - page);
  if (left === 0) return "Last page of the chapter";
  const pages = `${left} page${left === 1 ? "" : "s"} left in chapter`;
  if (msPerPage === null) return pages;
  const minutes = Math.max(1, Math.round((left * msPerPage) / 60_000));
  return `${pages} · about ${minutes} min`;
}
