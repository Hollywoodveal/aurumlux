import { useEffect, useState } from "react";
import { BookOpen, CheckCheck, Hand, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { useOnboarding } from "@/hooks/useOnboarding";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    icon: Sparkles,
    title: "Welcome to Aurum",
    body: "Your private, offline library. No account, no ads, no analytics — and online lookups stay off unless you turn them on.",
  },
  {
    icon: BookOpen,
    title: "Fill your shelf",
    body: "Tap Import to add EPUB, PDF, CBZ or TXT files. Covers, titles and page counts are detected automatically.",
  },
  {
    icon: Hand,
    title: "Browse and organise",
    body: "Tap a spine to open its details. Switch between Shelf, Grid, List and Compact views, and use the shelves to filter what you're reading.",
  },
  {
    icon: CheckCheck,
    title: "Select mode",
    body: "Tap Select to pick several books at once, then delete them or recalculate their page counts in one go.",
  },
  {
    icon: BookOpen,
    title: "In the reader",
    body: "Tap the edges to turn pages, tap the middle for controls, and use Read aloud for lifelike narration. Your progress, goals and streaks update as you read.",
  },
];

export function Onboarding() {
  const { seen, loaded, complete } = useOnboarding();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!seen) setStep(0);
  }, [seen]);

  if (!loaded || seen) return null;

  const current = STEPS[step]!;
  const Icon = current.icon;
  const last = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Getting started with Aurum"
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-4 pb-safe backdrop-blur-sm sm:items-center"
    >
      <div className="w-full max-w-sm rounded-2xl border border-gold/25 bg-card p-6 shadow-lux">
        <div className="flex items-start justify-between">
          {step === 0 ? (
            <BrandMark size={52} label="Aurum logo" />
          ) : (
            <span className="flex size-11 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-gold">
              <Icon className="size-5" />
            </span>
          )}
          <button
            type="button"
            onClick={complete}
            aria-label="Skip the tour"
            className="rounded-full p-2 text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <h2 className="mt-4 font-display text-2xl text-gradient-gold">
          {current.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {current.body}
        </p>

        <div className="mt-6 flex items-center gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s.title + i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= step ? "bg-gradient-gold" : "bg-secondary",
              )}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <Button variant="ghost" className="text-xs" onClick={complete}>
            Skip
          </Button>
          <div className="flex gap-2">
            {step > 0 ? (
              <Button
                variant="outline"
                className="border-gold/30 text-xs"
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </Button>
            ) : null}
            <Button
              className="bg-gradient-gold text-xs text-primary-foreground"
              onClick={() => (last ? complete() : setStep((s) => s + 1))}
            >
              {last ? "Start reading" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
