/**
 * Reading help from Apple's on-device model (iOS app only): a "previously
 * in…" recap, a spoiler-free who's who, and questions about the book.
 *
 * Everything is built only from text before the reader's current position,
 * so nothing ahead is ever revealed. The model's context is small (about
 * 4,000 tokens), so each request sends a carefully chosen slice of the text.
 */
import type { BookMeta } from "./db";
import { callNative, callNativeStrict, isNativeApp } from "./native";
import {
  candidateNames,
  mentions,
  parseCharacters,
  relevantPassages,
  trimToWords,
  type Character,
} from "./reading-text";
import { ensureTextIndex } from "./textindex";

export { candidateNames, parseCharacters, relevantPassages };
export type { Character };

/** Roughly 2,300 tokens of book text per request, leaving room to answer. */
const PROMPT_CHARS = 9000;

export type AiStatus = { available: boolean; reason?: string };

export async function aiStatus(): Promise<AiStatus> {
  if (!isNativeApp())
    return { available: false, reason: "Only in the Aurum iPhone app." };
  return (
    (await callNative<AiStatus>("aiStatus")) ?? {
      available: false,
      reason: "Apple Intelligence isn't available right now.",
    }
  );
}

const SPOILER_RULE =
  "You only know the excerpt you are given, which ends where the reader stopped. Never guess or mention what happens later. If the excerpt doesn't say, say you don't know yet.";

async function ask(instructions: string, prompt: string): Promise<string> {
  const text = await callNativeStrict<string>("aiRespond", {
    instructions,
    prompt,
  });
  return (text ?? "").trim();
}

/** The book's text up to `fraction` (0–1) of the way through. */
export async function textReadSoFar(
  book: BookMeta,
  fraction: number,
): Promise<string> {
  const index = await ensureTextIndex(book);
  const full = (index?.sections ?? []).map((s) => s.text).join("\n\n");
  const end = Math.round(full.length * Math.min(1, Math.max(0, fraction)));
  return full.slice(0, end);
}

// ---------------------------------------------------------------------------
// Recap

export async function recap(book: BookMeta, fraction: number) {
  const read = await textReadSoFar(book, fraction);
  if (read.length < 400)
    return "You've only just started — nothing to recap yet.";
  const recent = trimToWords(read.slice(-PROMPT_CHARS));
  return ask(
    `You help someone pick a book back up. Write a short "previously" recap in plain, warm prose: 4 to 6 sentences covering who is involved, what has just happened and where things stand. No headings, no lists. ${SPOILER_RULE}`,
    `Book: ${book.title}${book.author ? ` by ${book.author}` : ""}\n\nThe most recent pages the reader read:\n"""\n${recent}\n"""`,
  );
}

// ---------------------------------------------------------------------------
// Who's who

export async function whoIsWho(
  book: BookMeta,
  fraction: number,
): Promise<Character[]> {
  const read = await textReadSoFar(book, fraction);
  const names = candidateNames(read);
  if (names.length === 0) return [];
  const budget = Math.floor(PROMPT_CHARS / names.length);
  const notes = names
    .map((name) => {
      const snippets = mentions(read, name).join(" … ").slice(0, budget);
      return `${name}: ${snippets}`;
    })
    .join("\n\n");
  const answer = await ask(
    `You help a reader keep track of who and what is who in a book. For each name, write one short line saying who or what it is, based only on the passages. Skip anything that isn't a person, group or place. Answer only with lines in the form "Name — description". ${SPOILER_RULE}`,
    `Book: ${book.title}\n\nNames with passages where they appear:\n\n${notes}`,
  );
  return parseCharacters(answer, names);
}

// ---------------------------------------------------------------------------
// Ask the book

export async function askBook(
  book: BookMeta,
  fraction: number,
  question: string,
): Promise<string> {
  const read = await textReadSoFar(book, fraction);
  if (read.length < 200)
    return "You haven't read enough of this book yet for me to answer.";
  const passages = relevantPassages(read, question);
  // Always include the latest page, so "what just happened" questions work.
  const latest = trimToWords(read.slice(-1500));
  const context = [...passages, latest].join("\n…\n").slice(-PROMPT_CHARS);
  return ask(
    `You answer a reader's question about the book they are reading, using only the passages. Be brief and plain: 1 to 4 sentences. ${SPOILER_RULE}`,
    `Book: ${book.title}\n\nPassages from what the reader has read so far:\n"""\n${context}\n"""\n\nQuestion: ${question}`,
  );
}
