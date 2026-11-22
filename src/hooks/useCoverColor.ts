import { useEffect, useState } from "react";
import { useCoverUrl } from "@/hooks/useLibrary";
import type { BookMeta } from "@/lib/db";

const cache = new Map<string, string | null>();

/**
 * The cover's most characterful colour as "r g b" (for rgb(... / alpha)),
 * or null when there's no cover. Computed once per book on a tiny canvas,
 * weighting saturated mid-tones so a black border doesn't win.
 */
export function pickColor(data: Uint8ClampedArray): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i] ?? 0;
    const pg = data[i + 1] ?? 0;
    const pb = data[i + 2] ?? 0;
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    const light = (max + min) / 510;
    if (light < 0.08 || light > 0.94) continue;
    const sat = max === 0 ? 0 : (max - min) / max;
    const w = 0.15 + sat * sat * 2;
    r += pr * w;
    g += pg * w;
    b += pb * w;
    total += w;
  }
  if (total === 0) return null;
  return `${Math.round(r / total)} ${Math.round(g / total)} ${Math.round(b / total)}`;
}

export function useCoverColor(
  book: Pick<BookMeta, "id" | "hasCover"> | undefined,
): string | null {
  const url = useCoverUrl(book);
  const [color, setColor] = useState<string | null>(() =>
    book ? (cache.get(book.id) ?? null) : null,
  );

  useEffect(() => {
    if (!book || !url) {
      setColor(null);
      return;
    }
    if (cache.has(book.id)) {
      setColor(cache.get(book.id) ?? null);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 24;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 16, 24);
        const picked = pickColor(ctx.getImageData(0, 0, 16, 24).data);
        cache.set(book.id, picked);
        if (alive) setColor(picked);
      } catch {
        cache.set(book.id, null);
      }
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [book, url]);

  return color;
}
