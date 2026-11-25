/**
 * Text helpers for the reading assistant (src/lib/intelligence.ts): finding
 * names, picking passages and reading the model's answers. No app imports,
 * so they're easy to test.
 */

export type Character = { name: string; about: string };

/** Starts and ends a slice on whole words. */
export function trimToWords(text: string) {
  return text.replace(/^\S*\s/, "").replace(/\s\S*$/, "");
}

const NOT_NAMES = new Set(
  `The A An And But Or If Then When While After Before Because Though Although
  He She It They We You I His Her Its Their Our Your My Mr Mrs Ms Dr Sir Lady
  Lord This That These Those There Here What Who Why How Where Which Yes No Not
  Oh Well So Now Just Even Still Yet All Some Any One Two Three Chapter Part
  Book Section Page Monday Tuesday Wednesday Thursday Friday Saturday Sunday
  January February March April May June July August September October November
  December God Christmas Then Once Perhaps Maybe Every Each Both Nothing
  Everything Something Someone Nobody Everyone As At By For From In Into Of On
  To With Without Over Under Up Down Out Again Never Always Only Also Soon`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Likely names of people and places: capitalised words (or pairs, like
 * "Mrs Dalloway") that appear several times, and not just at the start of
 * sentences. Most frequent first.
 */
export function candidateNames(text: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  const re = /(?:^|[^.!?"“”'‘’]\s+)([A-Z][a-z'’]+(?:\s[A-Z][a-z'’]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = (m[1] ?? "").replace(/[’']s$/, "");
    const words = raw.split(" ").filter((w) => !NOT_NAMES.has(w));
    const name = words.join(" ");
    if (name.length < 3) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  // Fold single words into the two-word names that contain them.
  for (const [name, n] of counts) {
    if (!name.includes(" ")) continue;
    for (const part of name.split(" ")) {
      const single = counts.get(part);
      if (single !== undefined && single <= n * 3) counts.delete(part);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

/** Up to `per` short passages mentioning `name`: its first and latest. */
export function mentions(text: string, name: string, per = 2, radius = 160) {
  const out: string[] = [];
  const first = text.indexOf(name);
  const last = text.lastIndexOf(name);
  for (const at of per > 1 && last > first + radius ? [first, last] : [first]) {
    if (at < 0) continue;
    out.push(
      trimToWords(
        text.slice(Math.max(0, at - radius), at + radius + name.length),
      ),
    );
  }
  return out;
}

/** Reads "Name — description" lines, keeping the reader's own order. */
export function parseCharacters(answer: string, names: string[]): Character[] {
  const out: Character[] = [];
  for (const line of answer.split("\n")) {
    const m = line
      .replace(/^[\s*•\-\d.)]+/, "")
      .replace(/\*\*/g, "")
      .match(/^(.{2,60}?)\s*[—–:-]\s+(.+)$/);
    if (!m) continue;
    const name = (m[1] ?? "").trim();
    const about = (m[2] ?? "").trim();
    if (!about) continue;
    out.push({ name, about });
  }
  const rank = (n: string) => {
    const i = names.findIndex((x) => x.toLowerCase() === n.toLowerCase());
    return i < 0 ? names.length : i;
  };
  return out.sort((a, b) => rank(a.name) - rank(b.name));
}

const STOP = new Set(
  "the a an and or but of to in on at for with is was are were be been who what why how when where which does did do this that it he she they his her their about from as by".split(
    " ",
  ),
);

function terms(s: string) {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** The passages from what's been read that best match the question. */
export function relevantPassages(
  read: string,
  question: string,
  size = 1500,
  count = 5,
): string[] {
  const wanted = terms(question);
  const chunks: { at: number; text: string; score: number }[] = [];
  for (let at = 0; at < read.length; at += size) {
    const text = read.slice(at, at + size);
    const lower = text.toLowerCase();
    let score = 0;
    for (const w of wanted) {
      let i = lower.indexOf(w);
      while (i >= 0) {
        score += 1;
        i = lower.indexOf(w, i + w.length);
      }
    }
    // A small nudge toward recent pages, which readers usually mean.
    score += (at / Math.max(1, read.length)) * 0.5;
    chunks.push({ at, text, score });
  }
  return chunks
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.at - b.at)
    .map((c) => trimToWords(c.text));
}
