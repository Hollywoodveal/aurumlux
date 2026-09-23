import { useEffect, useState } from "react";
import {
  Calculator,
  ImagePlus,
  Loader2,
  Lock,
  LockOpen,
  RefreshCw,
  Search,
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
import { StarRating } from "@/components/StarRating";
import { type BookMeta, putCover } from "@/lib/db";
import { useBookMutations } from "@/hooks/useLibrary";
import {
  applyRemotePatch,
  recountPages,
  searchMetadataCandidates,
  type RemoteCandidate,
} from "@/lib/importer";
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
  const [candidates, setCandidates] = useState<RemoteCandidate[] | null>(null);
  const [coverOptions, setCoverOptions] = useState<RemoteCandidate[] | null>(null);

  /** Search providers and show a ranked pick-list instead of blindly taking the first hit. */
  async function findCandidates() {
    setBusy("meta");
    try {
      const list = await searchMetadataCandidates(draft);
      setCandidates(list);
      if (!list.length) {
        toast.info("No matches found — try refining the title or adding an ISBN");
      }
    } catch {
      toast.error("Could not reach metadata providers");
    } finally {
      setBusy(null);
    }
  }

  async function useCandidate(c: RemoteCandidate) {
    const patch = applyRemotePatch(draft, c);
    const keys = Object.keys(patch);
    if (!keys.length) {
      toast.info("Nothing new — this match adds no unlocked fields");
      return;
    }
    setDraft((d) => ({ ...d, ...patch }));
    setCandidates(null);
    toast.success(`Updated ${keys.length} field${keys.length > 1 ? "s" : ""} — press Save to keep`);
    // Take the match's cover too, unless the cover field is locked.
    if (c.coverUrl && !(draft.locked ?? []).includes("cover")) {
      try {
        const blob = await (await fetch(c.coverUrl)).blob();
        if (blob.size > 1000) {
          await putCover(draft.id, blob);
          await save.mutateAsync({ id: draft.id, patch: { hasCover: true } });
          setDraft((d) => ({ ...d, hasCover: true }));
          toast.success("Cover saved too");
        }
      } catch {
        /* cover is a bonus — metadata already applied */
      }
    }
  }

  /** Search providers and show every cover found, instead of taking the first one. */
  async function findCovers() {
    if ((draft.locked ?? []).includes("cover")) {
      toast.info("Cover is locked");
      return;
    }
    setBusy("cover");
    try {
      const list = await searchMetadataCandidates(draft);
      const seen = new Set<string>();
      const covers = list.filter((c) => {
        if (!c.coverUrl || seen.has(c.coverUrl)) return false;
        seen.add(c.coverUrl);
        return true;
      });
      setCoverOptions(covers);
      if (!covers.length) {
        toast.info("No covers found — try refining the title or adding an ISBN");
      }
    } catch {
      toast.error("Could not reach metadata providers");
    } finally {
      setBusy(null);
    }
  }

  async function useCover(c: RemoteCandidate) {
    if (!c.coverUrl || (draft.locked ?? []).includes("cover")) return;
    setBusy("cover");
    try {
      const blob = await (await fetch(c.coverUrl)).blob();
      if (blob.size <= 1000) {
        toast.info("That cover couldn't be downloaded");
        return;
      }
      await putCover(draft.id, blob);
      await save.mutateAsync({ id: draft.id, patch: { hasCover: true } });
      setDraft((d) => ({ ...d, hasCover: true }));
      setCoverOptions(null);
      toast.success("Cover updated");
    } catch {
      toast.error("Could not download that cover");
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
    if (open) {
      setDraft(book);
      setCandidates(null);
      setCoverOptions(null);
    }
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
            onClick={() => void findCandidates()}
          >
            {busy === "meta" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Find matches online
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-gold/30 text-xs"
            disabled={busy !== null}
            onClick={() => void findCovers()}
          >
            {busy === "cover" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Find covers online
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

        {candidates !== null && candidates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Pick the right match
            </p>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {candidates.map((c, i) => (
                <div
                  key={`${c.provider}-${c.title}-${c.author}-${i}`}
                  className="flex items-center gap-3 rounded-xl border border-gold/20 bg-background/60 p-2"
                >
                  {c.coverUrl ? (
                    <img
                      src={c.coverUrl}
                      alt=""
                      loading="lazy"
                      className="h-16 w-11 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded bg-gold/10 text-[10px] text-muted-foreground">
                      No cover
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.title ?? "Unknown title"}</p>
                    {c.author && (
                      <p className="truncate text-xs text-muted-foreground">{c.author}</p>
                    )}
                    {(c.publisher || c.publishedDate) && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {[c.publisher, c.publishedDate].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest",
                          c.score >= 75
                            ? "bg-gold/15 text-gold"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {c.matchLabel}
                      </span>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {c.provider === "google" ? "Google Books" : "Open Library"}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-gold/30 text-xs"
                    disabled={busy !== null}
                    onClick={() => void useCandidate(c)}
                  >
                    Use this
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {coverOptions !== null && coverOptions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Pick a cover — tap to use it
            </p>
            <div className="grid grid-cols-3 gap-2">
              {coverOptions.map((c, i) => (
                <button
                  key={`${c.provider}-${c.coverUrl}-${i}`}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void useCover(c)}
                  className="group relative overflow-hidden rounded-lg border border-gold/20 transition-transform active:scale-95"
                  title={`${c.title ?? "Unknown title"} — ${c.matchLabel} (${c.provider === "google" ? "Google Books" : "Open Library"})`}
                >
                  <img
                    src={c.coverUrl}
                    alt={c.title ?? "Book cover option"}
                    loading="lazy"
                    className="aspect-[2/3] w-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] font-medium leading-tight text-white">
                    {c.matchLabel}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

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
            <StarRating
              value={draft.rating}
              size="lg"
              className="-ml-2"
              onChange={(rating) => setDraft((d) => ({ ...d, rating }))}
            />
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
