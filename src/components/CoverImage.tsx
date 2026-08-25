import { useCoverUrl } from "@/hooks/useLibrary";
import type { BookMeta } from "@/lib/db";
import { cn } from "@/lib/utils";

export function CoverImage({
  book,
  className,
}: {
  book: BookMeta;
  className?: string;
}) {
  const url = useCoverUrl(book);
  if (url) {
    return (
      <img
        src={url}
        alt={`Cover of ${book.title}`}
        loading="lazy"
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-1 bg-secondary px-2 text-center",
        className,
      )}
    >
      <span className="font-display text-[0.7rem] leading-tight text-gold">{book.title}</span>
      <span className="text-[0.55rem] text-muted-foreground">{book.author}</span>
    </div>
  );
}
