import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";

import { enqueueCapture, isOfflineError, type Capture } from "@/lib/pending-sync";
import { trpc, trpcClient } from "@/utils/trpc";

/**
 * "Save this word" — the one capture path, whether or not there is a network.
 *
 * Every capture goes through this — today that is the add-word form — so the
 * offline fallback and the refresh below cannot be wired on one path and
 * forgotten on another. A failure that never reached the server is queued in
 * `pending_sync` and reported as `queued`; anything the server actually refused
 * still throws, because a `NOT_FOUND` folder is not a connectivity problem.
 *
 * Saving also invalidates everything a new word changes, which is what makes
 * the other tabs catch up on their own rather than waiting for a pull to
 * refresh. Home reads two of them: `folder.list` for the shelf's word count,
 * and `word.quiz` for "Due today" — though a word only becomes a card once the
 * server has resolved its definition and written usage contexts, so a word
 * still waiting on one moves the count without joining the list.
 */
export type CaptureOutcome = { status: "saved"; wordId: string } | { status: "queued" };

export function useCaptureWord(options: {
  onSettled?: (outcome: CaptureOutcome) => unknown;
  onError?: (error: Error) => unknown;
} = {}) {
  const db = useSQLiteContext();
  const queryClient = useQueryClient();

  return useMutation<CaptureOutcome, Error, Capture>({
    mutationFn: async (capture) => {
      try {
        const saved = await trpcClient.word.create.mutate(capture);
        return { status: "saved", wordId: saved.id };
      } catch (error) {
        if (!isOfflineError(error)) throw error;
        await enqueueCapture(db, capture);
        return { status: "queued" };
      }
    },
    onSuccess: (outcome, capture) => {
      // A queued capture is not on the server yet, so a refetch would find
      // nothing new; the flush refreshes when it lands.
      if (outcome.status === "saved") {
        queryClient.invalidateQueries({
          queryKey: trpc.word.listByFolder.queryKey({ folderId: capture.folderId }),
        });
        queryClient.invalidateQueries({ queryKey: trpc.word.suggestions.queryKey() });
        queryClient.invalidateQueries({
          queryKey: trpc.word.topicWords.queryKey({ folderId: capture.folderId }),
        });
        // What home shows: the shelf's count and its progress, and the review
        // queue behind "Due today".
        queryClient.invalidateQueries({ queryKey: trpc.folder.list.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.word.quiz.queryKey() });
      }
      return options.onSettled?.(outcome);
    },
    onError: options.onError,
  });
}
