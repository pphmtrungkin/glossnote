import { useQueryClient } from "@tanstack/react-query";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback } from "react";

import { ONBOARDING_QUERY_KEY, markOnboardingSeen } from "@/lib/onboarding";

/**
 * Ends the tour: stamp the device, then tell the root layout to re-read it.
 *
 * The write and the invalidate are paired here because doing only the first
 * leaves the reader on a tour the guard still says they need, and doing only
 * the second brings the tour back on the next launch. Three call sites (Skip,
 * the last step with no dictionary to offer, and the dictionary screen's two
 * exits) would otherwise each have to remember both halves.
 */
export function useFinishOnboarding() {
  const db = useSQLiteContext();
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await markOnboardingSeen(db);
    await queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
  }, [db, queryClient]);
}
