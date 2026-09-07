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
