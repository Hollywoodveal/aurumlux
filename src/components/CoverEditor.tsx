import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { putCover, type BookMeta } from "@/lib/db";
import { useBookMutations } from "@/hooks/useLibrary";

const BOX_W = 240;
const BOX_H = 360;
const OUT_W = 700;
const OUT_H = 1050;

type Loaded = { url: string; el: HTMLImageElement };

export function CoverEditor({
  book,
  open,
  onOpenChange,
}: {
  book: BookMeta;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { save } = useBookMutations();
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const [img, setImg] = useState<Loaded | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setImg((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [open]);

  function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file");
      return;
    }
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      setImg((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, el };
      });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("That image could not be read");
    };
    el.src = url;
  }

  const base = img ? Math.max(BOX_W / img.el.naturalWidth, BOX_H / img.el.naturalHeight) : 1;
  const drawW = img ? img.el.naturalWidth * base * zoom : 0;
  const drawH = img ? img.el.naturalHeight * base * zoom : 0;

  function clamp(next: { x: number; y: number }) {
    const maxX = Math.max(0, (drawW - BOX_W) / 2);
    const maxY = Math.max(0, (drawH - BOX_H) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  useEffect(() => {
    setOffset((o) => clamp(o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, img]);

  function onPointerDown(e: React.PointerEvent) {
    if (!img) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clamp({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
  }

  async function commit() {
    if (!img) return;
    setSaving(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      const k = OUT_W / BOX_W;
      ctx.fillStyle = "#0b0b0b";
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.drawImage(
        img.el,
        (BOX_W / 2 + offset.x - drawW / 2) * k,
        (BOX_H / 2 + offset.y - drawH / 2) * k,
        drawW * k,
        drawH * k,
      );
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("encode failed");
      await putCover(book.id, blob);
      await save.mutateAsync({ id: book.id, patch: { hasCover: true } });
      toast.success("Cover updated");
      onOpenChange(false);
      window.location.reload();
    } catch {
      toast.error("Could not save that cover");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto border-gold/25 bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-gold">Cover image</DialogTitle>
          <DialogDescription>
            Choose a photo, then drag to reposition and pinch or slide to zoom.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 border-gold/30 text-xs"
            onClick={() => pickRef.current?.click()}
          >
            <ImagePlus className="size-4" />
            Choose photo
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-gold/30 text-xs"
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="size-4" />
            Take photo
          </Button>
        </div>
        <input
          ref={pickRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />

        <div className="flex justify-center">
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (dragRef.current = null)}
            onPointerCancel={() => (dragRef.current = null)}
            style={{ width: BOX_W, height: BOX_H }}
            className="relative touch-none select-none overflow-hidden rounded-md hairline-gold bg-secondary/50"
          >
            {img ? (
              <img
                src={img.url}
                alt=""
                aria-hidden
                draggable={false}
                className="absolute left-1/2 top-1/2 max-w-none"
                style={{
                  width: drawW,
                  height: drawH,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                }}
              />
            ) : (
              <p className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
                No image selected yet
              </p>
            )}
            <span aria-hidden className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-gold/25" />
          </div>
        </div>

        {img ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Zoom
              </span>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setOffset({ x: 0, y: 0 });
                }}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-gold/80"
              >
                <RotateCcw className="size-3" />
                Reset
              </button>
            </div>
            <Slider
              min={1}
              max={3}
              step={0.02}
              value={[zoom]}
              onValueChange={([v]) => setZoom(v ?? 1)}
              aria-label="Zoom cover"
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-gradient-gold text-primary-foreground"
            disabled={!img || saving}
            onClick={() => void commit()}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save cover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
