import type { CaptureMethod } from "@better-vocab/domain";
import { TRPCClientError } from "@trpc/client";
import type { SQLiteDatabase } from "expo-sqlite";

import { trpcClient } from "@/utils/trpc";

/**
 * The device half of offline capture.
 *
 * `word.createMany` on the server was built as the flush endpoint for this
 * queue: it reports each capture as `saved` or `dropped` rather than failing
 * the batch, so one folder deleted on another device cannot strand every other
 * queued word behind it. Both outcomes are final — the row is deleted either
 * way. A *thrown* call means the queue survives untouched and the next
 * reconnect tries again.
 */

/** Exactly what `word.create` accepts, which is what the queue has to replay. */
export type Capture = {
  folderId: string;
  term: string;
  definition?: string;
  captureMethod: CaptureMethod;
  page?: number;
};

type QueuedRow = {
  local_id: string;
  folder_id: string;
  term: string;
  definition: string | null;
  capture_method: string;
  page: number | null;
};

/** Matches the server's own FLUSH_LIMIT — a larger batch would be rejected. */
const FLUSH_LIMIT = 100;

/**
 * Did this call fail because it never arrived, rather than because the server
 * refused it?
 *
 * A tRPC error raised by a procedure carries `data` (the error code, the HTTP
 * status); a fetch that never completed carries none. Only the second kind is
 * worth queueing — a `NOT_FOUND` would be queued forever.
 */
export function isOfflineError(error: unknown) {
  return error instanceof TRPCClientError && error.data == null;
}

/**
 * Device-local key for a queued row. Not a UUID: it never leaves this device
 * (the server echoes it back untouched and stores nothing), so it only has to
 * be unique in one SQLite table.
 */
function localId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueCapture(db: SQLiteDatabase, capture: Capture) {
  await db.runAsync(
    `INSERT INTO pending_sync
       (local_id, folder_id, term, definition, definition_source, capture_method, page, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    localId(),
    capture.folderId,
    capture.term,
    capture.definition ?? null,
    // Write-only: `word.create` takes no source, so the flush never sends it.
    // A definition resolved while offline can only have come off the device.
    "bundled",
    capture.captureMethod,
    capture.page ?? null,
    Date.now(),
  );
}

export async function countPendingCaptures(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count FROM pending_sync`,
  );
  return row?.count ?? 0;
}

/**
 * Sends the queue to the server, oldest first, and deletes every row the
 * server accounted for.
 *
 * Loops because the queue may hold more than one batch, and stops the moment a
 * batch accounts for nothing — a flush that deleted no rows would otherwise
 * read the same page forever.
 */
export async function flushPendingCaptures(db: SQLiteDatabase) {
  let saved = 0;
  let dropped = 0;

  for (;;) {
    const rows = await db.getAllAsync<QueuedRow>(
      `SELECT local_id, folder_id, term, definition, capture_method, page
         FROM pending_sync
        ORDER BY created_at
        LIMIT ?`,
      FLUSH_LIMIT,
    );
    if (rows.length === 0) break;

    const results = await trpcClient.word.createMany.mutate({
      captures: rows.map((row) => ({
        localId: row.local_id,
        folderId: row.folder_id,
        term: row.term,
        definition: row.definition ?? undefined,
        captureMethod: row.capture_method as CaptureMethod,
        page: row.page ?? undefined,
      })),
    });

    const accounted = results.map((result) => result.localId);
    if (accounted.length === 0) break;

    await db.runAsync(
      `DELETE FROM pending_sync WHERE local_id IN (${accounted.map(() => "?").join(", ")})`,
      accounted,
    );

    saved += results.filter((result) => result.status === "saved").length;
    dropped += results.filter((result) => result.status === "dropped").length;

    if (rows.length < FLUSH_LIMIT) break;
  }

  return { saved, dropped };
}
