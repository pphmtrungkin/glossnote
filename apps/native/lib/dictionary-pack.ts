import { env } from "@better-vocab/env/native";
import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import type { SQLiteDatabase } from "expo-sqlite";

import { getAppSetting, setAppSetting } from "./app-settings";

/**
 * The two dictionary tiers that arrive as a pre-built SQLite file: the `core`
 * set bundled in the app binary, and the `extended` pack downloaded on demand.
 *
 * Both are built by `scripts/build-dictionary-db.ts`, which stamps the tier on
 * every row — that is what lets the merge be one `INSERT ... SELECT` rather
 * than parsing rows in JS, and why both share `mergeFrom` below.
 *
 * The extended download needs a connection; nothing else here does. Once
 * merged, the rows sit in the same local table `readLocalDefinition` already
 * reads, so offline lookups pick them up with no further wiring.
 *
 * A note on why the bundled core is *merged* rather than handed to
 * `SQLiteProvider` as an `assetSource`: the asset carries only the `dictionary`
 * table, but its `user_version = 3` makes `migrateLocalDb` return early — so a
 * device that opened the asset directly would have no `app_setting` or
 * `pending_sync` table, and the first theme save would throw. Merging costs one
 * copy of the rows and keeps `local-db.ts` the only owner of the schema.
 */

/** Where the pack lands while it downloads. Cache, because it is deleted after
 *  the merge — only the merged rows are worth keeping. */
const PACK_FILE_NAME = "dictionary-extended.db";

/** The install record, so the settings screen can report size without a scan.
 *  `count(*) where source = 'extended'` cannot use the (term, source, rank)
 *  index — source isn't its prefix — so it would be a full table scan. */
const PACK_SETTING_KEY = "dictionary.extended";

export type PackInstall = { rows: number; bytes: number; installedAt: number };

/** Null when the pack isn't installed. */
export async function readPackInstall(db: SQLiteDatabase): Promise<PackInstall | null> {
  const raw = await getAppSetting(db, PACK_SETTING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PackInstall;
  } catch {
    // A record we can't read is the same as no record: the rows may still be
    // there, and removePack() clears both.
    return null;
  }
}

/** Whether a pack is configured to be downloadable at all. */
export const packUrl = env.EXPO_PUBLIC_DICTIONARY_PACK_URL;

export type DownloadProgress = { bytesWritten: number; totalBytes: number };

/**
 * Downloads the pack and merges it into the local dictionary.
 *
 * Resolves to the install record. Throws on a failed download or a malformed
 * pack — the caller renders that, since the reader chose to start this.
 */
export async function installPack(
  db: SQLiteDatabase,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<PackInstall> {
  if (!packUrl) throw new Error("No dictionary pack is configured for this build.");

  const destination = new Directory(Paths.cache, "dictionary");
  if (!destination.exists) destination.create();

  const target = new File(destination, PACK_FILE_NAME);
  // A pack left behind by an interrupted run would make downloadFileAsync
  // pick a new name rather than overwrite.
  if (target.exists) target.delete();

  const task = File.createDownloadTask(packUrl, target, {
    onProgress: onProgress
      ? ({ bytesWritten, totalBytes }) => onProgress({ bytesWritten, totalBytes })
      : undefined,
  });
  const downloaded = await task.downloadAsync();
  if (!downloaded) throw new Error("The download did not finish.");

  const bytes = downloaded.size ?? 0;

  try {
    const rows = await mergeFrom(db, downloaded.uri, "extended");
    const install: PackInstall = { rows, bytes, installedAt: Date.now() };
    await setAppSetting(db, PACK_SETTING_KEY, JSON.stringify(install));
    return install;
  } finally {
    // The merged rows are the artifact; the file is a courier. Deleting it
    // even on failure keeps a half-downloaded pack from occupying the cache
    // until the OS decides to reclaim it.
    if (downloaded.exists) downloaded.delete();
  }
}

/**
 * Copies every row out of a pre-built dictionary file into the live table.
 *
 * ATTACH runs outside a transaction — SQLite refuses it inside one — while the
 * INSERT is a single statement, so its implicit transaction covers all
 * hundred-thousand-odd rows: the merge either lands whole or not at all.
 * `INSERT OR IGNORE` against the (term, source, rank) unique index is what
 * makes a re-run idempotent rather than a duplicate-key failure.
 *
 * Returns how many rows the source held.
 */
async function mergeFrom(
  db: SQLiteDatabase,
  fileUri: string,
  tier: "core" | "extended",
): Promise<number> {
  // SQLite wants a filesystem path, not a file:// URI.
  const path = decodeURIComponent(fileUri.replace(/^file:\/\//, ""));

  await db.runAsync("ATTACH DATABASE ? AS pack", path);
  try {
    // Column list rather than SELECT *, so a future column added to the local
    // table doesn't silently shift the source's values into the wrong ones.
    // The tier is written here rather than taken from the file, so a pack
    // built with the wrong mode can't file itself under another tier.
    await db.runAsync(
      `INSERT OR IGNORE INTO dictionary (term, definition, part_of_speech, example_sentence, source, rank)
       SELECT term, definition, part_of_speech, example_sentence, ?, rank FROM pack.dictionary`,
      tier,
    );
    const row = await db.getFirstAsync<{ rows: number }>(
      "SELECT count(*) AS rows FROM pack.dictionary",
    );
    return row?.rows ?? 0;
  } finally {
    await db.runAsync("DETACH DATABASE pack");
  }
}

/** Set once the bundled core set has been merged, so a ~75k-row copy doesn't
 *  run on every launch. The merge is idempotent; this only saves the work. */
const CORE_SETTING_KEY = "dictionary.core";

/**
 * Merges the bundled core dictionary, once, on first launch.
 *
 * Called from `SQLiteProvider`'s `onInit` after the schema migration, so the
 * `dictionary` table exists by the time the rows arrive. A failure here is
 * swallowed: an app that cannot open its bundled asset should still start, and
 * the online tier still resolves definitions.
 */
export async function installBundledCore(db: SQLiteDatabase): Promise<void> {
  if (await getAppSetting(db, CORE_SETTING_KEY)) return;

  try {
    // Bundled assets live inside the APK on Android; downloadAsync is what
    // gives them a real filesystem path SQLite can ATTACH.
    const asset = Asset.fromModule(require("../assets/dictionary/core.db"));
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error("The bundled dictionary has no local path.");

    const rows = await mergeFrom(db, asset.localUri, "core");
    await setAppSetting(db, CORE_SETTING_KEY, String(rows));
  } catch (error) {
    console.warn("Could not install the bundled dictionary:", error);
  }
}

/**
 * Gives the storage back.
 *
 * A DELETE rather than a DROP TABLE, which is the whole reason the three tiers
 * were collapsed into one table (see local-db.ts): the reader's own cached
 * lookups and the bundled core rows live alongside these and must survive.
 */
export async function removePack(db: SQLiteDatabase): Promise<void> {
  await db.runAsync("DELETE FROM dictionary WHERE source = 'extended'");
  await setAppSetting(db, PACK_SETTING_KEY, "");
}

/** "48.2 MB" — for a size the reader is deciding whether to spend. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
