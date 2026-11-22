import { useEffect, useState, type CSSProperties } from "react";
import { Sparkles } from "lucide-react";
import { announce } from "@/lib/announce";
import { CELEBRATE_EVENT, type CelebrationDetail } from "@/lib/celebrate";

type Fleck = {
  id: number;
  dx: number;
  dy: number;
  r: number;
  size: number;
  delay: number;
  hue: number;
};

function makeFlecks(): Fleck[] {
  return Array.from({ length: 42 }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 220;
    return {
      id: i,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 80,
      r: (Math.random() - 0.5) * 720,
      size: 4 + Math.random() * 7,
      delay: Math.random() * 120,
      hue: 75 + Math.random() * 20,
    };
  });
}

/** Gold flecks burst from the centre with a short message, then fade away. */
export function Celebration() {
  const [shown, setShown] = useState<{
    key: number;
    detail: CelebrationDetail;
    flecks: Fleck[];
  } | null>(null);

  useEffect(() => {
    let timer = 0;
    const onCelebrate = (e: Event) => {
      const detail = (e as CustomEvent<CelebrationDetail>).detail;
      announce(
        `${detail.title}${detail.subtitle ? `. ${detail.subtitle}` : ""}`,
      );
      setShown({ key: Date.now(), detail, flecks: makeFlecks() });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShown(null), 3200);
    };
    window.addEventListener(CELEBRATE_EVENT, onCelebrate);
    return () => {
      window.removeEventListener(CELEBRATE_EVENT, onCelebrate);
      window.clearTimeout(timer);
    };
  }, []);

  if (!shown) return null;
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      key={shown.key}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center"
    >
      {!reduceMotion
        ? shown.flecks.map((f) => (
            <span
              key={f.id}
              className="animate-fleck absolute left-1/2 top-1/2 rounded-[2px]"
              style={
                {
                  width: f.size,
                  height: f.size * 0.45,
                  background: `oklch(0.84 0.14 ${f.hue})`,
                  boxShadow: `0 0 6px oklch(0.84 0.14 ${f.hue} / 60%)`,
                  animationDelay: `${f.delay}ms`,
                  "--dx": `${f.dx}px`,
                  "--dy": `${f.dy}px`,
                  "--r": `${f.r}deg`,
                } as CSSProperties
              }
            />
          ))
        : null}
      <div className="animate-in fade-in zoom-in-95 rounded-2xl border border-gold/40 bg-card/95 px-6 py-4 text-center shadow-lux backdrop-blur">
        <Sparkles className="mx-auto size-6 text-gold" />
        <p className="mt-1 font-display text-2xl text-gradient-gold">
          {shown.detail.title}
        </p>
        {shown.detail.subtitle ? (
          <p className="mt-0.5 max-w-[16rem] text-sm text-ivory/90">
            {shown.detail.subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}
