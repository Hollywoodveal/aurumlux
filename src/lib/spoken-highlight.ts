/**
 * Follow-along highlighting inside a rendered book document.
 *
 * Narration works on whitespace-normalised passages, so this builds a
 * character map from the document's text nodes to that normalised string.
 * With the map in place a passage can be located exactly and each spoken
 * word turned back into a DOM Range — used both to paint the highlight and
 * to decide when the page should turn.
 */

type Mapped = { node: Text; offset: number };

export class SpokenHighlighter {
  private doc: Document | null = null;
  private text = "";
  private map: Mapped[] = [];
  private cursor = 0;
  private passageStart = -1;
  private passageEnd = -1;

  /** Index the document's text nodes. Call whenever the rendered section changes. */
  attach(doc: Document | null | undefined) {
    this.clear();
    this.doc = doc ?? null;
    this.text = "";
    this.map = [];
    this.cursor = 0;
    this.passageStart = -1;
    if (!doc?.body) return;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const chars: string[] = [];
    let node = walker.nextNode() as Text | null;
    let lastWasSpace = true;
    while (node) {
      const value = node.data;
      for (let i = 0; i < value.length; i++) {
        const ch = value[i]!;
        if (/\s/.test(ch)) {
          if (lastWasSpace) continue;
          chars.push(" ");
          this.map.push({ node, offset: i });
          lastWasSpace = true;
          continue;
        }
        chars.push(ch);
        this.map.push({ node, offset: i });
        lastWasSpace = false;
      }
      node = walker.nextNode() as Text | null;
    }
    this.text = chars.join("");
  }

  get ready() {
    return this.map.length > 0;
  }

  /** Locate a passage in the document, searching forward from the last match. */
  setPassage(passage: string | null) {
    this.passageStart = -1;
    this.passageEnd = -1;
    if (!passage) {
      this.clear();
      return;
    }
    const needle = passage.replace(/\s+/g, " ").trim();
    if (!needle) return;
    let at = this.text.indexOf(needle, this.cursor);
    if (at < 0) at = this.text.indexOf(needle);
    if (at < 0) {
      // Fall back to the opening words, which survive minor text differences.
      const head = needle.split(" ").slice(0, 6).join(" ");
      at = head ? this.text.indexOf(head, this.cursor) : -1;
      if (at < 0) return;
    }
    this.passageStart = at;
    this.passageEnd = at + needle.length;
    this.cursor = at;
  }

  /** Range for a word span expressed in passage-relative characters. */
  rangeFor(span: { start: number; end: number }): Range | null {
    if (this.passageStart < 0 || !this.doc) return null;
    const from = this.map[this.passageStart + span.start];
    const to = this.map[Math.min(this.passageStart + span.end, this.passageEnd) - 1];
    if (!from || !to) return null;
    try {
      const range = this.doc.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset + 1);
      return range;
    } catch {
      return null;
    }
  }

  /** Range covering the whole current passage, used to page ahead of narration. */
  passageRange(): Range | null {
    if (this.passageStart < 0) return null;
    return this.rangeFor({ start: 0, end: this.passageEnd - this.passageStart });
  }



  /** Paint the current word (and dim the rest of the passage) if supported. */
  paint(span: { start: number; end: number } | null): Range | null {
    const doc = this.doc;
    const win = doc?.defaultView as (Window & typeof globalThis) | null | undefined;
    const highlights = (win?.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)
      ?.highlights;
    const Ctor = (win as unknown as { Highlight?: new (...ranges: Range[]) => unknown } | undefined)
      ?.Highlight;
    const range = span ? this.rangeFor(span) : null;
    if (!highlights || !Ctor) return range;
    try {
      if (!range) {
        highlights.delete("aurum-spoken");
        highlights.delete("aurum-passage");
        return null;
      }
      highlights.set("aurum-spoken", new Ctor(range));
      const passageRange = this.rangeFor({
        start: 0,
        end: this.passageEnd - this.passageStart,
      });
      if (passageRange) highlights.set("aurum-passage", new Ctor(passageRange));
    } catch {
      /* highlight API unavailable in this document */
    }
    return range;
  }

  clear() {
    const win = this.doc?.defaultView as unknown as
      | { CSS?: { highlights?: Map<string, unknown> } }
      | undefined;
    try {
      win?.CSS?.highlights?.delete("aurum-spoken");
      win?.CSS?.highlights?.delete("aurum-passage");
    } catch {
      /* ignore */
    }
  }
}
