import { cn } from "@/lib/utils";

/**
 * The Aurum mark — the gold open-book emblem. Decorative next to the wordmark,
 * so it carries no alt text; give it a label only when it stands alone.
 */
export function BrandMark({
  size = 44,
  label,
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <img
      src="/icon-192.png"
      alt={label ?? ""}
      width={size}
      height={size}
      draggable={false}
      className={cn("rounded-[22%] select-none", className)}
      style={{ width: size, height: size }}
    />
  );
}
