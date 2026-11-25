import { useEffect, useState } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import type { BookMeta } from "@/lib/db";
import {
  aiStatus,
  askBook,
  recap,
  whoIsWho,
  type AiStatus,
  type Character,
} from "@/lib/intelligence";

export type AssistantTab = "recap" | "who" | "ask";

const TABS: { id: AssistantTab; label: string }[] = [
  { id: "recap", label: "Recap" },
  { id: "who", label: "Who's who" },
  { id: "ask", label: "Ask" },
];

/** Answers are kept per book and position for this visit. */
const cache = new Map<string, unknown>();

/**
 * Reading help from Apple Intelligence, on the device: a recap of where you
 * are, who's who so far, and questions about the book. Only uses text before
 * your current page, so it never spoils what's ahead.
 */
export function ReadingAssistant({
  book,
  getFraction,
  initialTab = "recap",
  onClose,
}: {
  book: BookMeta;
  /** How far through the book the reader is, 0–1. */
  getFraction: () => number;
  initialTab?: AssistantTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<AssistantTab>(initialTab);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recapText, setRecapText] = useState<string | null>(null);
  const [people, setPeople] = useState<Character[] | null>(null);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const fraction = getFraction();
  // Reuse answers until the reader has moved on about a page or two.
  const spot = `${book.id}:${Math.round(fraction * 400)}`;

  useEffect(() => {
    void aiStatus().then(setStatus);
  }, []);

  const run = async <T,>(key: string, work: () => Promise<T>) => {
    if (cache.has(key)) return cache.get(key) as T;
    setBusy(true);
    setError(null);
    try {
      const value = await work();
      cache.set(key, value);
      return value;
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Apple Intelligence couldn't answer that. Try again.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!status?.available) return;
    if (tab === "recap" && recapText === null)
      void run(`recap:${spot}`, () => recap(book, fraction)).then(
        (t) => t !== null && setRecapText(t),
      );
    if (tab === "who" && people === null)
      void run(`who:${spot}`, () => whoIsWho(book, fraction)).then(
        (p) => p !== null && setPeople(p),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status?.available]);

  async function submit() {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    const a = await run(`ask:${spot}:${q}`, () => askBook(book, fraction, q));
    if (a !== null) setAnswers((list) => [...list, { q, a }]);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <button
        aria-label="Close reading assistant"
        onClick={onClose}
        className="absolute inset-0 bg-scrim"
      />
      <div
        role="dialog"
        aria-label="Reading assistant"
        className="pb-safe px-safe-sm relative flex max-h-[75svh] w-full flex-col rounded-t-2xl border-t border-gold/25 bg-card pt-4"
      >
        <div className="flex items-center justify-between gap-3 px-4">
          <h2 className="flex items-center gap-2 font-display text-xl text-ivory">
            <Sparkles className="size-4 text-gold" aria-hidden />
            {book.title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 items-center justify-center text-gold"
          >
            <X className="size-5" />
          </button>
        </div>

        <div role="tablist" className="segmented mx-4 mt-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className="flex-1"
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-3 min-h-40 flex-1 overflow-y-auto px-4 pb-4 text-sm leading-relaxed text-ivory/90">
          {status && !status.available ? (
            <p className="text-muted-foreground">{status.reason}</p>
          ) : null}

          {status?.available && tab === "recap" ? (
            recapText ? (
              <p className="whitespace-pre-line">{recapText}</p>
            ) : null
          ) : null}

          {status?.available && tab === "who" ? (
            people && people.length === 0 ? (
              <p className="text-muted-foreground">
                No names stand out yet. Read a little further and try again.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {(people ?? []).map((p) => (
                  <li key={p.name}>
                    <span className="font-medium text-gold">{p.name}</span>
                    <span className="text-muted-foreground"> — </span>
                    {p.about}
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {status?.available && tab === "ask" ? (
            <div className="space-y-3">
              {answers.length === 0 && !busy ? (
                <p className="text-muted-foreground">
                  Ask about anything you&apos;ve read so far — &ldquo;Who is Mr.
                  Wickham?&rdquo;, &ldquo;Why did they leave London?&rdquo;
                </p>
              ) : null}
              {answers.map((x, i) => (
                <div key={i}>
                  <p className="text-xs uppercase tracking-widest text-gold/70">
                    {x.q}
                  </p>
                  <p className="mt-1 whitespace-pre-line">{x.a}</p>
                </div>
              ))}
            </div>
          ) : null}

          {busy ? (
            <p className="mt-3 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Thinking on your iPhone…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        {status?.available && tab === "ask" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="flex items-center gap-2 border-t border-gold/15 px-4 py-3"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about the book so far"
              aria-label="Question about the book"
              className="min-h-11 flex-1 rounded-full border border-gold/20 bg-secondary/60 px-4 text-sm outline-none focus:border-gold/50"
            />
            <button
              type="submit"
              disabled={busy || !question.trim()}
              aria-label="Ask"
              className="flex size-11 items-center justify-center rounded-full border border-gold/30 text-gold disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </form>
        ) : null}

        <p className="px-4 pb-2 text-[10px] text-muted-foreground">
          Apple Intelligence on this iPhone · only what you&apos;ve read so far
          · answers can be wrong
        </p>
      </div>
    </div>
  );
}
