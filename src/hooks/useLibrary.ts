import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  allAnnotations,
  deleteBook,
  getCover,
  listBooks,
  updateBook,
  type BookMeta,
} from "@/lib/db";

const isClient = typeof window !== "undefined";

export function useBooks() {
  return useQuery({
    queryKey: ["books"],
    queryFn: listBooks,
    enabled: isClient,
    initialData: [] as BookMeta[],
  });
}

export function useAnnotations() {
  return useQuery({
    queryKey: ["annotations"],
    queryFn: allAnnotations,
    enabled: isClient,
    initialData: [],
  });
}

export function useBookMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["books"] });
    qc.invalidateQueries({ queryKey: ["annotations"] });
  };
  const save = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<BookMeta> }) => updateBook(id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteBook(id),
    onSuccess: invalidate,
  });
  return { save, remove, invalidate };
}

const urlCache = new Map<string, string>();

export function useCoverUrl(book: Pick<BookMeta, "id" | "hasCover"> | undefined) {
  const [url, setUrl] = useState<string | null>(() =>
    book ? (urlCache.get(book.id) ?? null) : null,
  );

  useEffect(() => {
    if (!book?.hasCover) {
      setUrl(null);
      return;
    }
    const cached = urlCache.get(book.id);
    if (cached) {
      setUrl(cached);
      return;
    }
    let alive = true;
    getCover(book.id).then((blob) => {
      if (!alive || !blob) return;
      const next = URL.createObjectURL(blob);
      urlCache.set(book.id, next);
      setUrl(next);
    });
    return () => {
      alive = false;
    };
  }, [book?.id, book?.hasCover]);

  return url;
}
