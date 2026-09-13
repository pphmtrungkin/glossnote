import { TRPCError } from "@trpc/server";

import { t } from "./index";

/**
 * Per-caller request budgets for the procedures that spend someone else's
 * quota.
 *
 * Better Auth rate-limits its own endpoints (see packages/auth), but tRPC
 * procedures are ours to guard. Only two need it, and for the same reason:
 * `book.search` and `dictionary.lookup` are proxies onto external APIs with
 * hard ceilings — Hardcover allows 60 requests a minute across the whole
 * token, and one client in a retry loop would spend that on everybody's
 * behalf. The limit is per user rather than per IP because these are
 * `protectedProcedure`s: a session is the thing we can actually attribute a
 * request to.
 *
 * ponytail: in-process counters, so the budget is per server instance and
 * resets on deploy. That is the right trade at one instance — a Postgres table
 * would add a write to every read path. Move it to the database (or Redis) the
 * day this runs behind more than one process.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Above this many tracked callers, drop the expired entries. */
const PRUNE_THRESHOLD = 10_000;

function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(options: { name: string; max: number; windowSeconds: number }) {
  const windowMs = options.windowSeconds * 1000;

  return t.middleware(({ ctx, next }) => {
    // Unauthenticated callers share one bucket. No procedure using this is
    // public today, so this is a floor rather than a policy.
    const key = `${options.name}:${ctx.session?.user.id ?? "anonymous"}`;
    const now = Date.now();

    if (buckets.size > PRUNE_THRESHOLD) prune(now);

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many requests. Try again in ${Math.ceil((bucket.resetAt - now) / 1000)}s.`,
      });
    }

    return next();
  });
}

/** Exported for the smoke test, which has to start from a known count. */
export function resetRateLimits() {
  buckets.clear();
}
