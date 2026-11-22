import { Link, useRouterState } from "@tanstack/react-router";
import { BarChart3, Library, NotebookPen, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Library", icon: Library },
  { to: "/notes", label: "Notes", icon: NotebookPen },
  { to: "/stats", label: "Stats", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export const TAB_ROUTES: readonly string[] = TABS.map((t) => t.to);

/** Height the bar takes, so pages can leave room for it. */
export const TAB_BAR_SPACE = "calc(4.25rem + env(safe-area-inset-bottom, 0px))";

/**
 * App-style tab bar for the main screens, with a gold indicator that slides
 * to the active tab. Hidden in the reader.
 */
export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = TABS.findIndex((t) => t.to === pathname);
  if (active < 0) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gold/15 bg-background/90 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-lg"
    >
      <div className="relative mx-auto flex max-w-md">
        <span
          aria-hidden
          className="absolute top-0 h-[2px] w-1/4 rounded-full bg-gradient-gold shadow-gold transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${active * 100}%)` }}
        />
        {TABS.map((tab, i) => {
          const Icon = tab.icon;
          const current = i === active;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-[4.25rem] flex-1 flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-[0.14em] transition-colors",
                current ? "text-gold" : "text-muted-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-5 transition-transform duration-300",
                  current && "-translate-y-0.5",
                )}
                aria-hidden
              />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Empty space at the end of a page so the tab bar never covers content. */
export function TabBarSpacer() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!TAB_ROUTES.includes(pathname)) return null;
  return <div aria-hidden style={{ height: TAB_BAR_SPACE }} />;
}
