import { describe, expect, test } from "bun:test";
import { ActiveTimer } from "@/lib/active-time";

const MIN = 60_000;

describe("ActiveTimer", () => {
  test("counts steady reading", () => {
    const t = new ActiveTimer(0, 5 * MIN);
    t.activity(2 * MIN);
    t.activity(4 * MIN);
    expect(t.elapsed(4 * MIN)).toBe(4 * MIN);
  });

  test("caps a long idle gap", () => {
    const t = new ActiveTimer(0, 5 * MIN);
    t.activity(1 * MIN);
    // Phone left open for an hour.
    t.activity(61 * MIN);
    expect(t.elapsed(61 * MIN)).toBe(6 * MIN);
    // Peeking while idle never shows more than the cap.
    expect(t.elapsed(200 * MIN)).toBe(11 * MIN);
  });

  test("stops while hidden", () => {
    const t = new ActiveTimer(0, 5 * MIN);
    t.activity(3 * MIN);
    t.pause(4 * MIN);
    expect(t.paused).toBe(true);
    expect(t.elapsed(90 * MIN)).toBe(4 * MIN);
    t.resume(90 * MIN);
    t.activity(92 * MIN);
    expect(t.elapsed(92 * MIN)).toBe(6 * MIN);
  });

  test("activity while paused restarts the clock without counting the gap", () => {
    const t = new ActiveTimer(0, 5 * MIN);
    t.pause(1 * MIN);
    t.activity(30 * MIN);
    expect(t.elapsed(31 * MIN)).toBe(2 * MIN);
  });

  test("ignores clocks going backwards", () => {
    const t = new ActiveTimer(10 * MIN, 5 * MIN);
    expect(t.elapsed(9 * MIN)).toBe(0);
  });
});
