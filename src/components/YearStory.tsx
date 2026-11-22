import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { shareOrDownload } from "@/lib/export-notes";
import { cn } from "@/lib/utils";

export type YearRecap = {
  year: number;
  finished: number;
  pages: number;
  minutes: number;
  activeDays: number;
  topGenre: string | null;
  topAuthor: string | null;
  bestMonth: string | null;
};

export type StoryCard = { eyebrow: string; big: string; line: string };

function hours(minutes: number) {
  return minutes >= 120
    ? `${Math.round(minutes / 60)} hours`
    : `${minutes} minutes`;
}

/** The cards for a year, skipping any with nothing to say. */
export function storyCards(r: YearRecap): StoryCard[] {
  const cards: StoryCard[] = [
    {
      eyebrow: "Aurum",
      big: String(r.year),
      line: "Your year in reading",
    },
  ];
  if (r.finished > 0)
    cards.push({
      eyebrow: "Books finished",
      big: String(r.finished),
      line:
        r.pages > 0
          ? `${r.pages.toLocaleString()} pages turned`
          : r.finished === 1
            ? "One more on the shelf"
            : "Every one on the shelf",
    });
  if (r.minutes > 0)
    cards.push({
      eyebrow: "Time reading",
      big: hours(r.minutes),
      line: `across ${r.activeDays} reading day${r.activeDays === 1 ? "" : "s"}`,
    });
  if (r.topAuthor)
    cards.push({
      eyebrow: "Your author of the year",
      big: r.topAuthor,
      line: r.topGenre ? `and a lot of ${r.topGenre}` : "Most finished",
    });
  if (r.bestMonth)
    cards.push({
      eyebrow: "Biggest month",
      big: r.bestMonth,
      line: "when the pages flew",
    });
  cards.push({
    eyebrow: "Where every page is treasured",
    big: "Here's to the next chapter",
    line: `Aurum · ${r.year}`,
  });
  return cards;
}

/** Wrap text to fit maxWidth on a canvas; returns the lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function renderCard(card: StoryCard): Promise<Blob> {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  await Promise.all([
    document.fonts.load('600 160px "Cormorant Garamond"'),
    document.fonts.load('400 40px "Jost"'),
  ]).catch(() => undefined);

  ctx.fillStyle = "#0b0b0a";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(
    W / 2,
    H * 0.42,
    40,
    W / 2,
    H * 0.42,
    W * 0.9,
  );
  glow.addColorStop(0, "rgba(214,178,92,0.28)");
  glow.addColorStop(1, "rgba(214,178,92,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(214,178,92,0.45)";
  ctx.lineWidth = 3;
  ctx.strokeRect(60, 60, W - 120, H - 120);

  const gold = ctx.createLinearGradient(0, H * 0.3, W, H * 0.6);
  gold.addColorStop(0, "#f3dc9a");
  gold.addColorStop(0.55, "#d6b25c");
  gold.addColorStop(1, "#a8823a");

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(214,178,92,0.85)";
  ctx.font = '400 40px "Jost", sans-serif';
  ctx.fillText(card.eyebrow.toUpperCase().split("").join(" "), W / 2, H * 0.3);

  let size = 220;
  ctx.font = `600 ${size}px "Cormorant Garamond", serif`;
  let lines = wrap(ctx, card.big, W - 220);
  while ((lines.length > 3 || size * lines.length > 700) && size > 90) {
    size -= 10;
    ctx.font = `600 ${size}px "Cormorant Garamond", serif`;
    lines = wrap(ctx, card.big, W - 220);
  }
  ctx.fillStyle = gold;
  const top = H * 0.48 - ((lines.length - 1) * size * 1.05) / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * size * 1.05));

  ctx.fillStyle = "#efe6d2";
  ctx.font = '400 54px "Jost", sans-serif';
  wrap(ctx, card.line, W - 240).forEach((l, i) =>
    ctx.fillText(l, W / 2, top + lines.length * size * 1.05 + 40 + i * 70),
  );

  ctx.fillStyle = "rgba(214,178,92,0.7)";
  ctx.font = '600 64px "Cormorant Garamond", serif';
  ctx.fillText("Aurum", W / 2, H - 160);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("No image"))),
      "image/png",
    ),
  );
}

/** Full-screen, swipeable year-in-review with a save-as-image button per card. */
export function YearStory({
  recap,
  onClose,
}: {
  recap: YearRecap;
  onClose: () => void;
}) {
  const cards = storyCards(recap);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const track = useRef<HTMLDivElement>(null);

  const go = (i: number) => {
    const next = Math.max(0, Math.min(cards.length - 1, i));
    track.current?.children[next]?.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  };

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () =>
      setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener("scroll", onScroll, { passive: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const save = async () => {
    const card = cards[index];
    if (!card || saving) return;
    setSaving(true);
    try {
      const blob = await renderCard(card);
      await shareOrDownload(
        blob,
        `aurum-${recap.year}-${index + 1}.png`,
        "image/png",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Your ${recap.year} in reading`}
      className="fixed inset-0 z-[60] flex flex-col bg-background"
    >
      <div className="flex gap-1 px-safe pt-safe">
        {cards.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= index ? "bg-gradient-gold" : "bg-secondary",
            )}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-[calc(env(safe-area-inset-top,0px)+1.25rem)] z-10 text-muted-foreground"
      >
        <X className="size-6" />
      </button>

      <div
        ref={track}
        className="no-scrollbar flex flex-1 snap-x snap-mandatory overflow-x-auto"
      >
        {cards.map((card, i) => (
          <section
            key={i}
            aria-label={`${i + 1} of ${cards.length}`}
            className="relative flex w-full shrink-0 snap-start flex-col items-center justify-center px-8 text-center"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(70% 45% at 50% 42%, oklch(0.82 0.132 87 / 18%), transparent 70%)",
              }}
            />
            <p className="relative text-[11px] uppercase tracking-[0.3em] text-gold/80">
              {card.eyebrow}
            </p>
            <p
              className={cn(
                "relative mt-4 font-display leading-none text-gradient-gold",
                card.big.length > 14 ? "text-5xl" : "text-7xl",
              )}
            >
              {card.big}
            </p>
            <p className="relative mt-5 text-lg text-ivory/90">{card.line}</p>
          </section>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 px-safe pb-safe pt-2">
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label="Previous card"
          className="icon-btn disabled:opacity-30"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-gold px-5 text-sm font-medium text-primary-foreground"
        >
          <Download className="size-4" aria-hidden />
          {saving ? "Saving…" : "Save image"}
        </button>
        <button
          type="button"
          onClick={() => go(index + 1)}
          disabled={index === cards.length - 1}
          aria-label="Next card"
          className="icon-btn disabled:opacity-30"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
    </div>
  );
}
