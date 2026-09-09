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
});
