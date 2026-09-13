import { useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect } from "react";

import { useIsOnline } from "@/hooks/use-is-online";
import { flushPendingCaptures } from "@/lib/pending-sync";

/**
 * Drains the offline capture queue whenever the device has a connection.
 *
 * Mounted once, high in the tree, and gated on a session: a flush is a
 * `protectedProcedure` call, and queued words belong to whoever is signed in
 * when they sync. `useIsOnline` re-renders on every connectivity change, so
 * regaining a connection is what triggers the effect — there is no polling and
 * no timer.
 *
 * Failures are deliberately silent. A flush that cannot reach the server leaves
 * the queue exactly as it was, and the reader did not ask for this to happen
 * now — a toast about a background retry would be noise.
 */
export function usePendingSync(isEnabled: boolean) {
  const db = useSQLiteContext();
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();

  useEffect(() => {
    if (!isEnabled || !isOnline) return;

    let isCancelled = false;
    flushPendingCaptures(db)
      .then(({ saved }) => {
        // Words that landed are in none of the caches the screens are showing.
        if (saved > 0 && !isCancelled) queryClient.invalidateQueries();
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, [isEnabled, isOnline, db, queryClient]);
}
