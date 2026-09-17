import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown, BarChart3, CheckSquare, FolderPlus, Library, Layers, RefreshCw, Search, Settings, Sparkles, Tag, Trash2, X , NotebookPen} from "lucide-react";
import { toast } from "sonner";
import { BookDetails } from "@/components/BookDetails";
import { ImportButton } from "@/components/ImportButton";
import { ImportFromUrl } from "@/components/ImportFromUrl";
import { Onboarding } from "@/components/Onboarding";
import { useFileHandler } from "@/hooks/useFileHandler";


import {
  CompactShelf,
  GridShelf,
  ListShelf,
  SpineShelf,
  ViewSwitcher,
  type ViewMode,
} from "@/components/LibraryViews";
import { useAnnotations, useBookMutations, useBooks } from "@/hooks/useLibrary";
import type { BookMeta } from "@/lib/db";
import { recountPages, refetchCover, refetchMetadata } from "@/lib/importer";
import { resolveLaunchResume } from "@/lib/resume";
import { searchText } from "@/lib/textindex";

import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search["q"] === "string" && search["q"] ? { q: search["q"] as string } : {},

  head: () => ({
    meta: [
      { title: "Aurum — Your private black & gold library" },
      {
        name: "description",
        content:
          "Aurum is an offline-first mobile e-reader for EPUB and PDF. Your books, covers, notes and progress stay on your device. Where every page is treasured.",
      },
      { property: "og:title", content: "Aurum — Where every page is treasured" },
      {
        property: "og:description",
        content:
          "A premium offline-first EPUB and PDF reader with a black & gold digital bookshelf. No account, no ads, no tracking.",
      },
    ],
  }),
  component: LibraryPage,
});

type SortKey = "title" | "author" | "series" | "recent" | "progress" | "rating" | "pages";
type ShelfKey = "all" | "reading" | "finished" | "want" | "favorites";

const SHELVES: { key: ShelfKey; label: string }[] = [
  { key: "all", label: "All books" },
  { key: "reading", label: "Currently reading" },
  { key: "finished", label: "Finished" },
  { key: "want", label: "Want to read" },
  { key: "favorites", label: "Favorites" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "title", label: "Title A–Z" },
  { key: "author", label: "Author A–Z" },
  { key: "series", label: "Series order" },
  { key: "recent", label: "Recently added" },
  { key: "progress", label: "Progress" },
  { key: "rating", label: "Rating" },
  { key: "pages", label: "Length" },
];

const seriesName = (b: BookMeta) => (b.series ?? "").trim();
const seriesNo = (b: BookMeta) => (Number(b.seriesIndex) > 0 ? Number(b.seriesIndex) : Infinity);

/** Series volumes read in order, and each series stays together in its first member's slot. */
function groupSeries(list: BookMeta[]) {
  const out: BookMeta[] = [];
  const done = new Set<string>();
  for (const book of list) {
    const key = seriesName(book).toLowerCase();
    if (!key) {
      out.push(book);
      continue;
    }
    if (done.has(key)) continue;
    done.add(key);
    out.push(
      ...list
        .filter((b) => seriesName(b).toLowerCase() === key)
        .sort((a, b) => seriesNo(a) - seriesNo(b) || a.title.localeCompare(b.title)),
    );
  }
  return out;
}


