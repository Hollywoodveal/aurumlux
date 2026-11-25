import { describe, expect, test } from "bun:test";
import { easeTurn, stripAngles } from "@/lib/page-flip";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("page curl", () => {
  test("forward turn starts flat on the right and lands flat on the left", () => {
    expect(sum(stripAngles(0, false))).toBeCloseTo(0);
    expect(sum(stripAngles(1, false))).toBeCloseTo(-180);
  });
  test("turning back starts on the left and lands on the right", () => {
    expect(sum(stripAngles(0, true))).toBeCloseTo(-180);
    expect(sum(stripAngles(1, true))).toBeCloseTo(0);
  });
  test("the free edge curls ahead of the hinge mid-turn", () => {
    const [hinge = 0, ...bends] = stripAngles(0.5, false);
    expect(hinge).toBeCloseTo(-90);
    expect(sum(bends)).toBeLessThan(-60);
    // Each strip bends a little more than the one before it.
    for (let i = 1; i < bends.length; i += 1)
      expect(bends[i] ?? 0).toBeLessThan(bends[i - 1] ?? 0);
  });
  test("easing starts and ends gently", () => {
    expect(easeTurn(0)).toBe(0);
    expect(easeTurn(1)).toBe(1);
    expect(easeTurn(0.1)).toBeLessThan(0.1);
  });
});
