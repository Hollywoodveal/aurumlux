import { describe, expect, test } from "bun:test";
import { strokeDistance } from "@/lib/ink";

describe("ink eraser", () => {
  test("measures how close a point is to a stroke", () => {
    const stroke = { c: "#fff", p: [0.1, 0.1, 0.5, 0.2, 0.1, 0.5] };
    expect(strokeDistance(stroke, 0.2, 0.1)).toBeCloseTo(0);
    expect(strokeDistance(stroke, 0.2, 0.3)).toBeCloseTo(0.2);
  });
});