function LibraryPage() {
  const { q: initialQuery } = Route.useSearch();
  const { data: books } = useBooks();
  useFileHandler();
  const navigate = useNavigate();

  // Reopen the last book on a fresh app launch so closing Aurum never loses
  // your place. Runs at most once per launch (see resolveLaunchResume).
  useEffect(() => {
    void resolveLaunchResume().then((bookId) => {
      if (bookId) void navigate({ to: "/read/$bookId", params: { bookId } });
    });
  }, [navigate]);


  const { data: annotations } = useAnnotations();
  const [view, setView] = useState<ViewMode>("spine");
  const [shelf, setShelf] = useState<ShelfKey>("all");
  const [sort, setSort] = useState<SortKey>("title");
  const [sortOpen, setSortOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [selected, setSelected] = useState<BookMeta | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tag, setTag] = useState<string | null>(null);
  const [recounting, setRecounting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [collection, setCollection] = useState<string | null>(null);
  const { remove, save } = useBookMutations();


  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of books) for (const t of b.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [books]);

  const allCollections = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of books) for (const c of b.collections ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [books]);

  const trimmed = query.trim();
  const { data: textHits = [] } = useQuery({
    queryKey: ["textsearch", trimmed],
    queryFn: () => searchText(trimmed),
    enabled: typeof window !== "undefined" && trimmed.length >= 2,
  });

  const insideHits = useMemo(() => {
    const byBook = new Map<string, { book: BookMeta; hits: typeof textHits }>();
    for (const hit of textHits) {
      const book = books.find((b) => b.id === hit.bookId);
      if (!book) continue;
      const entry = byBook.get(book.id) ?? { book, hits: [] };
      entry.hits.push(hit);
      byBook.set(book.id, entry);
    }
    return [...byBook.values()].slice(0, 8);
  }, [textHits, books]);

  const toggle = (b: BookMeta) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(b.id)) next.delete(b.id);
      else next.add(b.id);
      return next;
    });

  const exitSelect = () => {
    setSelectMode(false);
    setChecked(new Set());
  };

  const onBookTap = (b: BookMeta) => (selectMode ? toggle(b) : setSelected(b));

  const deleteChecked = async () => {
    const ids = [...checked];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} book${ids.length === 1 ? "" : "s"} from Aurum?`)) return;
    for (const id of ids) await remove.mutateAsync(id);
    toast.success(`Deleted ${ids.length} book${ids.length === 1 ? "" : "s"}`);
    exitSelect();
  };

  const recountChecked = async () => {
    const ids = [...checked];
    if (ids.length === 0 || recounting) return;
    setRecounting(true);
    let updated = 0;
    let skipped = 0;
    for (const id of ids) {
      const book = books.find((b) => b.id === id);
      if (!book) continue;
      if ((book.locked ?? []).includes("pageCount")) {
        skipped += 1;
        continue;
      }
      try {
        const pages = await recountPages(book);
        if (!pages || pages === book.pageCount) {
          skipped += 1;
          continue;
        }
        await save.mutateAsync({ id, patch: { pageCount: pages } });
        updated += 1;
      } catch {
        skipped += 1;
      }
    }
    setRecounting(false);
    toast.success(
      `Page counts updated for ${updated} book${updated === 1 ? "" : "s"}` +
        (skipped ? ` · ${skipped} unchanged` : ""),
    );
  };


  const fetchChecked = async () => {
    const ids = [...checked];
    if (ids.length === 0 || fetching) return;
    setFetching(true);
    let updated = 0;
    let covers = 0;
    for (const id of ids) {
      const book = books.find((b) => b.id === id);
      if (!book) continue;
      try {
        const patch = await refetchMetadata(book);
        if (Object.keys(patch).length > 0) {
          await save.mutateAsync({ id, patch });
          updated += 1;
        }
        if (await refetchCover({ ...book, ...patch })) covers += 1;
      } catch {
        /* keep going through the rest of the selection */
      }
    }
    setFetching(false);
    toast.success(
      `Metadata updated for ${updated} book${updated === 1 ? "" : "s"}` +
        (covers ? ` · ${covers} cover${covers === 1 ? "" : "s"} fetched` : ""),
    );
  };

  const collectChecked = async () => {
    const ids = [...checked];
    if (ids.length === 0) return;
    const name = window.prompt("Add the selected books to which collection?")?.trim();
    if (!name) return;
    for (const id of ids) {
      const book = books.find((b) => b.id === id);
      if (!book) continue;
      const next = [...new Set([...(book.collections ?? []), name])];
      await save.mutateAsync({ id, patch: { collections: next } });
    }
    toast.success(`${ids.length} book${ids.length === 1 ? "" : "s"} added to “${name}”`);
    exitSelect();
  };

  const current = selected ? (books.find((b) => b.id === selected.id) ?? null) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const annotationHits = new Set(
      q
        ? annotations
            .filter(
              (a) =>
                a.text.toLowerCase().includes(q) ||
                a.note.toLowerCase().includes(q) ||
                a.label.toLowerCase().includes(q),
            )
            .map((a) => a.bookId)
        : [],
    );
    const textBookIds = new Set(textHits.map((h) => h.bookId));
    let list = books.filter((b) => {
      if (tag && !(b.tags ?? []).includes(tag)) return false;
      if (collection && !(b.collections ?? []).includes(collection)) return false;
      if (shelf === "favorites") return b.favorite;
      if (shelf !== "all") return b.status === shelf;
      return true;
    });
    if (q) {
      list = list.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.subtitle ?? "").toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          b.genre.toLowerCase().includes(q) ||
          b.notes.toLowerCase().includes(q) ||
          (b.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
          annotationHits.has(b.id) ||
          textBookIds.has(b.id),
      );
    }
    const cmp: Record<SortKey, (a: BookMeta, b: BookMeta) => number> = {
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title),
      series: (a, b) =>
        (seriesName(a) || "\uffff").localeCompare(seriesName(b) || "\uffff") ||
        seriesNo(a) - seriesNo(b) ||
        a.title.localeCompare(b.title),
      recent: (a, b) => b.addedAt - a.addedAt,
      progress: (a, b) => b.progress - a.progress,
      rating: (a, b) => b.rating - a.rating,
      pages: (a, b) => b.pageCount - a.pageCount,
    };
    return groupSeries([...list].sort(cmp[sort]));
  }, [books, annotations, shelf, sort, query, tag, collection, textHits]);

  const reading = books.filter((b) => b.status === "reading").sort((a, b) => b.lastOpened - a.lastOpened);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl pb-24 px-safe pt-safe lg:max-w-6xl">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-4xl leading-none text-gradient-gold">
            Aurum <span className="sr-only">— private offline library</span>
          </h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            Where every page is treasured
          </p>
        </div>
        <nav className="flex items-center gap-1">
          <Link
            to="/notes"
            aria-label="Highlights, bookmarks and notes"
            className="rounded-full border border-gold/25 p-2 text-gold/80"
          >
            <NotebookPen className="size-4" />
          </Link>
          <Link
            to="/stats"
            aria-label="Statistics"
            className="rounded-full border border-gold/25 p-2 text-gold/80"
          >
            <BarChart3 className="size-4" />
          </Link>
          <Link
            to="/settings"
            aria-label="Settings"
            className="rounded-full border border-gold/25 p-2 text-gold/80"
          >
            <Settings className="size-4" />
          </Link>
        </nav>
      </header>

      <div className="mt-5 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search your library by title, author, or note"
            placeholder="Search titles, authors, notes"
            className="w-full rounded-full border border-gold/20 bg-secondary/60 py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-gold/50"
          />
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label="Sort books"
            onClick={() => setSortOpen((v) => !v)}
            className="rounded-full border border-gold/25 p-2.5 text-gold/80"
          >
            <ArrowUpDown className="size-4" />
          </button>
          {sortOpen ? (
            <div className="absolute right-0 z-30 mt-2 w-44 overflow-hidden rounded-xl border border-gold/25 bg-popover shadow-lux">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    setSort(s.key);
                    setSortOpen(false);
                  }}
                  className={cn(
                    "block w-full px-4 py-2.5 text-left text-sm",
                    sort === s.key ? "bg-gold/10 text-gold" : "text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4">
        {SHELVES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setShelf(s.key)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-xs tracking-wide transition-colors",
              shelf === s.key
                ? "border-gold/60 bg-gold/12 text-gold"
                : "border-border text-muted-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {allTags.length > 0 ? (
        <div className="no-scrollbar -mx-4 mt-2 flex items-center gap-2 overflow-x-auto px-4">
          <Tag aria-hidden className="size-3.5 shrink-0 text-gold/60" />
          {allTags.map(([name, count]) => (
            <button
              key={name}
              type="button"
              aria-pressed={tag === name}
              onClick={() => setTag((prev) => (prev === name ? null : name))}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-[11px] tracking-wide transition-colors",
                tag === name
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-border/70 text-muted-foreground",
              )}
            >
              {name} <span className="text-gold/50">{count}</span>
            </button>
          ))}
          {tag ? (
            <button
              type="button"
              onClick={() => setTag(null)}
              className="shrink-0 rounded-full border border-border/70 px-3 py-1 text-[11px] text-muted-foreground"
            >
              Clear tag
            </button>
          ) : null}
        </div>
      ) : null}

      {allCollections.length > 0 ? (
        <div className="no-scrollbar -mx-4 mt-2 flex items-center gap-2 overflow-x-auto px-4">
          <Layers aria-hidden className="size-3.5 shrink-0 text-gold/60" />
          {allCollections.map(([name, count]) => (
            <button
              key={name}
              type="button"
              aria-pressed={collection === name}
              onClick={() => setCollection((prev) => (prev === name ? null : name))}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-[11px] tracking-wide transition-colors",
                collection === name
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-border/70 text-muted-foreground",
              )}
            >
              {name} <span className="text-gold/50">{count}</span>
            </button>
          ))}
          {collection ? (
            <button
              type="button"
              onClick={() => setCollection(null)}
              className="shrink-0 rounded-full border border-border/70 px-3 py-1 text-[11px] text-muted-foreground"
            >
              Clear collection
            </button>
          ) : null}
        </div>
      ) : null}

      {insideHits.length > 0 ? (
        <section className="mt-5 rounded-xl border border-gold/20 bg-card/70 p-3">
          <h2 className="text-xs uppercase tracking-[0.2em] text-gold/70">Inside your books</h2>
          <ul className="mt-2 divide-y divide-border/60">
            {insideHits.map(({ book, hits }) => (
              <li key={book.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-display text-sm text-ivory">{book.title}</p>
                  <Link
                    to="/read/$bookId"
                    params={{ bookId: book.id }}
                    className="shrink-0 rounded-full border border-gold/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-gold"
                  >
                    Read
                  </Link>
                </div>
                {hits.slice(0, 2).map((hit, i) => (
                  <p key={`${hit.href}-${i}`} className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    <span className="text-gold/60">{hit.label} · </span>
                    {hit.snippet}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}



      {books.length === 0 ? (
        <section className="mt-8 pb-24 text-center sm:mt-16">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-gold/30">
            <Library className="size-7 text-gold" />
          </div>
          <h2 className="mt-5 font-display text-2xl text-ivory">Your shelves are waiting</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
            Import EPUB, PDF, CBZ or TXT files from your device. Everything stays offline, on your phone.
          </p>
          <div className="mt-6 flex justify-center">
            <ImportButton label="Import books" />
          </div>
          <div className="mx-auto mt-4 max-w-sm text-left">
            <p className="text-[11px] uppercase tracking-[0.16em] text-gold/70">Or import from a link</p>
            <ImportFromUrl />
          </div>
        </section>
      ) : (
        <>
          {reading.length > 0 && shelf === "all" && !query ? (
            <section className="mt-6">
              <h2 className="text-xs uppercase tracking-[0.2em] text-gold/70">Continue reading</h2>
              <div className="no-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4">
                {reading.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelected(b)}
                    className="w-40 shrink-0 rounded-xl border border-gold/20 bg-card p-3 text-left shadow-lux"
                  >
                    <p className="line-clamp-2 font-display text-base leading-tight text-ivory">
                      {b.title}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">{b.author}</p>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full bg-gradient-gold" style={{ width: `${b.progress}%` }} />
                    </div>
                    <p className="mt-1 text-[10px] text-gold/70">{Math.round(b.progress)}%</p>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-7">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs uppercase tracking-[0.2em] text-gold/70">
                {SHELVES.find((s) => s.key === shelf)?.label} · {filtered.length}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                  aria-label={selectMode ? "Cancel selection" : "Select books"}
                  className={cn(
                    "rounded-full border p-2 transition-colors",
                    selectMode ? "border-gold/60 bg-gold/12 text-gold" : "border-gold/25 text-gold/80",
                  )}
                >
                  {selectMode ? <X className="size-4" /> : <CheckSquare className="size-4" />}
                </button>
                <ViewSwitcher value={view} onChange={setView} />
              </div>
            </div>
            <div className="mt-4">
              {filtered.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No books here yet.</p>
              ) : view === "spine" ? (
                <SpineShelf books={filtered} onSelect={onBookTap} selectable={selectMode} selectedIds={checked} />
              ) : view === "grid" ? (
                <GridShelf books={filtered} onSelect={onBookTap} selectable={selectMode} selectedIds={checked} />
              ) : view === "list" ? (
                <ListShelf books={filtered} onSelect={onBookTap} selectable={selectMode} selectedIds={checked} />
              ) : (
                <CompactShelf books={filtered} onSelect={onBookTap} selectable={selectMode} selectedIds={checked} />
              )}
            </div>
          </section>
        </>
      )}

      {selectMode ? (
        <div className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] left-1/2 z-40 flex w-[min(92vw,32rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-gold/30 bg-card/95 px-3 py-2 shadow-lux backdrop-blur">
          <span className="pl-1 text-xs text-muted-foreground">
            <span className="text-gold">{checked.size}</span> selected
          </span>
          <button
            type="button"
            onClick={() =>
              setChecked((prev) =>
                prev.size === filtered.length ? new Set() : new Set(filtered.map((b) => b.id)),
              )
            }
            className="ml-auto rounded-full border border-gold/30 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-gold/90"
          >
            {checked.size === filtered.length ? "None" : "All"}
          </button>
          <button
            type="button"
            onClick={() => void recountChecked()}
            disabled={checked.size === 0 || recounting}
            aria-label="Recalculate page count for selected books"
            className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-gold disabled:opacity-40"
          >
            <RefreshCw className={cn("size-3.5", recounting && "animate-spin")} />
            Pages
          </button>

          <button
            type="button"
            onClick={() => void fetchChecked()}
            disabled={checked.size === 0 || fetching}
            aria-label="Auto-fetch metadata and covers for selected books"
            className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-gold disabled:opacity-40"
          >
            <Sparkles className={cn("size-3.5", fetching && "animate-pulse")} />
            Fetch
          </button>
          <button
            type="button"
            onClick={() => void collectChecked()}
            disabled={checked.size === 0}
            aria-label="Add selected books to a collection"
            className="flex items-center gap-1.5 rounded-full border border-gold/30 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-gold/90 disabled:opacity-40"
          >
            <FolderPlus className="size-3.5" />
            Shelf
          </button>
          <button
            type="button"
            onClick={() => void deleteChecked()}
            disabled={checked.size === 0 || remove.isPending}
            className="flex items-center gap-1.5 rounded-full border border-destructive/50 bg-destructive/15 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.12em] text-destructive disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
            Delete
          </button>
        </div>
      ) : (
        <div className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] left-1/2 z-40 -translate-x-1/2">
          <ImportButton />
        </div>
      )}

      {current ? <BookDetails book={current} onClose={() => setSelected(null)} /> : null}
      <Onboarding />
    </main>

  );
}
