import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Coerced because env vars are always strings. Default 3333 rather than
    // Bun's implicit 3000, which collides with just about every other dev
    // server; keep it in sync with BETTER_AUTH_URL and the native app's
    // EXPO_PUBLIC_SERVER_URL, which must point at this same port.
    PORT: z.coerce.number().int().positive().default(3333),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    // Hardcover personal access token, for book search. Server-only by their
    // rules, not just ours: "Queries are not allowed to run in the browser,
    // they must be run in an environment where the token can be kept secure."
    // Optional so the app still boots without one — book.search reports a
    // clean "not configured" instead of failing at import time.
    HARDCOVER_API_TOKEN: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
