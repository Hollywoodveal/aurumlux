import { useState } from "react";
import { Library, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OpdsBrowser } from "@/components/OpdsBrowser";
import { importFromUrl } from "@/lib/importer";
import { indexLibrary } from "@/lib/textindex";
import { useBookMutations } from "@/hooks/useLibrary";

/**
 * Imports a book from a direct web link. A catalog link opens the catalog
 * browser instead. Duplicates already on the shelf are skipped.
 */
export function ImportFromUrl() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [catalogUrl, setCatalogUrl] = useState<string | undefined>();
  const { invalidate } = useBookMutations();

  const run = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      const { added, duplicates, catalogUrl: feed } = await importFromUrl(url);
      if (feed) {
        setCatalogUrl(feed);
        setBrowsing(true);
        setUrl("");
        return;
      }
      invalidate();
      if (added.length > 0) {
        toast.success(
          `${added.length} book${added.length === 1 ? "" : "s"} added` +
            (duplicates.length
              ? ` · ${duplicates.length} already on your shelf`
              : ""),
        );
        setUrl("");
        void indexLibrary().then(() => invalidate());
      } else if (duplicates.length > 0) {
        toast.info("That book is already in your library");
      } else {
        toast.error("Nothing could be imported from that link");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "That link could not be reached",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mt-3 flex gap-2">
        <Input
          value={url}
          inputMode="url"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          aria-label="Book or catalog link"
          placeholder="https://…/book.epub or an OPDS catalog"
          className="border-gold/25 bg-secondary/50 text-sm"
        />
        <Button
          onClick={() => void run()}
          disabled={busy || !url.trim()}
          className="shrink-0 bg-gradient-gold text-primary-foreground"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Link2 className="size-4" />
          )}
          Fetch
        </Button>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          setCatalogUrl(undefined);
          setBrowsing(true);
        }}
        className="mt-2 w-full border-gold/30 text-sm"
      >
        <Library className="size-4" /> Browse book catalogs
      </Button>
      <OpdsBrowser
        open={browsing}
        onOpenChange={setBrowsing}
        initialUrl={catalogUrl}
      />
    </>
  );
}
