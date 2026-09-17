import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  isSectionCollapsed,
  setSectionCollapsed,
} from "@/lib/settings-sections";
import { cn } from "@/lib/utils";

type SettingsSectionProps = {
  /** Stable key for the collapsed-state preference. Don't reuse or rename casually. */
  id: string;
  title: string;
  /** Small gold glyph shown before the title, matching the old inline headings. */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * A Settings panel that can be folded away behind its heading.
 *
 * Renders expanded on the server and restores the saved state in a layout
 * effect, so the markup React hydrates against always matches and there is no
 * mismatch warning. The restore is flagged so the height animation doesn't run
 * on that first pass — otherwise every collapsed section would visibly slide
 * shut on load.
 */
export function SettingsSection({
  id,
  title,
  icon,
  className,
  children,
}: SettingsSectionProps) {
  const [open, setOpen] = useState(true);
  const restored = useRef(false);

  useLayoutEffect(() => {
    if (isSectionCollapsed(id)) setOpen(false);
    restored.current = true;
  }, [id]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSectionCollapsed(id, !next);
      }}
      asChild
    >
      <section
        className={cn("rounded-xl border border-gold/20 bg-card", className)}
      >
        <h2 className="font-display text-xl text-ivory">
          <CollapsibleTrigger
            className={cn(
              "flex min-h-14 w-full items-center gap-2 rounded-xl px-4 py-3 text-left",
              "outline-none focus-visible:ring-2 focus-visible:ring-gold/50",
            )}
          >
            {icon}
            <span className="flex-1">{title}</span>
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 shrink-0 text-gold transition-transform duration-200 motion-reduce:transition-none",
                open ? "rotate-0" : "-rotate-90",
              )}
            />
          </CollapsibleTrigger>
        </h2>
        <CollapsibleContent
          className={restored.current ? "settings-collapsible" : undefined}
        >
          <div className="px-4 pb-4">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
