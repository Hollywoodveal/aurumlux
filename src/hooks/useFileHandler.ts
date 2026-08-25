import { useEffect } from "react";
import { toast } from "sonner";
import { detectFormat, importFile } from "@/lib/importer";
import { indexLibrary } from "@/lib/textindex";
import { useBookMutations } from "@/hooks/useLibrary";

const SUPPORTED = ["epub", "pdf", "cbz", "cbr", "txt"];

type LaunchParams = { files?: FileSystemFileHandle[] };
type LaunchQueue = { setConsumer: (fn: (params: LaunchParams) => void) => void };

/**
 * Handles books opened from the operating system ("Open with Aurum") once the
 * PWA is installed. Chrome exposes them through window.launchQueue.
 */
export function useFileHandler() {
  const { invalidate } = useBookMutations();

  useEffect(() => {
    const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    if (!queue) return;

    queue.setConsumer((params) => {
      const handles = params.files ?? [];
      if (handles.length === 0) return;
      void (async () => {
        let ok = 0;
        for (const handle of handles) {
          try {
            const file = await handle.getFile();
            if (!SUPPORTED.includes(detectFormat(file.name) ?? "")) {
              toast.error(`${file.name}: EPUB, PDF, CBZ and TXT are supported`);
              continue;
            }
            await importFile(file);
            ok += 1;
          } catch (error) {
            console.error(error);
            toast.error("Could not open that file");
          }
        }
        invalidate();
        if (ok > 0) {
          toast.success(`${ok} book${ok > 1 ? "s" : ""} added to your library`);
          void indexLibrary().then(() => invalidate());
        }
      })();
    });
  }, [invalidate]);
}
