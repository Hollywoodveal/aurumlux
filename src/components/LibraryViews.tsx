import { Check } from "lucide-react";
import { BookSpine } from "@/components/BookSpine";
import { CoverImage } from "@/components/CoverImage";
import { StarRating } from "@/components/StarRating";
import type { BookMeta } from "@/lib/db";
import { cn } from "@/lib/utils";

export type ViewMode = "spine" | "grid" | "list" | "compact";

export type ShelfProps = {
  books: BookMeta[];
  onSelect: (b: BookMeta) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
};

function SelectMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border",
        selected ? "border-gold bg-gold text-background" : "border-gold/50 text-transparent",
      )}
    >
      <Check className="size-3.5" />
    </span>
  );
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function SpineShelf({ books, onSelect, selectable, selectedIds }: ShelfProps) {
  return (
    <div className="space-y-5">
      {chunk(books, 12).map((row, i) => (
        <div key={i} className="rounded-xl shelf-plank px-3 pt-4">
          <div className="no-scrollbar flex items-end gap-[3px] overflow-x-auto pb-3">
            {row.map((book) => (
              <BookSpine
                key={book.id}
                book={book}
                onSelect={onSelect}
                selectable={selectable ?? false}
                selected={selectedIds?.has(book.id) ?? false}
              />
            ))}
          </div>
          <div className="-mx-3 h-2 rounded-b-xl bg-gradient-gold opacity-60" />
        </div>
      ))}
    </div>
  );
}

export function GridShelf({ books, onSelect, selectable, selectedIds }: ShelfProps) {
  return (
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
      {books.map((book) => (
        <button
          key={book.id}
          type="button"
          onClick={() => onSelect(book)}
          className="group relative text-left"
        >
          <div
            className={cn(
              "aspect-[2/3] overflow-hidden rounded-md shadow-lux transition-transform duration-300 group-active:scale-[0.97]",
              selectable && selectedIds?.has(book.id)
                ? "ring-2 ring-gold"
                : "hairline-gold",
            )}
          >
            <CoverImage book={book} />
          </div>
          {selectable ? (
            <span className="absolute left-1.5 top-1.5 rounded-full bg-background/80 p-0.5">
              <SelectMark selected={selectedIds?.has(book.id) ?? false} />
            </span>
          ) : null}
          <p className="mt-2 line-clamp-2 font-display text-sm leading-tight text-ivory">
            {book.title}
          </p>
          <p className="line-clamp-1 text-[11px] text-muted-foreground">{book.author}</p>
        </button>
      ))}
    </div>
  );
}

export function ListShelf({ books, onSelect, selectable, selectedIds }: ShelfProps) {
  return (
    <ul className="divide-y divide-border/60">
      {books.map((book) => (
        <li key={book.id}>
          <button
            type="button"
            onClick={() => onSelect(book)}
            className="flex w-full items-center gap-3 py-3 text-left"
          >
            {selectable ? <SelectMark selected={selectedIds?.has(book.id) ?? false} /> : null}
            <div className="h-16 w-11 shrink-0 overflow-hidden rounded hairline-gold">
              <CoverImage book={book} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base text-ivory">{book.title}</p>
              <p className="truncate text-xs text-muted-foreground">{book.author}</p>
              {/* Read-only: the whole row is already a button, so no nested controls. */}
              {book.rating ? <StarRating value={book.rating} size="sm" className="mt-1" /> : null}
              <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded bg-secondary">
                <div className="h-full bg-gradient-gold" style={{ width: `${book.progress}%` }} />
              </div>
            </div>
            <span className="text-[10px] uppercase tracking-widest text-gold/70">
              {book.format}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CompactShelf({ books, onSelect, selectable, selectedIds }: ShelfProps) {
  return (
    <div className="space-y-4">
      {chunk(books, 12).map((row, i) => (
        <div key={i} className="rounded-lg shelf-plank px-2 pt-3">
          <div className="no-scrollbar flex items-end gap-1 overflow-x-auto pb-2">
            {row.map((book) => (
              <BookSpine
                key={book.id}
                book={book}
                onSelect={onSelect}
                height={104}
                selectable={selectable ?? false}
                selected={selectedIds?.has(book.id) ?? false}
              />
            ))}
          </div>
          <div className="-mx-2 h-1.5 rounded-b-lg bg-gradient-gold opacity-50" />
        </div>
      ))}
    </div>
  );
}

export function ViewSwitcher({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const options: { value: ViewMode; label: string }[] = [
    { value: "spine", label: "Shelf" },
    { value: "grid", label: "Grid" },
    { value: "list", label: "List" },
    { value: "compact", label: "Compact" },
  ];
  return (
    <div className="flex rounded-full border border-gold/25 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.12em] transition-colors",
            value === o.value ? "bg-gold/15 text-gold" : "text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
