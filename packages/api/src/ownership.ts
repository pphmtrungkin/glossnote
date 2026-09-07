import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * "This row is mine."
 *
 * Every mutation on a user-owned row scopes by (id, userId) rather than by id
 * alone, so a caller cannot touch another user's row by guessing an id. The
 * predicate was previously written out at each call site, which left two of
 * them — both `delete` procedures — reporting success without ever checking
 * whether a row matched.
 */
export function ownedBy(
  table: { id: AnyPgColumn; userId: AnyPgColumn },
  id: string,
  userId: string,
) {
  return and(eq(table.id, id), eq(table.userId, userId));
}

/**
 * Turns an empty `.returning()` into the same 404 an unowned read gives.
 *
 * Deliberately NOT_FOUND rather than FORBIDDEN: a caller has no business
 * learning that a row exists but belongs to someone else.
 */
export function assertOwned<T>(row: T | undefined, label: string): T {
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `${label} not found` });
  return row;
}
