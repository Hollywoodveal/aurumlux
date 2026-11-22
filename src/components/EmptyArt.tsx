import { cn } from "@/lib/utils";

/**
 * Gold line-art for empty screens: an empty bookshelf, a ribbon bookmark
 * over an open book, or a magnifying glass over a page.
 */
export function EmptyArt({
  variant,
  className,
}: {
  variant: "shelf" | "notes" | "search";
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 200 140"
      aria-hidden
      className={cn("mx-auto h-auto w-44 text-gold", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <radialGradient id={`glow-${variant}`} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        cx="100"
        cy="66"
        rx="96"
        ry="64"
        fill={`url(#glow-${variant})`}
        stroke="none"
      />
      {variant === "shelf" ? (
        <g>
          {/* two planks */}
          <path d="M30 62h140M30 112h140" strokeWidth="2.2" />
          <path d="M34 62v4M166 62v4M34 112v4M166 112v4" opacity="0.6" />
          {/* a few leaning spines on the top shelf */}
          <rect x="44" y="26" width="11" height="36" rx="1.5" />
          <rect x="57" y="30" width="9" height="32" rx="1.5" opacity="0.8" />
          <path d="M70 62l12-32 8 3-12 31" opacity="0.7" />
          <path d="M47 33h5M47 55h5" opacity="0.5" />
          {/* empty bottom shelf, waiting */}
          <path
            d="M96 104h0M110 104h0M124 104h0"
            strokeWidth="3"
            opacity="0.5"
          />
          {/* sparkle */}
          <path d="M150 28v10M145 33h10" opacity="0.8" />
          <path d="M132 44v5M129.5 46.5h5" opacity="0.5" />
        </g>
      ) : variant === "notes" ? (
        <g>
          <path d="M100 48c-16-9-36-10-54-6v62c18-4 38-3 54 6 16-9 36-10 54-6V42c-18-4-38-3-54 6z" />
          <path d="M100 48v62" opacity="0.7" />
          <path
            d="M58 60c10-2 22-1 32 2M58 72c10-2 22-1 32 2M58 84c10-2 22-1 32 2"
            opacity="0.45"
          />
          <path
            d="M110 62c10-3 22-4 32-2M110 74c10-3 22-4 32-2"
            opacity="0.45"
          />
          {/* ribbon bookmark */}
          <path
            d="M128 30v40l7-6 7 6V30z"
            fill="currentColor"
            fillOpacity="0.18"
          />
          <path d="M150 22v8M146 26h8" opacity="0.7" />
        </g>
      ) : (
        <g>
          <rect x="52" y="22" width="68" height="90" rx="4" />
          <path d="M64 40h44M64 52h44M64 64h30" opacity="0.45" />
          <circle cx="118" cy="84" r="20" strokeWidth="2.2" />
          <path d="M132 98l18 18" strokeWidth="3" />
          <path d="M110 78a10 10 0 0 1 8-4" opacity="0.6" />
        </g>
      )}
    </svg>
  );
}
