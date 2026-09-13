import { db } from "@better-vocab/db";
import { book } from "@better-vocab/db/schema/book";
import { env } from "@better-vocab/env/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { rateLimit } from "../rate-limit";

const HARDCOVER_ENDPOINT = "https://api.hardcover.app/v1/graphql";

// `provider` is free text on the book table (see schema/book.ts) — this is the
// one value we write today, and (provider, external_id) is uniquely indexed.
export const HARDCOVER_PROVIDER = "hardcover";

// Hardcover allows at most ONE `search` query per request, so this is a single
// top-level field and nothing may be batched alongside it.
const SEARCH_QUERY = `
  query SearchBooks($query: String!, $perPage: Int!) {
    search(query: $query, query_type: "Book", per_page: $perPage, page: 1) {
      results
    }
  }
`;

// `results` is the raw Typesense payload, typed as an untyped JSON scalar in
// Hardcover's schema. Parsed loosely on purpose: their docs list the indexed
// fields but not the JSON shape, and the index gains fields over time — an
// exact schema would break on their deploys, not ours. `image` in particular
// is NOT in the documented book field list, so it is treated as optional
// rather than assumed.
const hitSchema = z.object({
  document: z.looseObject({
    id: z.union([z.string(), z.number()]),
    title: z.string(),
    author_names: z.array(z.string()).nullish(),
    // A book with no cover comes back as `image: {}` — the key is present and
    // the object is empty, not null. So `url` has to be optional *inside* the
    // object as well: requiring it here rejected the whole response over one
    // coverless hit, and searches like "1984" or "the" always contain a few.
    image: z.looseObject({ url: z.string().nullish() }).nullish(),
    description: z.string().nullish(),
    release_year: z.number().nullish(),
  }),
});

// `hits` is required, not optional: Typesense always returns it, so a payload
// without one means the response is not what we think it is. Accepting it as
// missing would turn "Hardcover changed their API" into a silent "no matches".
const resultsSchema = z.looseObject({ hits: z.array(hitSchema) });

/**
 * Turns Hardcover's raw Typesense payload into the shape the client picks from.
 * Split out from the procedure so the mapping — the part that actually breaks
 * when their index changes — is testable without a token or a network call.
 *
 * Throws rather than returning [] on an unrecognised payload: a silent empty
 * result list looks identical to "no matches" and would hide a broken client.
 */
export function mapSearchResults(results: unknown) {
  const parsed = resultsSchema.safeParse(results);
  if (!parsed.success) {
    // Surface a slice of what actually came back.
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Unexpected search response from Hardcover: ${JSON.stringify(results).slice(0, 300)}`,
    });
  }

  return parsed.data.hits.map(({ document }) => ({
    externalId: String(document.id),
    title: document.title,
    authors: document.author_names ?? [],
    coverImageUrl: document.image?.url ?? null,
    description: document.description ?? null,
    releaseYear: document.release_year ?? null,
  }));
}

// Shared by book.search's output and folder.create's input: the client hands
// back the hit it picked, and the server upserts it. Deliberately not a
// `bookId` — that would be an unvalidated foreign key straight from a client.
export const bookInputSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  coverImageUrl: z.string().nullish(),
  description: z.string().nullish(),
});

export type BookInput = z.infer<typeof bookInputSchema>;

/**
 * Upserts the picked search result and returns its local book id.
 *
 * Conflict target is (provider, external_id), so re-picking the same book from
 * search never creates a second row — every reader of Dune points at one book
 * row, which is what makes the crowdsourced aggregate group correctly.
 */
export async function upsertBook(input: BookInput): Promise<string> {
  const [row] = await db
    .insert(book)
    .values({
      provider: HARDCOVER_PROVIDER,
      externalId: input.externalId,
      title: input.title,
      authors: input.authors,
      coverImageUrl: input.coverImageUrl ?? null,
      description: input.description ?? null,
    })
    .onConflictDoUpdate({
      target: [book.provider, book.externalId],
      // Refresh the metadata rather than DO NOTHING: covers and descriptions
      // get filled in on Hardcover's side after a book is first indexed.
      set: {
        title: input.title,
        authors: input.authors,
        coverImageUrl: input.coverImageUrl ?? null,
        description: input.description ?? null,
      },
    })
    .returning({ id: book.id });

  return row.id;
}

export const bookRouter = router({
  // Proxied through the server, never called from the app directly: Hardcover
  // requires the token stay out of the client, and SoftwareSpec §8.1 says the
  // same about every third-party key.
  search: protectedProcedure
    // Hardcover allows 60 requests a minute for the whole token, shared by
    // every reader. The client debounces, so a real search costs one request
    // per typed phrase; this is the ceiling for a client that stops.
    .use(rateLimit({ name: "book.search", max: 20, windowSeconds: 60 }))
    .input(z.object({ query: z.string().trim().min(2), limit: z.number().int().min(1).max(25).default(10) }))
    .query(async ({ input }) => {
      if (!env.HARDCOVER_API_TOKEN) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Book search is unavailable: HARDCOVER_API_TOKEN is not set on the server.",
        });
      }

      const response = await fetch(HARDCOVER_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.HARDCOVER_API_TOKEN}`,
        },
        body: JSON.stringify({
          query: SEARCH_QUERY,
          variables: { query: input.query, perPage: input.limit },
        }),
      });

      if (response.status === 429) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Book search is rate limited — try again shortly." });
      }
      if (!response.ok) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `Book search failed (${response.status} ${response.statusText}).`,
        });
      }

      const payload = (await response.json()) as {
        data?: { search?: { results?: unknown } };
        errors?: { message: string }[];
      };

      // GraphQL reports failures with HTTP 200 and an `errors` array.
      if (payload.errors?.length) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: `Book search failed: ${payload.errors[0].message}` });
      }

      return mapSearchResults(payload.data?.search?.results);
    }),
});
