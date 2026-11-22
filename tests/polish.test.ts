import { describe, expect, test } from "bun:test";
import { pickColor } from "@/hooks/useCoverColor";
import { storyCards, type YearRecap } from "@/components/YearStory";

function pixels(...rgb: [number, number, number][]) {
  return new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));
}

describe("pickColor", () => {
  test("prefers saturated colour over black borders", () => {
    const data = pixels([0, 0, 0], [0, 0, 0], [0, 0, 0], [200, 40, 40]);
    expect(pickColor(data)).toBe("200 40 40");
  });
  test("null for an all-black or all-white cover", () => {
    expect(pickColor(pixels([0, 0, 0], [5, 5, 5]))).toBeNull();
    expect(pickColor(pixels([255, 255, 255]))).toBeNull();
  });
});

describe("storyCards", () => {
  const full: YearRecap = {
    year: 2026,
    finished: 12,
    pages: 3400,
    minutes: 2400,
    activeDays: 90,
    topGenre: "Fantasy",
    topAuthor: "Ursula K. Le Guin",
    bestMonth: "July",
  };
  test("a full year has a card for each highlight", () => {
    const cards = storyCards(full);
    expect(cards.map((c) => c.big)).toEqual([
      "2026",
      "12",
      "40 hours",
      "Ursula K. Le Guin",
      "July",
      "Here's to the next chapter",
    ]);
    expect(cards[1]?.line).toBe("3,400 pages turned");
    expect(cards[2]?.line).toBe("across 90 reading days");
  });
  test("skips cards with nothing to say", () => {
    const cards = storyCards({
      ...full,
      finished: 0,
      pages: 0,
      topAuthor: null,
      bestMonth: null,
      minutes: 45,
      activeDays: 1,
    });
    expect(cards.map((c) => c.eyebrow)).toEqual([
      "Aurum",
      "Time reading",
      "Where every page is treasured",
    ]);
    expect(cards[1]?.big).toBe("45 minutes");
    expect(cards[1]?.line).toBe("across 1 reading day");
  });
});
