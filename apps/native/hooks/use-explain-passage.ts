import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";

import { type PassageNote, readPassageNote, savePassageNote } from "@/lib/passage";
import { trpcClient } from "@/utils/trpc";

/**
 * "What does this actually say?" — the one path into context mode, the way
 * `useCaptureWord` is the one path into a save.
 *
 * Device first, then the server: an explanation already on this phone is
 * returned without a call, which is what makes re-reading a passage free and
 * makes the history usable offline. Only a passage never asked about before
 * reaches `passage.explain`, and the answer is written straight back.
 *
 * Unlike a capture there is no offline queue. A definition is worth resolving
 * late because the word is already saved and the reader will see it again; an
 * explanation the reader has stopped waiting for helps nobody, and queueing it
 * would spend a call on a page they have long since turned.
 */
export const PASSAGE_NOTES_KEY = ["passage-notes"] as const;

export function useExplainPassage(options: { folderId?: string } = {}) {
  const db = useSQLiteContext();
  const queryClient = useQueryClient();

  return useMutation<PassageNote, Error, string>({
    mutationFn: async (passage) => {
      const trimmed = passage.trim();

      const cached = await readPassageNote(db, trimmed);
      if (cached) return cached;

      const explanation = await trpcClient.passage.explain.mutate({
        passage: trimmed,
        folderId: options.folderId,
      });

      const note: PassageNote = {
        passage: trimmed,
        folderId: options.folderId ?? null,
        plain: explanation.plain,
        notes: explanation.notes,
        createdAt: Date.now(),
      };
      await savePassageNote(db, note);
      return note;
    },
    // The history list below the field is a query over the same table, so it
    // has to be told the table moved. Nothing on the server changed, so no
    // tRPC key is touched.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PASSAGE_NOTES_KEY }),
  });
}
