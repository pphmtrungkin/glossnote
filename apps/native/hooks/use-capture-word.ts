import { useMutation } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";

import { enqueueCapture, isOfflineError, type Capture } from "@/lib/pending-sync";
import { trpcClient } from "@/utils/trpc";

/**
 * "Save this word" — the one capture path, whether or not there is a network.
 *
 * Both capture sites (the add-word form and a tapped suggestion on the shelf)
 * go through this, so the offline fallback cannot be wired on one and forgotten
 * on the other. A failure that never reached the server is queued in
 * `pending_sync` and reported as `queued`; anything the server actually refused
 * still throws, because a `NOT_FOUND` folder is not a connectivity problem.
 */
export type CaptureOutcome = { status: "saved"; wordId: string } | { status: "queued" };

export function useCaptureWord(options: {
  onSettled?: (outcome: CaptureOutcome) => unknown;
  onError?: (error: Error) => unknown;
} = {}) {
  const db = useSQLiteContext();

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
    onSuccess: options.onSettled,
    onError: options.onError,
  });
}
