import { Check } from "lucide-react";
import { useCoverUrl } from "@/hooks/useLibrary";
import type { BookMeta } from "@/lib/db";
import { cn } from "@/lib/utils";

export function spineWidth(book: BookMeta) {
  const basis = book.pageCount > 0 ? book.pageCount : Math.round(book.fileSize / 2200);
  return Math.round(Math.min(52, Math.max(28, 28 + basis / 26)));
}

export function BookSpine({
  book,
  onSelect,
  height = 208,
  selectable = false,
  selected = false,
}: {
  book: BookMeta;
  onSelect: (book: BookMeta) => void;
  height?: number;
  selectable?: boolean;
  selected?: boolean;
}) {
  const url = useCoverUrl(book);
  const width = spineWidth(book);
  const compact = height < 160 || width < 34;

  return (
    <button
      type="button"
      onClick={() => onSelect(book)}
      aria-label={`${book.title} by ${book.author}`}
      aria-pressed={selectable ? selected : undefined}
      className={cn(
        "group relative shrink-0 overflow-hidden rounded-[2px] transition-transform duration-300 will-change-transform hover:-translate-y-2 focus-visible:-translate-y-2 focus-visible:outline-none active:-translate-y-1",
        selectable && selected && "-translate-y-2",
      )}
      style={{
        width,
        height,
        boxShadow: selected
          ? "0 0 0 1.5px oklch(0.88 0.14 87), 0 14px 22px -14px oklch(0 0 0 / 85%)"
          : "0 14px 22px -14px oklch(0 0 0 / 85%), inset -2px 0 6px -3px oklch(0 0 0 / 60%), inset 1px 0 0 oklch(0.82 0.132 87 / 26%), inset -1px 0 0 oklch(0 0 0 / 45%)",
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 h-full w-full scale-105 object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, oklch(0.14 0.008 70), oklch(0.24 0.018 75) 40%, oklch(0.12 0.008 70))",
          }}
        />
      )}
      {/* Soft cylindrical shading + a legibility scrim, no hard boxes. */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, oklch(0 0 0 / 62%), oklch(0 0 0 / 6%) 34%, oklch(0.98 0 0 / 6%) 48%, oklch(0 0 0 / 22%) 66%, oklch(0 0 0 / 68%))",
        }}
      />
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 bottom-0"
        style={{
          background:
            "linear-gradient(180deg, oklch(0 0 0 / 55%), oklch(0 0 0 / 30%) 22%, oklch(0 0 0 / 30%) 78%, oklch(0 0 0 / 60%))",
        }}
      />

      {/* Thin gold foil rules, like a bound hardback. The spine stays dark in
          every theme, so the foil uses a fixed gold instead of the theme-aware
          token (which turns dark in light/sepia mode). */}
      <span
        aria-hidden
        className="absolute inset-x-[3px] top-2.5 h-px"
        style={{ background: "oklch(0.82 0.132 87 / 45%)" }}
      />
      <span
        aria-hidden
        className="absolute inset-x-[3px] bottom-2.5 h-px"
        style={{ background: "oklch(0.82 0.132 87 / 35%)" }}
      />

      <span className="absolute inset-0 flex items-center justify-center px-[2px] py-6">
        <span
          className="flex max-h-full items-center gap-2 overflow-hidden"
          style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
        >
          <span
            className={cn(
              "font-display font-medium leading-none tracking-[0.06em]",
              compact ? "text-[10.5px]" : "text-[12.5px]",
            )}
            // The spine is always dark (cover art under black scrims), so the
            // title stays near-white in every theme. The theme-aware `ivory`
            // token inverts to dark in light/sepia mode and would disappear
            // into the spine.
            style={{
              color: "oklch(0.96 0.015 88 / 96%)",
              textShadow: "0 1px 3px oklch(0 0 0 / 90%)",
            }}
          >
            {book.title}
          </span>
        </span>
      </span>


      {selectable ? (
        <span
          aria-hidden
          className={cn(
            "absolute right-0.5 top-0.5 flex size-3.5 items-center justify-center rounded-full border",
            selected
              ? "border-gold bg-gold text-background"
              : "border-gold/60 bg-background/80 text-transparent",
          )}
        >
          <Check className="size-2.5" />
        </span>
      ) : null}

      {book.progress > 0 && book.progress < 100 ? (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-[3px] bg-gradient-gold"
          style={{ width: `${book.progress}%` }}
        />
      ) : null}
    </button>
  );
}
