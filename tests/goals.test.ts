import { expect, test } from "bun:test";
import { minutesOnDay, sessionMinutes, sessionMs } from "@/lib/goals";
import { book, session } from "./fixtures";

const day = new Date(2026, 10, 2, 9).getTime();

test("tracked sessions count active time, not time open", () => {
  const s = session("s", day, day + 3 * 3_600_000, { activeMs: 20 * 60_000 });
  expect(sessionMs(s)).toBe(20 * 60_000);
  expect(sessionMinutes(s)).toBe(20);
});

test("older and logged sessions fall back to end - start", () => {
  const s = session("s", day, day + 15 * 60_000);
  expect(sessionMinutes(s)).toBe(15);
});

test("minutesOnDay uses active time", () => {
  const b = book({
    sessions: [
      session("a", day, day + 2 * 3_600_000, { activeMs: 10 * 60_000 }),
      session("b", day + 3_600_000, day + 3_600_000 + 5 * 60_000),
    ],
  });
  expect(minutesOnDay([b], day)).toBe(15);
});
