/**
 * Serves the downloadable `extended` dictionary pack as a plain static file.
 *
 * Its own service rather than a route on `apps/server`, deliberately: the pack
 * is a ~26 MB binary, tRPC is the wrong transport for one, and keeping it off
 * the API is what lets a reader still install the dictionary while the API is
 * down. `EXPO_PUBLIC_DICTIONARY_PACK_URL` points at this host.
 *
 * Zero dependencies, and no `packages/env` schema: the whole service is this
 * file and two variables the platform supplies, so the runtime image carries
 * no `node_modules` at all. The pack itself is built into the image by the
 * Dockerfile — nothing is fetched or written at runtime.
 */

/** Where the Dockerfile put the pack. Relative for `bun run dev` from here. */
const PACK_FILE = process.env.PACK_FILE ?? "pack/dictionary-extended.db";

/** The public path. Changing it changes EXPO_PUBLIC_DICTIONARY_PACK_URL. */
const PACK_PATH = "/dictionary-extended.db";

const pack = Bun.file(PACK_FILE);

const server = Bun.serve({
  // Railway injects PORT. 3334 sits next to the API's 3333 for local runs.
  port: process.env.PORT ?? 3334,

  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === PACK_PATH) {
      // A build that somehow shipped without the pack should say so, rather
      // than hand the app a 404 it would report as a failed download.
      if (!(await pack.exists())) {
        return new Response("The dictionary pack is missing from this deploy.\n", { status: 503 });
      }

      return new Response(pack, {
        headers: {
          "content-type": "application/vnd.sqlite3",
          // Set explicitly because the app's install progress bar is driven by
          // it: expo-file-system reports `totalBytes` straight from this
          // header, and a response without one leaves the bar at zero for the
          // whole download.
          "content-length": String(pack.size),
          // The pack is pinned to a WordNet edition and only ever replaced by
          // a new deploy, so it is safe to treat as permanent.
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }

    // The health check, and something legible for anyone who opens the host.
    if (pathname === "/") {
      return new Response(`GlossNote dictionary pack: ${PACK_PATH}\n`);
    }

    return new Response("Not found\n", { status: 404 });
  },
});

console.log(`Dictionary pack host listening on ${server.url}`);
