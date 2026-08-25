import { useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { detectFormat, findDuplicate, importFile } from "@/lib/importer";
import { indexLibrary } from "@/lib/textindex";
import { useBookMutations } from "@/hooks/useLibrary";
import { cn } from "@/lib/utils";

const SUPPORTED = ["epub", "pdf", "cbz", "cbr", "txt"] as const;

export function ImportButton({ className, label = "Add books" }: { className?: string; label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { invalidate } = useBookMutations();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    let ok = 0;
    let duplicates = 0;
    for (const file of Array.from(files)) {
      const format = detectFormat(file.name);
      if (!SUPPORTED.includes(format as (typeof SUPPORTED)[number])) {
        toast.error(`${file.name}: EPUB, PDF, CBZ and TXT are supported`);
        continue;
      }
      try {
        // Skip books already on the shelf so re-importing never creates a twin.
        const { hash, existing } = await findDuplicate(file);
        if (existing) {
          duplicates += 1;
          toast.info(`"${existing.title}" is already in your library`);
          continue;
        }
        await importFile(file, hash);
        ok += 1;
      } catch (error) {
        console.error(error);
        toast.error(`Could not import ${file.name}`);
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    invalidate();
    if (ok > 0) {
      toast.success(
        `${ok} book${ok > 1 ? "s" : ""} added to your library` +
          (duplicates ? ` · ${duplicates} already on your shelf` : ""),
      );
      // Build the on-device search index quietly in the background.
      void indexLibrary().then(() => invalidate());
    }
  }


  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".epub,.pdf,.cbz,.cbr,.txt,application/epub+zip,application/pdf,text/plain"
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-full bg-gradient-gold px-5 py-2.5 text-sm font-medium tracking-wide text-primary-foreground shadow-gold transition-opacity active:opacity-80 disabled:opacity-60",
          className,
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {busy ? "Importing…" : label}
      </button>
    </>
  );
}
