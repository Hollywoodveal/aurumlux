import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImportFromUrl } from "@/components/ImportFromUrl";
import { BrandMark } from "@/components/BrandMark";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Switch } from "@/components/settings/Switch";
import { ThemePicker } from "@/components/settings/ThemePicker";

import {
  ChevronLeft,
  Download,
  HardDrive,
  Lock,
  SearchCheck,
  Palette,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import {
  buildSyncBundle,
  decryptBundle,
  encryptBundle,
  mergeSyncBundle,
} from "@/lib/backup";
import { indexLibrary } from "@/lib/textindex";
import { toast } from "sonner";
import { useBooks, useBookMutations } from "@/hooks/useLibrary";
import {
  fmtBytes,
  measureStorage,
  requestPersistentStorage,
  type StorageReport,
} from "@/lib/storage";
import {
  allAnnotations,
  putAnnotation,
  putBook,
  type Annotation,
  type BookMeta,
} from "@/lib/db";
import { useQueryClient } from "@tanstack/react-query";
import { useOnboarding } from "@/hooks/useOnboarding";
import {
  clearLastRead,
  getResumeOnLaunch,
  setResumeOnLaunch,
} from "@/lib/resume";
import {
  getOnlineMetadataLookup,
  setOnlineMetadataLookup,
} from "@/lib/importer";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings & backup — Aurum" },
      {
        name: "description",
        content:
          "Export your Aurum library as JSON, restore a backup, and review how your reading data stays private on your device.",
      },
      { property: "og:title", content: "Settings & backup — Aurum" },
      {
        property: "og:description",
        content:
          "Local-first backup and privacy settings for your Aurum library.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: books } = useBooks();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { replay } = useOnboarding();

  const { remove } = useBookMutations();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [persisted, setPersisted] = useState(false);
  const syncRef = useRef<HTMLInputElement>(null);
  const [passphrase, setPassphrase] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<string | null>(null);
  const [resume, setResume] = useState(true);
  const [onlineLookup, setOnlineLookup] = useState(false);

  useEffect(() => {
    void getResumeOnLaunch().then(setResume);
  }, []);

  useEffect(() => {
    void getOnlineMetadataLookup().then(setOnlineLookup);
  }, []);

  async function exportSync() {
    setBusy(true);
    try {
      const payload = await encryptBundle(await buildSyncBundle(), passphrase);
      const blob = new Blob([payload], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aurum-sync-${new Date().toISOString().slice(0, 10)}.aurum`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Encrypted transfer file downloaded");
    } catch {
      toast.error("Could not create the encrypted file");
    }
    setBusy(false);
  }

  async function mergeSync(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const bundle = await decryptBundle(await file.text(), passphrase);
      const merged = await mergeSyncBundle(bundle);
      qc.invalidateQueries();
      toast.success(
        `Synced · ${merged.positions} position${merged.positions === 1 ? "" : "s"}, ${merged.added} new book${merged.added === 1 ? "" : "s"}, ${merged.annotations} annotation${merged.annotations === 1 ? "" : "s"}`,
      );
    } catch {
      toast.error("Wrong passphrase, or not an Aurum sync file");
    }
    setBusy(false);
    if (syncRef.current) syncRef.current.value = "";
  }

  async function buildIndex() {
    setIndexing(true);
    setIndexProgress("Indexing…");
    try {
      const built = await indexLibrary((done, total) =>
        setIndexProgress(`Indexing ${done}/${total}…`),
      );
      toast.success(
        built
          ? `Indexed ${built} book${built === 1 ? "" : "s"}`
          : "Everything is already indexed",
      );
    } catch {
      toast.error("Indexing failed");
    }
    setIndexing(false);
    setIndexProgress(null);
  }

  const refreshStorage = useCallback(() => {
    void measureStorage().then(setReport);
  }, []);

  useEffect(() => {
    refreshStorage();
    if (typeof navigator !== "undefined" && navigator.storage?.persisted) {
      void navigator.storage.persisted().then(setPersisted);
    }
  }, [refreshStorage]);

  const nearQuota =
    report?.percent !== null &&
    report?.percent !== undefined &&
    report.percent >= 80;
  const heaviest = report
    ? [...books]
        .map((b) => ({ book: b, bytes: report.perBook[b.id]?.total ?? 0 }))
        .sort((a, b) => b.bytes - a.bytes)
    : [];

  async function exportLibrary() {
    const payload = {
      app: "aurum",
      version: 1,
      exportedAt: new Date().toISOString(),
      books,
      annotations: await allAnnotations(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aurum-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup downloaded");
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const data = JSON.parse(await file.text()) as {
        books?: BookMeta[];
        annotations?: Annotation[];
      };
      for (const b of data.books ?? [])
        await putBook({ ...b, hasCover: false });
      for (const a of data.annotations ?? []) await putAnnotation(a);
      qc.invalidateQueries();
      toast.success("Backup restored (book files must be re-imported)");
    } catch {
      toast.error("That file isn't a valid Aurum backup");
    }
    setBusy(false);
  }

  return (
    <main
      id="main-content"
      className="mx-auto min-h-screen w-full max-w-3xl pb-16 px-safe pt-safe lg:max-w-4xl"
    >
      <header className="flex items-center gap-3">
        <Link to="/" aria-label="Back to library" className="icon-btn">
          <ChevronLeft className="size-[18px]" />
        </Link>
        <BrandMark size={38} />
        <h1 className="font-display text-3xl text-gradient-gold">Settings</h1>
      </header>

      <p className="eyebrow mt-8">Reading</p>

      <SettingsSection
        id="appearance"
        title="Appearance"
        icon={<Palette className="size-4 text-gold" aria-hidden />}
        className="mt-3"
      >
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how Aurum looks. The reader follows this automatically unless
          you pick a page colour of its own while reading.
        </p>
        <ThemePicker />
      </SettingsSection>

      <SettingsSection
        id="import-url"
        title="Import from a link"
        className="mt-4"
      >
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a direct EPUB, PDF, CBZ or TXT link, or an OPDS catalog feed,
          and Aurum will download it straight onto your device.
        </p>
        <ImportFromUrl />
      </SettingsSection>

      <SettingsSection id="resume" title="Resume reading" className="mt-4">
        <p className="mt-1 text-sm text-muted-foreground">
          When Aurum opens, go straight back into the book you were last
          reading, at the exact page you left off.
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-ivory">
            Reopen my last book on launch
          </span>
          <Switch
            checked={resume}
            label="Reopen my last book on launch"
            onChange={(next) => {
              setResume(next);
              void setResumeOnLaunch(next);
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            void clearLastRead().then(() =>
              toast.success("Aurum will open to your library next time"),
            );
          }}
          className="btn btn-outline mt-4 text-xs uppercase tracking-[0.18em]"
        >
          Forget saved spot
        </button>
      </SettingsSection>

      <p className="eyebrow mt-8">Your data</p>

      <SettingsSection id="backup" title="Backup" className="mt-3">
        <p className="mt-1 text-sm text-muted-foreground">
          Your library lives only on this device. Export a JSON copy of your
          metadata, progress, bookmarks and highlights.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => void exportLibrary()} className="btn btn-gold">
            <Download className="size-4" /> Export library
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="btn btn-outline"
          >
            <Upload className="size-4" /> Restore backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void importBackup(e.target.files?.[0])}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        id="sync"
        title="Encrypted transfer"
        icon={<Lock className="size-4 text-gold" aria-hidden />}
        className="mt-3"
      >
        <p className="mt-1 text-sm text-muted-foreground">
          Move reading positions, bookmarks and highlights between your devices
          with an encrypted file. Choose a passphrase — it never leaves this
          device, and without it the file cannot be opened.
        </p>
        <label
          htmlFor="sync-pass"
          className="mt-3 block text-[11px] uppercase tracking-[0.16em] text-gold/70"
        >
          Passphrase
        </label>
        <input
          id="sync-pass"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
          placeholder="At least 8 characters"
          className="mt-1.5 w-full rounded-xl border border-gold/20 bg-secondary/60 px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-gold/50"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void exportSync()}
            disabled={busy || passphrase.length < 8}
            className="btn btn-gold"
          >
            <ShieldCheck className="size-4" /> Export encrypted
          </button>
          <button
            onClick={() => syncRef.current?.click()}
            disabled={busy || passphrase.length < 8}
            className="btn btn-outline"
          >
            <Upload className="size-4" /> Merge from device
          </button>
          <input
            ref={syncRef}
            type="file"
            accept=".aurum,text/plain"
            className="hidden"
            onChange={(e) => void mergeSync(e.target.files?.[0])}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        id="search-index"
        title="Full-text search"
        icon={<SearchCheck className="size-4 text-gold" aria-hidden />}
        className="mt-3"
      >
        <p className="mt-1 text-sm text-muted-foreground">
          Build a private, on-device index so library search can look inside
          your books, not just titles and authors.
        </p>
        <button
          onClick={() => void buildIndex()}
          disabled={indexing || books.length === 0}
          className="btn btn-outline mt-4"
        >
          <SearchCheck className="size-4" />
          {indexing ? (indexProgress ?? "Indexing…") : "Index my books"}
        </button>
      </SettingsSection>

      <SettingsSection
        id="storage"
        title="Storage"
        icon={<HardDrive className="size-4 text-gold" aria-hidden />}
        className="mt-3"
      >
        {report ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              {report.quota
                ? `${fmtBytes(report.usage ?? 0)} used of about ${fmtBytes(report.quota)} available on this device`
                : `${fmtBytes(report.booksBytes)} used by your books`}
            </p>

            {report.percent !== null ? (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={
                      nearQuota
                        ? "h-full bg-destructive"
                        : "h-full bg-gradient-gold"
                    }
                    style={{ width: `${Math.max(1, report.percent)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {report.percent.toFixed(1)}% of device quota · books use{" "}
                  {fmtBytes(report.booksBytes)}
                </p>
              </div>
            ) : null}

            {nearQuota ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                You are close to this device's storage limit. Delete a few large
                books below before importing more, or your browser may start
                evicting data.
              </p>
            ) : null}

            {!persisted ? (
              <button
                onClick={async () => {
                  const ok = await requestPersistentStorage();
                  setPersisted(ok);
                  toast[ok ? "success" : "error"](
                    ok
                      ? "Your library is protected from eviction"
                      : "Your browser declined persistent storage",
                  );
                }}
                className="btn btn-outline mt-4 text-xs uppercase tracking-[0.16em]"
              >
                Protect from eviction
              </button>
            ) : (
              <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-gold/80">
                Persistent storage granted
              </p>
            )}

            <ul className="mt-4 space-y-2">
              {heaviest.map(({ book, bytes }) => (
                <li key={book.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ivory">
                      {book.title || "Untitled"}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      {book.format.toUpperCase()} · {fmtBytes(bytes)}
                      {report.perBook[book.id]?.coverBytes
                        ? ` · cover ${fmtBytes(report.perBook[book.id]!.coverBytes)}`
                        : ""}
                    </p>
                  </div>
                  <button
                    aria-label={`Delete ${book.title || "book"} to free space`}
                    onClick={async () => {
                      await remove.mutateAsync(book.id);
                      refreshStorage();
                      toast.success("Book deleted");
                    }}
                    className="shrink-0 text-destructive/70"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
              {heaviest.length === 0 ? (
                <li className="text-sm text-muted-foreground">
                  No books stored yet.
                </li>
              ) : null}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Measuring on-device usage…
          </p>
        )}
      </SettingsSection>

      <p className="eyebrow mt-8">Privacy</p>

      <SettingsSection id="privacy" title="Privacy" className="mt-3">
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>· No account, no sign-in.</li>
          <li>· No ads, no analytics.</li>
          <li>
            · Books, covers, notes and progress stored in on-device storage.
          </li>
          <li>
            · No cloud sync — moving data between devices is a manual encrypted
            file transfer you start yourself.
          </li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          When importing a book with missing details, Aurum can ask Google Books
          and Open Library to fill in the gaps. This is off by default — with it
          off, imports never touch the network.
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-ivory">
            Look up missing book info online
          </span>
          <Switch
            checked={onlineLookup}
            label="Look up missing book info online"
            onChange={(next) => {
              setOnlineLookup(next);
              void setOnlineMetadataLookup(next).then(() =>
                toast.success(
                  next ? "Online lookups enabled" : "Online lookups disabled",
                ),
              );
            }}
          />
        </div>
      </SettingsSection>

      <p className="eyebrow mt-8">App</p>

      <SettingsSection id="onboarding" title="Getting started" className="mt-3">
        <p className="mt-1 text-sm text-muted-foreground">
          Replay the short walkthrough of the shelf, select mode and reader
          gestures.
        </p>
        <button
          type="button"
          className="btn btn-outline mt-4 text-xs uppercase tracking-[0.16em]"
          onClick={() => {
            replay();
            toast.success("Tour will show on the library screen");
          }}
        >
          Replay the tour
        </button>
      </SettingsSection>

      <SettingsSection id="install" title="Install Aurum" className="mt-3">
        <p className="mt-1 text-sm text-muted-foreground">
          Add Aurum to your home screen from your browser menu to read full
          screen and offline. Once installed, the app shell is cached so your
          library opens with no connection at all.
        </p>
      </SettingsSection>

      <p className="mt-8 text-center text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
        Aurum · Where every page is treasured
      </p>
    </main>
  );
}
