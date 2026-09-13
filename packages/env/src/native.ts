import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "EXPO_PUBLIC_",
  client: {
    EXPO_PUBLIC_SERVER_URL: z.url(),
    /**
     * Where the downloadable `extended` dictionary pack is hosted — a plain
     * static `.db` file built by `scripts/build-dictionary-db.ts extended`.
     *
     * Deliberately not served by `apps/server`: it is a large binary, tRPC is
     * the wrong transport for one, and a static host keeps the download
     * working when the API is down. Optional — without it the settings screen
     * says the pack is unavailable rather than offering a dead button.
     */
    EXPO_PUBLIC_DICTIONARY_PACK_URL: z.url().optional(),
  },
  runtimeEnv: {
    EXPO_PUBLIC_SERVER_URL: process.env.EXPO_PUBLIC_SERVER_URL,
    EXPO_PUBLIC_DICTIONARY_PACK_URL: process.env.EXPO_PUBLIC_DICTIONARY_PACK_URL,
  },
  emptyStringAsUndefined: true,
  /**
   * There is no `server` block here, so the server/client split this flag
   * drives has nothing to split: the validated schema is the `client` one
   * either way. All it still does is arm t3-env's access guard, which throws
   * "Attempted to access a server-side environment variable on the client" on
   * *any* unprefixed property read of the proxy — including the stray probes
   * React Native's dev tooling makes (`prototype`, `displayName`, `default`),
   * which is an explosion with no stack pointing anywhere useful. Nothing is
   * being protected: server variables live in `./server`, and TypeScript
   * already rejects an unknown key at the call site.
   *
   * Keep this in step with the file — a `server` block added here would need
   * the flag gone, and would belong in `./server` anyway.
   */
  isServer: true,
});
