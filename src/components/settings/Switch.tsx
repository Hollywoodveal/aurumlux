import { cn } from "@/lib/utils";

/** A labeled toggle switch. State is driven by `checked` via aria-checked. */
export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("switch", className)}
    >
      <span className="switch-thumb" aria-hidden />
    </button>
  );
}
