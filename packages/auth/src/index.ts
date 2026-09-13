import { expo } from "@better-auth/expo";
import { db as defaultDb } from "@better-vocab/db";
import * as schema from "@better-vocab/db/schema/auth";
import { env } from "@better-vocab/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// Takes the connection rather than opening one. `createDb()` used to be
// called a second time here, so every server process held two Postgres pools
// that shared nothing — one for tRPC, one for Better Auth's adapter.
export function createAuth(db: typeof defaultDb = defaultDb) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,

      "glossnote://",
      "exp://",
      "http://localhost:8081",
    ],
    emailAndPassword: {
      enabled: true,
    },
    user: {
      // UserFlow §8: "manage account (email, password, delete account)".
      // Off by default in Better Auth, so without this the settings screen has
      // nothing to call. Every domain table references `user.id` with
      // `onDelete: "cascade"`, so removing the row takes the folders, words and
      // preferences with it — captures already contributed to the crowdsourced
      // counts disappear from those counts too, which is the correct reading of
      // "delete my data".
      //
      // No `sendDeleteAccountVerification`: that path needs an email sender,
      // and this app has none. Better Auth's other two gates cover us — the
      // caller must pass their current password, or hold a session fresher
      // than `freshAge` (1 day). Changing an *email* is the one account action
      // still missing for the same reason: it cannot complete without a
      // verification mail.
      deleteUser: { enabled: true },
    },
    // Better Auth defaults `enabled` to `isProduction`, which reads NODE_ENV
    // — and this app's own env schema defaults NODE_ENV to "development". A
    // deploy that forgets to set it would therefore run with no rate limiting
    // at all, silently. Enabled unconditionally instead: the cost in dev is
    // that hammering sign-in from a test script gets throttled, which is the
    // behaviour we want to be able to see.
    //
    // 1.7.1 already ships stricter built-in rules for /sign-in, /sign-up,
    // /change-password and /change-email (3 per 10s) — the window and max
    // here are the floor for everything else, and the custom rule covers the
    // one destructive endpoint the defaults miss.
    //
    // ponytail: memory storage, so the counters are per process and reset on
    // deploy. `storage: "database"` is the upgrade when this runs on more than
    // one instance — it needs a generated migration for Better Auth's own
    // rateLimit table.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        // Deleting an account cascades every folder, word and preference. One
        // caller has no legitimate reason to ask more than a few times.
        "/delete-user": { window: 3600, max: 5 },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [expo()],
  });
}

export const auth = createAuth();
