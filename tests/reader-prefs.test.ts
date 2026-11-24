import { describe, expect, test } from "bun:test";
import { DEFAULT_PREFS, withPrefDefaults } from "@/lib/reader-prefs";

describe("withPrefDefaults", () => {
  test("old settings on the former default move to the page turn", () => {
    const p = withPrefDefaults({
      ...DEFAULT_PREFS,
      pageAnim: "slide",
      prefsVersion: undefined,
    });
    expect(p.pageAnim).toBe("turn");
    expect(p.prefsVersion).toBe(2);
  });
  test("a choice made after the update is kept", () => {
    const p = withPrefDefaults({
      ...DEFAULT_PREFS,
      pageAnim: "slide",
      prefsVersion: 2,
    });
    expect(p.pageAnim).toBe("slide");
  });
  test("old settings that picked fade or none keep them", () => {
    const p = withPrefDefaults({
      ...DEFAULT_PREFS,
      pageAnim: "fade",
      prefsVersion: undefined,
    });
    expect(p.pageAnim).toBe("fade");
  });
});
