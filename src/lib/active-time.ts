/**
 * Counts time actually spent reading, rather than time the book was open.
 *
 * Time stops while the page is hidden (app backgrounded, screen locked), and a
 * long gap with no page turn or touch counts for at most `idleMs`, so a phone
 * left open on the nightstand doesn't add hours to the stats.
 */
export const IDLE_MS = 5 * 60_000;

export class ActiveTimer {
  private total = 0;
  /** Timestamp of the last activity while running; null while paused. */
  private last: number | null;

  constructor(
    now: number,
    private readonly idleMs = IDLE_MS,
  ) {
    this.last = now;
  }

  private gap(now: number) {
    if (this.last === null) return 0;
    return Math.min(Math.max(0, now - this.last), this.idleMs);
  }

  /** The reader did something (turned a page, tapped, scrolled). */
  activity(now: number) {
    if (this.last === null) {
      this.last = now;
      return;
    }
    this.total += this.gap(now);
    this.last = now;
  }

  /** The page was hidden: bank what's been read so far and stop counting. */
  pause(now: number) {
    this.total += this.gap(now);
    this.last = null;
  }

  /** The page is visible again. */
  resume(now: number) {
    if (this.last === null) this.last = now;
  }

  get paused() {
    return this.last === null;
  }

  /** Active milliseconds so far. Doesn't change the timer's state. */
  elapsed(now: number) {
    return this.total + this.gap(now);
  }
}
