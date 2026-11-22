import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Download,
  Library,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBookMutations } from "@/hooks/useLibrary";
import { importFromUrl } from "@/lib/importer";
import { relayUrl } from "@/lib/net";
import {
  OpdsAuthError,
  SUGGESTED_CATALOGS,
  authFor,
  fetchFeed,
  listCatalogs,
  saveCatalogs,
  searchFeed,
  type OpdsAcquisition,
  type OpdsCatalog,
  type OpdsEntry,
  type OpdsFeed,
} from "@/lib/opds";
import { indexLibrary } from "@/lib/textindex";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open straight into this catalog URL (e.g. a link pasted into import). */
  initialUrl?: string | undefined;
};

type Page = { feed: OpdsFeed; catalog: OpdsCatalog };

/** Browse, search and download from OPDS catalogs. */
export function OpdsBrowser({ open, onOpenChange, initialUrl }: Props) {
  const [catalogs, setCatalogs] = useState<OpdsCatalog[]>([]);
  const [stack, setStack] = useState<Page[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Partial<OpdsCatalog> | null>(null);
  const [query, setQuery] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const { invalidate } = useBookMutations();
  const openedFor = useRef<string | undefined>(undefined);

  const page = stack[stack.length - 1];

  useEffect(() => {
    if (!open) return;
    void listCatalogs().then(setCatalogs);
  }, [open]);

  useEffect(() => {
    if (!open || !initialUrl || openedFor.current === initialUrl) return;
    openedFor.current = initialUrl;
    void openCatalog({ id: "pasted", title: "Catalog", url: initialUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUrl]);

  async function load(
    catalog: OpdsCatalog,
    task: () => Promise<OpdsFeed>,
    mode: "push" | "replace" | "append",
  ) {
    setLoading(true);
    setError(null);
    try {
      const feed = await task();
      setStack((s) => {
        if (mode === "push") return [...s, { feed, catalog }];
        const last = s[s.length - 1];
        if (mode === "append" && last) {
          return [
            ...s.slice(0, -1),
            {
              catalog,
              feed: {
                ...last.feed,
                entries: [...last.feed.entries, ...feed.entries],
                nextUrl: feed.nextUrl,
              },
            },
          ];
        }
        return [...s.slice(0, -1), { feed, catalog }];
      });
    } catch (e) {
      if (e instanceof OpdsAuthError) {
        setAdding({
          ...catalog,
          id: catalog.id === "pasted" ? "" : catalog.id,
        });
        setError(
          "This catalog needs you to sign in. Add your username and password below.",
        );
      } else {
        setError(e instanceof Error ? e.message : "The catalog couldn't load.");
      }
    } finally {
      setLoading(false);
    }
  }

  function openCatalog(catalog: OpdsCatalog) {
    setQuery("");
    return load(
      catalog,
      () => fetchFeed(catalog.url, authFor(catalog)),
      "push",
    );
  }

  function openEntry(entry: OpdsEntry) {
    if (!page || !entry.navigationUrl) return;
    const url = entry.navigationUrl;
    setQuery("");
    void load(
      page.catalog,
      () => fetchFeed(url, authFor(page.catalog)),
      "push",
    );
  }

  function runSearch() {
    if (!page || !query.trim()) return;
    const base = stack[0]?.feed ?? page.feed;
    const feed =
      page.feed.searchTemplate || page.feed.searchDescriptionUrl
        ? page.feed
        : base;
    void load(
      page.catalog,
      () => searchFeed(feed, query.trim(), authFor(page.catalog)),
      "push",
    );
  }

  function loadMore() {
    if (!page?.feed.nextUrl) return;
    const url = page.feed.nextUrl;
    void load(
      page.catalog,
      () => fetchFeed(url, authFor(page.catalog)),
      "append",
    );
  }

  async function download(entry: OpdsEntry, acq: OpdsAcquisition) {
    if (!page || downloading) return;
    setDownloading(entry.id);
    try {
      const auth = authFor(page.catalog);
      const ext = acq.label.split(" ")[0]?.toLowerCase() ?? "epub";
      const safeTitle = entry.title.replace(/[\\/:*?"<>|]+/g, " ").trim();
      const { added, duplicates } = await importFromUrl(acq.href, {
        ...(auth ? { authorization: auth } : {}),
        filename: `${safeTitle || "book"}.${ext}`,
      });
      invalidate();
      if (added.length > 0) {
        toast.success(`“${entry.title}” added to your library`);
        void indexLibrary().then(() => invalidate());
      } else if (duplicates.length > 0) {
        toast.info("That book is already in your library");
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "That book couldn't be downloaded",
      );
    } finally {
      setDownloading(null);
    }
  }

  async function saveCatalog() {
    if (!adding?.url?.trim()) return;
    const url = adding.url.trim();
    if (!/^https:\/\//i.test(url)) {
      setError("Catalogs need an https:// address.");
      return;
    }
    const draft: OpdsCatalog = {
      id: adding.id || Math.random().toString(36).slice(2),
      title: adding.title?.trim() || "",
      url,
      username: adding.username?.trim() || undefined,
      password: adding.password || undefined,
    };
    setLoading(true);
    setError(null);
    try {
      const feed = await fetchFeed(draft.url, authFor(draft));
      const catalog = { ...draft, title: draft.title || feed.title };
      const next = [...catalogs.filter((c) => c.id !== catalog.id), catalog];
      setCatalogs(next);
      await saveCatalogs(next);
      setAdding(null);
      setStack([{ feed, catalog }]);
    } catch (e) {
      setError(
        e instanceof OpdsAuthError
          ? "The username or password wasn't accepted."
          : e instanceof Error
            ? e.message
            : "That catalog couldn't be reached.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function removeCatalog(id: string) {
    const next = catalogs.filter((c) => c.id !== id);
    setCatalogs(next);
    await saveCatalogs(next);
  }

  const canSearch = Boolean(
    page &&
    (page.feed.searchTemplate ||
      page.feed.searchDescriptionUrl ||
      stack[0]?.feed.searchTemplate ||
      stack[0]?.feed.searchDescriptionUrl),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setStack([]);
          setAdding(null);
          setError(null);
          openedFor.current = undefined;
        }
      }}
    >
      <DialogContent className="flex h-[92svh] max-h-[92svh] flex-col gap-0 overflow-hidden border-gold/25 bg-card p-0 sm:max-w-xl">
        <div className="flex items-center gap-2 border-b border-gold/15 px-4 py-3 pr-12">
          {stack.length > 0 || adding ? (
            <button
              type="button"
              aria-label="Back"
              onClick={() => {
                setError(null);
                if (adding) setAdding(null);
                else setStack((s) => s.slice(0, -1));
              }}
              className="rounded-full p-1.5 text-gold hover:bg-gold/10"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <Library className="size-5 text-gold" aria-hidden />
          )}
          <div className="min-w-0">
            <DialogTitle className="truncate font-display text-xl text-gold">
              {adding ? "Add a catalog" : (page?.feed.title ?? "Book catalogs")}
            </DialogTitle>
            <DialogDescription className="truncate text-xs text-muted-foreground">
              {adding
                ? "Any OPDS catalog address"
                : page
                  ? page.catalog.title
                  : "Free and personal libraries you can download from"}
            </DialogDescription>
          </div>
        </div>

        {page && !adding && canSearch ? (
          <form
            className="flex gap-2 border-b border-gold/10 px-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
          >
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this catalog"
              aria-label="Search this catalog"
              className="border-gold/25 bg-secondary/50 text-sm"
            />
            <Button
              type="submit"
              size="icon"
              variant="outline"
              aria-label="Search"
              disabled={!query.trim() || loading}
              className="shrink-0 border-gold/30"
            >
              <Search className="size-4" />
            </Button>
          </form>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? (
            <p
              role="alert"
              className="mb-3 rounded-lg border border-gold/20 bg-gold/5 px-3 py-2 text-sm text-ivory"
            >
              {error}
            </p>
          ) : null}

          {adding ? (
            <AddCatalogForm
              value={adding}
              onChange={setAdding}
              onSubmit={() => void saveCatalog()}
              busy={loading}
            />
          ) : !page ? (
            <div className="space-y-2">
              {catalogs.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 rounded-xl border border-gold/15 bg-secondary/30"
                >
                  <button
                    type="button"
                    onClick={() => void openCatalog(c)}
                    disabled={loading}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left"
                  >
                    <BookOpen
                      className="size-5 shrink-0 text-gold"
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ivory">
                        {c.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.url}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${c.title}`}
                    onClick={() => void removeCatalog(c.id)}
                    className="mr-2 rounded-full p-2 text-muted-foreground hover:text-gold"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <Button
                variant="outline"
                className="mt-2 w-full border-gold/30"
                onClick={() => {
                  setError(null);
                  setAdding({ url: "" });
                }}
              >
                <Plus className="size-4" /> Add a catalog
              </Button>
              {loading ? <Spinner /> : null}
            </div>
          ) : (
            <ul className="space-y-2">
              {page.feed.entries.length === 0 && !loading ? (
                <li className="py-8 text-center text-sm text-muted-foreground">
                  Nothing here.
                </li>
              ) : null}
              {page.feed.entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  busy={downloading === entry.id}
                  disabled={downloading !== null || loading}
                  signedIn={Boolean(page.catalog.username)}
                  onOpen={() => openEntry(entry)}
                  onDownload={(acq) => void download(entry, acq)}
                />
              ))}
              {loading ? <Spinner /> : null}
              {page.feed.nextUrl && !loading ? (
                <li>
                  <Button
                    variant="ghost"
                    className="w-full text-gold"
                    onClick={loadMore}
                  >
                    Load more
                  </Button>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-6" aria-live="polite">
      <Loader2 className="size-5 animate-spin text-gold" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

function EntryRow({
  entry,
  busy,
  disabled,
  signedIn,
  onOpen,
  onDownload,
}: {
  entry: OpdsEntry;
  busy: boolean;
  disabled: boolean;
  signedIn: boolean;
  onOpen: () => void;
  onDownload: (acq: OpdsAcquisition) => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  if (entry.navigationUrl) {
    return (
      <li>
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled}
          className="flex w-full items-center gap-3 rounded-xl border border-gold/15 bg-secondary/30 px-3 py-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-ivory">{entry.title}</span>
            {entry.summary ? (
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {entry.summary}
              </span>
            ) : null}
          </span>
          <ChevronRight className="size-4 shrink-0 text-gold" />
        </button>
      </li>
    );
  }
  const free = entry.acquisitions.filter((a) => a.free);
  // Covers in signed-in catalogs sit behind the same login, which an <img>
  // can't send, so they're skipped rather than shown broken.
  const cover =
    entry.coverUrl && !coverFailed && !signedIn ? entry.coverUrl : null;
  return (
    <li className="flex gap-3 rounded-xl border border-gold/15 bg-secondary/30 p-3">
      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const img = e.currentTarget;
              // Some catalogs block hot-linked covers; retry via the relay once.
              if (!img.dataset["relay"] && entry.coverUrl) {
                img.dataset["relay"] = "1";
                img.src = relayUrl(entry.coverUrl);
              } else setCoverFailed(true);
            }}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <BookOpen className="size-5 text-gold/50" aria-hidden />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-base leading-tight text-ivory">
          {entry.title}
        </p>
        {entry.author ? (
          <p className="mt-0.5 truncate text-xs text-gold/80">{entry.author}</p>
        ) : null}
        {entry.summary ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {entry.summary}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {free.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {entry.acquisitions.length > 0
                ? "Not a free download"
                : "No downloadable format"}
            </span>
          ) : (
            free.slice(0, 3).map((acq) => (
              <button
                key={acq.href}
                type="button"
                disabled={disabled}
                onClick={() => onDownload(acq)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border border-gold/30 px-2.5 py-1 text-[11px] text-gold",
                  "hover:bg-gold/10 disabled:opacity-50",
                )}
              >
                {busy ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Download className="size-3" />
                )}
                {acq.label}
              </button>
            ))
          )}
        </div>
      </div>
    </li>
  );
}

function AddCatalogForm({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: Partial<OpdsCatalog>;
  onChange: (v: Partial<OpdsCatalog>) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label className="block text-xs uppercase tracking-[0.14em] text-muted-foreground">
        Catalog address
        <Input
          value={value.url ?? ""}
          inputMode="url"
          onChange={(e) => onChange({ ...value, url: e.target.value })}
          placeholder="https://…/opds"
          className="mt-1 border-gold/25 bg-secondary/50 text-sm normal-case tracking-normal"
        />
      </label>
      <label className="block text-xs uppercase tracking-[0.14em] text-muted-foreground">
        Name (optional)
        <Input
          value={value.title ?? ""}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="Taken from the catalog if left blank"
          className="mt-1 border-gold/25 bg-secondary/50 text-sm normal-case tracking-normal"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Username
          <Input
            value={value.username ?? ""}
            autoComplete="username"
            onChange={(e) => onChange({ ...value, username: e.target.value })}
            className="mt-1 border-gold/25 bg-secondary/50 text-sm normal-case tracking-normal"
          />
        </label>
        <label className="block text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Password
          <Input
            type="password"
            value={value.password ?? ""}
            autoComplete="current-password"
            onChange={(e) => onChange({ ...value, password: e.target.value })}
            className="mt-1 border-gold/25 bg-secondary/50 text-sm normal-case tracking-normal"
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Sign-in details stay on this device and are sent only to this catalog,
        through Aurum's download relay.
      </p>
      <Button
        type="submit"
        disabled={busy || !value.url?.trim()}
        className="w-full bg-gradient-gold text-primary-foreground"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        Add catalog
      </Button>
      <div className="pt-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-gold/70">
          Suggestions
        </p>
        <ul className="mt-2 space-y-1.5">
          {SUGGESTED_CATALOGS.map((s) => (
            <li key={s.url}>
              <button
                type="button"
                onClick={() =>
                  onChange({ ...value, url: s.url, title: s.title })
                }
                className="w-full rounded-lg border border-gold/15 px-3 py-2 text-left"
              >
                <span className="block text-sm text-ivory">{s.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {s.note}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
