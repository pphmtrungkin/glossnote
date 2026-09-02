import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Thin key/value accessors over the `app_setting` table (see local-db.ts).
 * Reads are tolerant of a missing table so a device that hasn't run the v2
 * migration yet falls back to defaults instead of crashing at startup.
 */
export async function getAppSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_setting WHERE key = ?",
      key,
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function setAppSetting(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync(
    "INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}
