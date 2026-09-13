import type { SQLiteDatabase } from "expo-sqlite";

import { getAppSetting, setAppSetting } from "./app-settings";

/**
 * Whether this device has been through the onboarding tour.
 *
 * Per *install*, not per account: it lives in `app_setting` beside the
 * dictionary pack's own row rather than in `user_preference`. Two reasons —
 * the tour runs before the first query of the session, so waiting on a server
 * round trip would hold the app on a spinner; and a reader who signs in on a
 * second phone is new to that phone's gestures, so the account is the wrong
 * thing to key it on. Signing out and back in on the same phone does not bring
 * it back, which is the intent.
 */
const SEEN_KEY = "onboarding.seen";

/** The query key the root layout gates on — invalidate it after marking. */
export const ONBOARDING_QUERY_KEY = ["onboarding-seen"];

export async function hasSeenOnboarding(db: SQLiteDatabase): Promise<boolean> {
  return (await getAppSetting(db, SEEN_KEY)) === "1";
}

/** Called by both the Skip link and the last step — skipping counts as seen. */
export async function markOnboardingSeen(db: SQLiteDatabase): Promise<void> {
  await setAppSetting(db, SEEN_KEY, "1");
}
