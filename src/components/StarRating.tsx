import { useState } from "react";
import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-4",
  md: "size-5",
  lg: "size-7",
} as const;

export function StarRating({
  value,
  onChange,
  size = "md",
  className,
}: {
  /** Current rating, 0 (unrated) to 5. */
  value: number;
  /**
   * Omit to render a read-only rating. When supplied, the stars become buttons
   * and tapping the current rating again clears it back to unrated.
   */
  onChange?: (rating: number) => void;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  // Fill level shown while the pointer is over the row, so you can see the
  // rating you're about to commit before you commit it.
  const [preview, setPreview] = useState(0);
  const shown = preview || value;
  const iconSize = SIZES[size];

  if (!onChange) {
    return (
      <div
        className={cn("flex items-center gap-0.5 text-gold", className)}
        role="img"
        aria-label={value ? `Rated ${value} out of 5` : "Not rated"}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            aria-hidden
            className={cn(iconSize, n <= value ? "fill-gold" : "opacity-25")}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      onPointerLeave={() => setPreview(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={
            n === value
              ? `Clear rating (currently ${n} of 5)`
              : `Rate ${n} out of 5`
          }
          aria-pressed={n <= value}
          onPointerEnter={() => setPreview(n)}
          onFocus={() => setPreview(n)}
          onBlur={() => setPreview(0)}
          // Tapping the active rating clears it, matching the metadata editor.
          onClick={() => onChange(n === value ? 0 : n)}
          className={cn(
            "flex min-h-9 items-center justify-center rounded-md px-0.5 text-gold transition-transform",
            "hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50",
          )}
        >
          <Star
            aria-hidden
            className={cn(iconSize, n <= shown ? "fill-gold" : "opacity-25")}
          />
        </button>
      ))}
    </div>
  );
}
