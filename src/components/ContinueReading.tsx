import { useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { BookBadge } from "@/components/BookBadge";
import { CoverImage } from "@/components/CoverImage";
import type { BookMeta } from "@/lib/db";
import { estimateMinutesLeft, formatMinutesLeft } from "@/lib/goals";
import { prepareBookOpen } from "@/lib/transitions";
import { useCoverColor } from "@/hooks/useCoverColor";

function timeLeft(book: BookMeta) {
  const minutes = estimateMinutesLeft(book);
  return minutes === null ? null : `about ${formatMinutesLeft(minutes)} left`;
}

/**
 * The library's top card: the book you're in the middle of, big, with one tap
 * back to your page. Other books in progress follow as a smaller row.
 */
export function ContinueReading({
  books,
  onOpenDetails,
}: {
  books: BookMeta[];
  onOpenDetails: (book: BookMeta) => void;
}) {
  const navigate = useNavigate();
  const coverRef = useRef<HTMLButtonElement>(null);
  const [hero, ...rest] = books;
  const glow = useCoverColor(hero);
  if (!hero) return null;
  const left = timeLeft(hero);
  const pct = Math.round(hero.progress);

  return (
    <section className="mt-6" aria-label="Continue reading">
      <h2 className="eyebrow">Continue reading</h2>
      <div className="card relative mt-3 overflow-hidden p-4 shadow-lux">
        {/* A soft wash of the cover behind the card, kept faint for legibility. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-25"
        >
          <CoverImage book={hero} className="scale-125 blur-2xl" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-card via-card/85 to-card/60"
        />
        {glow ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(90% 120% at 10% 0%, rgb(${glow} / 0.42), transparent 65%)`,
            }}
          />
        ) : null}
        <div className="relative flex gap-4">
          <button
            ref={coverRef}
            type="button"
            onClick={() => onOpenDetails(hero)}
            aria-label={`${hero.title} ${hero.author} — details`}
            className="h-[150px] w-[100px] shrink-0 overflow-hidden rounded-md hairline-gold shadow-lux"
          >
            <CoverImage book={hero} />
          </button>
          <div className="flex min-w-0 flex-1 flex-col">
            <button
              type="button"
              onClick={() => onOpenDetails(hero)}
              className="text-left"
            >
              <p className="line-clamp-2 font-display text-xl leading-tight text-ivory">
                {hero.title}
              </p>
              <p className="mt-0.5 truncate text-sm text-gold/85">
                {hero.author || "Unknown author"}
              </p>
            </button>
            {hero.chapter ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {hero.chapter}
              </p>
            ) : null}
            <BookBadge book={hero} className="mt-1 w-fit" />
            <div className="mt-auto pt-3">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${pct}% read`}
              >
                <div
                  className="h-full bg-gradient-gold"
                  style={{ width: `${hero.progress}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                <span className="text-gold">{pct}%</span>
                {left ? ` · ${left}` : ""}
              </p>
              <button
                type="button"
                onClick={() =>
                  void navigate({
                    to: "/read/$bookId",
                    params: { bookId: hero.id },
                    viewTransition: prepareBookOpen(coverRef.current),
                  })
                }
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-gold px-5 text-sm font-medium text-primary-foreground shadow-lux"
              >
                <BookOpen className="size-4" aria-hidden />
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>

      {rest.length > 0 ? (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1">
          {rest.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onOpenDetails(b)}
              className="card flex w-56 shrink-0 gap-3 p-3 text-left"
            >
              <div className="h-[66px] w-11 shrink-0 overflow-hidden rounded hairline-gold">
                <CoverImage book={b} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-display text-sm leading-tight text-ivory">
                  {b.title}
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-gradient-gold"
                    style={{ width: `${b.progress}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-gold/70">
                  {Math.round(b.progress)}%
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
