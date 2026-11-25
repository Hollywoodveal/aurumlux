import { describe, expect, test } from "bun:test";
import {
  candidateNames,
  parseCharacters,
  relevantPassages,
} from "@/lib/reading-text";

const story = `Elizabeth Bennet walked to Netherfield. The rain fell. Elizabeth Bennet
was tired, and Mr Darcy watched her. Later Darcy spoke to Jane about it, and Jane
smiled at Elizabeth Bennet. "She is here," said Darcy, and Elizabeth Bennet nodded. Jane went to Netherfield too, and
Netherfield was quiet. They all met Darcy again, and Jane laughed with Elizabeth Bennet.`;

describe("who's who", () => {
  test("finds repeated names, not words that start sentences", () => {
    const names = candidateNames(story);
    expect(names).toContain("Elizabeth Bennet");
    expect(names).toContain("Darcy");
    expect(names).toContain("Jane");
    expect(names).toContain("Netherfield");
    expect(names).not.toContain("The");
    expect(names).not.toContain("They");
  });

  test("reads the model's lines in the reader's order", () => {
    const parsed = parseCharacters(
      "- **Jane** — Elizabeth's sister\nDarcy: a proud gentleman\nnonsense line",
      ["Darcy", "Jane"],
    );
    expect(parsed).toEqual([
      { name: "Darcy", about: "a proud gentleman" },
      { name: "Jane", about: "Elizabeth's sister" },
    ]);
  });
});

describe("ask the book", () => {
  test("picks passages that mention the question's words, in book order", () => {
    const read =
      "filler words here. ".repeat(80) +
      "The lighthouse keeper lost his lantern." +
      " more filler text.".repeat(90) +
      "Nothing here.";
    const passages = relevantPassages(read, "Where is the lantern?", 1500, 1);
    expect(passages[0]).toContain("lantern");
  });
});
