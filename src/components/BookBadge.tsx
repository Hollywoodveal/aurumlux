import { createContext, useContext } from "react";
import type { BookMeta } from "@/lib/db";
import { cn } from "@/lib/utils";

const NEW_FOR_MS = 7 * 86_400_000;

export type BookStatus = "missing" | "new" | null;

/** Ids of books whose file isn't on this device (null while loading). */
export const MissingFilesContext = createContext<Set<string> | null>(null);

export function bookStatus(
  book: BookMeta,
  missing: Set<string> | null,
  now = Date.now(),
): BookStatus {
  if (missing?.has(book.id)) return "missing";
  if (
    !book.lastOpened &&
    book.progress === 0 &&
    now - book.addedAt < NEW_FOR_MS
  )
    return "new";
  return null;
}

export function useBookStatus(book: BookMeta): BookStatus {
  return bookStatus(book, useContext(MissingFilesContext));
}

const LABEL: Record<Exclude<BookStatus, null>, string> = {
  missing: "Waiting for file",
  new: "New",
};

/** Small status pill: "Waiting for file" for synced placeholders, "New" for fresh imports. */
export function BookBadge({
  book,
  className,
  compact = false,
}: {
  book: BookMeta;
  className?: string;
  /** Dot-only version for narrow spines. */
  compact?: boolean;
}) {
  const status = useBookStatus(book);
  if (!status) return null;
  if (compact) {
    return (
      <span
        aria-hidden
        title={LABEL[status]}
        className={cn(
          "absolute left-1/2 top-1 size-2 -translate-x-1/2 rounded-full ring-1 ring-black/60",
          status === "missing"
            ? "bg-[oklch(0.75_0.02_80)]"
            : "bg-[oklch(0.82_0.132_87)]",
          className,
        )}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em]",
        status === "missing"
          ? "border border-gold/30 bg-background/85 text-muted-foreground"
          : "bg-gradient-gold text-primary-foreground",
        className,
      )}
    >
      {LABEL[status]}
    </span>
  );
}

/** Text appended to accessible names so screen readers hear the status too. */
export function statusSuffix(status: BookStatus) {
  return status ? ` (${LABEL[status]})` : "";
}
