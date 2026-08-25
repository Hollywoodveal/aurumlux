import { useEffect, useState } from "react";
import {
  Calculator,
  ImagePlus,
  Loader2,
  Lock,
  LockOpen,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CoverEditor } from "@/components/CoverEditor";
import { type BookMeta } from "@/lib/db";
import { useBookMutations } from "@/hooks/useLibrary";
import { recountPages, refetchCover, refetchMetadata } from "@/lib/importer";
import { cn } from "@/lib/utils";


const FIELDS: { key: keyof BookMeta; label: string; area?: boolean; numeric?: boolean }[] = [
  { key: "title", label: "Title" },
  { key: "subtitle", label: "Subtitle" },
  { key: "author", label: "Author" },
  { key: "series", label: "Series" },
  { key: "seriesIndex", label: "Series number", numeric: true },
  { key: "genre", label: "Genre" },
  { key: "publisher", label: "Publisher" },
  { key: "isbn", label: "ISBN" },
  { key: "language", label: "Language" },
  { key: "publishedDate", label: "Published" },
  { key: "pageCount", label: "Page count", numeric: true },
  { key: "description", label: "Description", area: true },
  { key: "notes", label: "Personal notes", area: true },
];

export function MetadataDialog({
  book,
  open,
  onOpenChange,
}: {
  book: BookMeta;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { save, invalidate } = useBookMutations();
  const [draft, setDraft] = useState(book);
  const [busy, setBusy] = useState<"meta" | "cover" | "pages" | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);


  async function autoMetadata() {
    setBusy("meta");
    try {
      const patch = await refetchMetadata(draft);
      const keys = Object.keys(patch);
      if (!keys.length) {
        toast.info("No match found — try refining the title or adding an ISBN");
        return;
      }
      setDraft((d) => ({ ...d, ...patch }));
      toast.success(`Updated ${keys.length} field${keys.length > 1 ? "s" : ""} — press Save to keep`);
    } catch {
      toast.error("Could not reach metadata providers");
    } finally {
      setBusy(null);
    }
  }

  async function autoCover() {
    if (draft.locked.includes("cover")) {
      toast.info("Cover is locked");
      return;
    }
    setBusy("cover");
    try {
      const ok = await refetchCover(draft, true);
      if (!ok) {
        toast.info("No cover found");
        return;
      }
      await save.mutateAsync({ id: book.id, patch: { hasCover: true } });
      toast.success("Cover updated");
      window.location.reload();
    } catch {
      toast.error("Could not fetch cover");
    } finally {
      setBusy(null);
    }
  }

  async function recalcPages() {
    if (draft.locked.includes("pageCount")) {
      toast.info("Page count is locked");
      return;
    }
    setBusy("pages");
    try {
      const pages = await recountPages(draft);
      if (!pages) {
        toast.info("Could not read the book file to count pages");
        return;
      }
      setDraft((d) => ({ ...d, pageCount: pages }));
      toast.success(`Counted ${pages} pages — press Save to keep`);
    } catch {
      toast.error("Could not recalculate the page count");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (open) setDraft(book);
  }, [open, book]);

  const isLocked = (key: string) => draft.locked.includes(key);
  const toggleLock = (key: string) =>
    setDraft((d) => ({
      ...d,
      locked: d.locked.includes(key) ? d.locked.filter((k) => k !== key) : [...d.locked, key],
    }));




  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto border-gold/25 bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-gold">Edit metadata</DialogTitle>
          <DialogDescription>
            Lock a field to protect it from any automatic update.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 border-gold/30 text-xs"
            disabled={busy !== null}
            onClick={() => void autoMetadata()}
          >
            {busy === "meta" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Auto-fetch metadata
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-gold/30 text-xs"
            disabled={busy !== null}
            onClick={() => void autoCover()}
          >
            {busy === "cover" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Auto-fetch cover
          </Button>
        </div>

        <Button
          variant="outline"
          className="border-gold/30 text-xs"
          disabled={busy !== null}
          onClick={() => void recalcPages()}
        >
          {busy === "pages" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Calculator className="size-4" />
          )}
          Recalculate page count
        </Button>

        <div className="space-y-4">
          {FIELDS.map((f) => (
            <div key={String(f.key)} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  {f.label}
                </label>
                <button
                  type="button"
                  onClick={() => toggleLock(String(f.key))}
                  aria-label={`${isLocked(String(f.key)) ? "Unlock" : "Lock"} ${f.label}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors",
                    isLocked(String(f.key))
                      ? "bg-gold/15 text-gold"
                      : "text-muted-foreground hover:text-gold",
                  )}
                >
                  {isLocked(String(f.key)) ? (
                    <Lock className="size-3" />
                  ) : (
                    <LockOpen className="size-3" />
                  )}
                  {isLocked(String(f.key)) ? "Locked" : "Lock"}
                </button>
              </div>
              {f.area ? (
                <Textarea
                  rows={3}
                  value={String(draft[f.key] ?? "")}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              ) : f.numeric ? (
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={Number(draft[f.key] ?? 0) || ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: Math.max(0, Number(e.target.value) || 0) }))
                  }
                />
              ) : (
                <Input
                  value={String(draft[f.key] ?? "")}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Tags
            </label>
            <Input
              placeholder="comma, separated"
              value={(draft.tags ?? []).join(", ")}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  tags: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 20),
                }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Rating
              </label>
              <button
                type="button"
                onClick={() => toggleLock("rating")}
                className={cn(
                  "text-[10px] uppercase tracking-widest",
                  isLocked("rating") ? "text-gold" : "text-muted-foreground",
                )}
              >
                {isLocked("rating") ? "Locked" : "Lock"}
              </button>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, rating: d.rating === n ? 0 : n }))}
                  className={cn(
                    "size-9 rounded-full border text-sm",
                    draft.rating >= n
                      ? "border-gold/60 bg-gold/15 text-gold"
                      : "border-border text-muted-foreground",
                  )}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Cover image
              </label>
              <button
                type="button"
                onClick={() => toggleLock("cover")}
                className={cn(
                  "text-[10px] uppercase tracking-widest",
                  isLocked("cover") ? "text-gold" : "text-muted-foreground",
                )}
              >
                {isLocked("cover") ? "Locked" : "Lock"}
              </button>
            </div>
            <Button
              variant="outline"
              className="w-full border-gold/30 text-xs"
              onClick={() => setCoverOpen(true)}
            >
              <ImagePlus className="size-4" />
              Replace &amp; crop cover
            </Button>

          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-gradient-gold text-primary-foreground"
            onClick={async () => {
              const { id, ...patch } = draft;
              await save.mutateAsync({ id, patch });
              invalidate();
              toast.success("Metadata saved");
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
        <CoverEditor book={book} open={coverOpen} onOpenChange={setCoverOpen} />
      </DialogContent>
    </Dialog>

  );
}
