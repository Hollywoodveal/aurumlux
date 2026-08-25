import { useEffect, useState } from "react";
import { Loader2, Volume2, X } from "lucide-react";

type Entry = {
  word: string;
  phonetic?: string;
  meanings: {
    partOfSpeech: string;
    definitions: { definition: string; example?: string }[];
    synonyms?: string[];
  }[];
};

/**
 * Looks a selected word up in the free dictionary API and offers a translation
 * link. Read-only, no key, and it fails softly when offline.
 */
export function DictionarySheet({ word, onClose }: { word: string; onClose: () => void }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const term = word.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");

  useEffect(() => {
    let alive = true;
    setEntry(null);
    setError(null);
    if (!term) {
      setError("Select a word to look up.");
      return;
    }
    void (async () => {
      try {
        const res = await fetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term.toLowerCase())}`,
        );
        if (!res.ok) throw new Error("not found");
        const data = (await res.json()) as Entry[];
        if (alive) setEntry(data[0] ?? null);
      } catch {
        if (alive)
          setError(
            navigator.onLine
              ? `No dictionary entry for "${term}".`
              : "You're offline — definitions need a connection.",
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [term]);

  const speak = () => {
    if (!("speechSynthesis" in window) || !term) return;
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(term));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end">
      <button aria-label="Close dictionary" onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div className="pb-safe px-safe-sm relative max-h-[70svh] w-full overflow-y-auto rounded-t-2xl border-t border-gold/25 bg-card pt-4">
        <div className="flex items-start justify-between gap-3 px-4">
          <div>
            <h2 className="font-display text-2xl text-ivory">{term || "Dictionary"}</h2>
            {entry?.phonetic ? (
              <p className="text-xs tracking-wide text-gold/70">{entry.phonetic}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={speak}
              aria-label="Pronounce word"
              className="flex size-11 items-center justify-center rounded-full border border-gold/25 text-gold"
            >
              <Volume2 className="size-4" />
            </button>
            <button
              onClick={onClose}
              aria-label="Close dictionary"
              className="flex size-11 items-center justify-center rounded-full border border-gold/25 text-gold"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 px-4 pb-5">
          {!entry && !error ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Looking it up…
            </p>
          ) : null}

          {error ? <p className="py-4 text-sm text-muted-foreground">{error}</p> : null}

          {entry?.meanings.slice(0, 4).map((meaning, i) => (
            <section key={`${meaning.partOfSpeech}-${i}`} className="border-t border-border/60 py-3 first:border-0">
              <h3 className="text-[11px] uppercase tracking-[0.2em] text-gold/70">
                {meaning.partOfSpeech}
              </h3>
              <ol className="mt-1.5 space-y-2">
                {meaning.definitions.slice(0, 3).map((def, j) => (
                  <li key={j} className="text-sm leading-relaxed text-foreground">
                    {def.definition}
                    {def.example ? (
                      <span className="mt-0.5 block text-xs italic text-muted-foreground">
                        “{def.example}”
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
              {meaning.synonyms && meaning.synonyms.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="text-gold/60">Synonyms · </span>
                  {meaning.synonyms.slice(0, 6).join(", ")}
                </p>
              ) : null}
            </section>
          ))}

          {term ? (
            <a
              href={`https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(term)}&op=translate`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex min-h-11 items-center rounded-full border border-gold/30 px-4 text-xs uppercase tracking-[0.12em] text-gold"
            >
              Translate this word
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
