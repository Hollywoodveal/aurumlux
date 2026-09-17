import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bookmark, ChevronLeft, Highlighter, NotebookPen, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAnnotations, useBooks } from "@/hooks/useLibrary";
import { deleteAnnotation, type Annotation } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";


export const Route = createFileRoute("/notes")({
  head: () => ({
    meta: [
      { title: "Highlights, bookmarks & notes — Aurum" },
      {
        name: "description",
        content:
          "Browse every highlight, bookmark and note you have saved across your Aurum library, and jump straight back to the page it came from.",
      },
      { property: "og:title", content: "Highlights, bookmarks & notes — Aurum" },
      {
        property: "og:description",
        content: "One private hub for all of your reading annotations across every book.",
      },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://aurumlux.daiyveal.workers.dev/notes" }],
  }),
  component: NotesPage,
});

const KINDS = [
  { value: "all", label: "All" },
  { value: "highlight", label: "Highlights" },
  { value: "bookmark", label: "Bookmarks" },
  { value: "note", label: "Notes" },
] as const;

function KindIcon({ type }: { type: Annotation["type"] }) {
  if (type === "bookmark") return <Bookmark className="size-3.5" />;
  if (type === "note") return <NotebookPen className="size-3.5" />;
  return <Highlighter className="size-3.5" />;
}

function NotesPage() {
  const { data: annotations } = useAnnotations();
  const { data: books } = useBooks();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("all");
  const [query, setQuery] = useState("");
  const [bookFilter, setBookFilter] = useState<string>("all");

  const titles = useMemo(
    () => Object.fromEntries(books.map((b) => [b.id, b.title || "Untitled"])),
    [books],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return annotations
      .filter((a) => (kind === "all" ? true : a.type === kind))
      .filter((a) => (bookFilter === "all" ? true : a.bookId === bookFilter))
      .filter((a) =>
        q
          ? `${a.text} ${a.note} ${a.label} ${titles[a.bookId] ?? ""}`.toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [annotations, kind, bookFilter, query, titles]);

  const counts = useMemo(
    () => ({
      highlight: annotations.filter((a) => a.type === "highlight").length,
      bookmark: annotations.filter((a) => a.type === "bookmark").length,
      note: annotations.filter((a) => a.type === "note").length,
    }),
    [annotations],
  );

  const booksWithNotes = useMemo(
    () => books.filter((b) => annotations.some((a) => a.bookId === b.id)),
    [books, annotations],
  );




  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl pb-16 px-safe pt-safe">
      <header className="flex items-center gap-2">
        <Link
          to="/"
          aria-label="Back to library"
          className="rounded-full border border-gold/25 p-2 text-gold"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <h1 className="font-display text-3xl text-gradient-gold">Annotations</h1>
      </header>
      <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {counts.highlight} highlights · {counts.bookmark} bookmarks · {counts.note} notes
      </p>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search highlights, bookmarks and notes"
        placeholder="Search your annotations"
        className="mt-5 w-full rounded-full border border-gold/20 bg-secondary/60 px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-gold/50"
      />

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs tracking-wide",
              kind === k.value
                ? "border-gold/60 bg-gold/12 text-gold"
                : "border-border text-muted-foreground",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>




      {booksWithNotes.length > 1 ? (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setBookFilter("all")}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-[11px]",
              bookFilter === "all"
                ? "border-gold/50 text-gold"
                : "border-border text-muted-foreground",
            )}
          >
            Every book
          </button>
          {booksWithNotes.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBookFilter(b.id)}
              className={cn(
                "max-w-[46vw] shrink-0 truncate rounded-full border px-3 py-1 text-[11px]",
                bookFilter === b.id
                  ? "border-gold/50 text-gold"
                  : "border-border text-muted-foreground",
              )}
            >
              {b.title || "Untitled"}
            </button>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          Nothing here yet. Highlights, bookmarks and notes you make while reading collect on this
          page.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {rows.map((a) => (
            <li key={a.id} className="rounded-xl border border-gold/20 bg-card p-3">
              <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <span className="flex items-center gap-1.5 text-gold/90">
                  <KindIcon type={a.type} />
                  {a.type}
                </span>
                <span>{new Date(a.createdAt).toLocaleDateString()}</span>
              </div>

              {a.text ? (
                <p
                  className="mt-2 border-l-2 pl-3 text-sm leading-relaxed text-ivory"
                  style={{ borderColor: a.color || "oklch(0.82 0.132 87)" }}
                >
                  {a.text}
                </p>
              ) : null}
              {a.note ? (
                <p className="mt-2 text-sm italic leading-relaxed text-muted-foreground">{a.note}</p>
              ) : null}

              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs text-gold/90">{titles[a.bookId] ?? "Removed book"}</p>
                  {a.label ? (
                    <p className="truncate text-[11px] text-muted-foreground">{a.label}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {titles[a.bookId] ? (
                    <button
                      type="button"
                      onClick={() => {
                        void navigate({
                          to: "/read/$bookId",
                          params: { bookId: a.bookId },
                        });
                      }}
                      className="rounded-full border border-gold/30 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-gold"
                    >
                      Open
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Delete annotation"
                    onClick={async () => {
                      await deleteAnnotation(a.id);
                      await qc.invalidateQueries({ queryKey: ["annotations"] });
                      toast.success("Annotation removed");
                    }}
                    className="text-destructive/70"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
