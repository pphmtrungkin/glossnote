import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

/**
 * Every shelf, with its linked book and word count.
 *
 * `folder.list` fetches `with: { book: true }`, but that relation doesn't
 * survive Drizzle's inference into the router's output type. `db:smoke` is what
 * actually pins the runtime shape, asserting the joined book on every run — so
 * the narrowing happens once here rather than at each of the four screens that
 * read a folder.
 */
export type FolderRow = {
  id: string;
  title: string;
  status: "reading" | "finished" | "misc";
  visibility: "private" | "public";
  bookId: string | null;
  currentPage: number | null;
  wordCount: number;
  book: { title: string; authors: string[]; coverImageUrl: string | null; pages: number | null } | null;
};

export function useFolders() {
  const query = useQuery(trpc.folder.list.queryOptions());
  return { ...query, data: query.data as FolderRow[] | undefined };
}
