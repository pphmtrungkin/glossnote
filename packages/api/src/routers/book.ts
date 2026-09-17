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
  query SearchBooks($query: String!, $perPage: Int!, $page: Int!) {
    search(query: $query, query_type: "Book", per_page: $perPage, page: $page) {
      results
    }
  }
`;

// An ISBN is resolved through `editions`, never through `search`. Typesense
// matches fuzzily: asked for 9780441294671 it returned a book whose own `isbns`
// do not contain that number (probed 2026-09-16, the same trap as Datamuse's
// `sp`). A barcode has to name the edition in the reader's hands, or it is
// worse than typing the title. One `_or` covers both ISBN lengths.
const ISBN_QUERY = `
  query BookByIsbn($isbn: String!) {
    editions(where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] }, limit: 1) {
      pages
      isbn_13
      book {
        id
        title
        description
        release_year
        pages
        image { url }
        contributions { author { name } }
      }
    }
  }
`;

// `results` is the raw Typesense payload, typed as an untyped JSON scalar in
// Hardcover's schema. Parsed loosely on purpose: their docs list the indexed
// fields but not the JSON shape, and the index gains fields over time — an
// exact schema would break on their deploys, not ours.
//
// Hardcover's own `image` is the cover, with openLibraryCoverUrl as the
// fallback for a hit that has none: on 27 measured results Hardcover covered 19
// where Open Library's ISBN links covered 7, and a shelf of blank tiles is the
// thing readers notice first. Hardcover's images are uploaded by its users and
// Hardcover warns that serving them publicly invites copyright claims — Open
// Library is a wiki whose covers are user uploads too, so either way the app
// needs the DMCA takedown policy docs/book-search asks for before it is public.
const hitSchema = z.object({
  document: z.looseObject({
    id: z.union([z.string(), z.number()]),
    title: z.string(),
    author_names: z.array(z.string()).nullish(),
    // Every edition's ISBN, in every language, in no useful order.
    isbns: z.array(z.string()).nullish(),
    description: z.string().nullish(),
    release_year: z.number().nullish(),
    pages: z.number().nullish(),
    // Hardcover's own cover. Loose: the object also carries colour and size
    // fields this doesn't read, and a hit may have no image at all.
    image: z.looseObject({ url: z.string().nullish() }).nullish(),
  }),
});

// `hits` is required, not optional: Typesense always returns it, so a payload
// without one means the response is not what we think it is. Accepting it as
// missing would turn "Hardcover changed their API" into a silent "no matches".
const resultsSchema = z.looseObject({ hits: z.array(hitSchema) });

const editionsSchema = z.looseObject({
  editions: z.array(
    z.looseObject({
      pages: z.number().nullish(),
      isbn_13: z.string().nullish(),
      book: z.looseObject({
        id: z.union([z.string(), z.number()]),
        title: z.string(),
        description: z.string().nullish(),
        release_year: z.number().nullish(),
        pages: z.number().nullish(),
        image: z.looseObject({ url: z.string().nullish() }).nullish(),
        contributions: z
          .array(z.looseObject({ author: z.looseObject({ name: z.string().nullish() }).nullish() }))
          .nullish(),
      }),
    }),
  ),
});

/**
 * The cover links a book row may hold: Hardcover's own asset host, or one
 * openLibraryCoverUrl built. The row is shared by every reader of the book, so
 * an arbitrary URL from one client would be an image shown to all of them.
 */
const OPEN_LIBRARY_COVER = /^https:\/\/covers\.openlibrary\.org\/b\/isbn\/[0-9X]{10,13}-M\.jpg\?default=false$/;
const HARDCOVER_COVER = /^https:\/\/assets\.hardcover\.app\/[^\s"'<>]+$/;
const isSharableCover = (url: string) => HARDCOVER_COVER.test(url) || OPEN_LIBRARY_COVER.test(url);

/** English-language registration groups: 978-0, 978-1 and 979-8, or 0 and 1 for an ISBN-10. */
function isEnglishIsbn(isbn: string) {
  return isbn.length === 13 ? /^978[01]|^9798/.test(isbn) : /^[01]/.test(isbn);
}

/**
 * An Open Library cover link for a Hardcover hit, or null — the fallback for
 * a hit Hardcover has no image of its own for.
 *
 * Hardcover lists every edition's ISBN, so the pick matters: an English
 * edition first (Open Library's covers are mostly English editions), ISBN-13
 * before ISBN-10. Measured on 27 real results on 2026-09-13, this found 7
 * covers where Hardcover's own images had 19, which is why Hardcover's image
 * comes first and this is the fallback.
 *
 * No request is made here. The phone loads the image, so Open Library's ISBN
 * rate limit (100 per 5 minutes per IP) is spent per device, not by the server,
 * and `?default=false` turns a missing cover into a 404 the app falls back on
 * instead of a blank white image.
 *
 * ponytail: first-pick ISBN only. If coverage matters more, resolve an Open
 * Library cover ID by title and author when a book is picked — 10 of 27
 * measured, but ~0.5s per lookup, and it needs an author check: unchecked, it
 * matched Orwell's 1984 to someone else's adaptation.
 */
export function openLibraryCoverUrl(isbns: readonly string[] | null | undefined): string | null {
  const clean = (isbns ?? [])
    .map((isbn) => isbn.replace(/[^0-9X]/gi, "").toUpperCase())
    .filter((isbn) => isbn.length === 10 || isbn.length === 13);
  const isbn =
    clean.find((candidate) => candidate.length === 13 && isEnglishIsbn(candidate)) ??
    clean.find(isEnglishIsbn) ??
    clean.find((candidate) => candidate.length === 13) ??
    clean[0];
  return isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : null;
}

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
    coverImageUrl: document.image?.url ?? openLibraryCoverUrl(document.isbns),
    description: document.description ?? null,
    releaseYear: document.release_year ?? null,
    pages: document.pages ?? null,
  }));
}

/**
 * Turns one Hardcover edition into the same shape a search hit has, so a
 * scanned book travels the folder-creation path a searched one already does.
 *
 * `externalId` is the BOOK's id, not the edition's: a scanned copy and a
 * searched one must upsert to one row on (provider, external_id), or readers of
 * the same book would be split across two rows and the crowdsourced aggregate
 * with them.
 *
 * Returns null for no match — "that barcode isn't in Hardcover" is a state the
 * scanner renders, not an error.
 */
export function mapEdition(data: unknown) {
  const parsed = editionsSchema.safeParse(data);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `Unexpected ISBN response from Hardcover: ${JSON.stringify(data).slice(0, 300)}`,
    });
  }

  const edition = parsed.data.editions[0];
  if (!edition) return null;

  const row = edition.book;
  return {
    externalId: String(row.id),
    title: row.title,
    authors: (row.contributions ?? [])
      .map((contribution) => contribution.author?.name)
      .filter((name): name is string => Boolean(name)),
    coverImageUrl: row.image?.url ?? null,
    description: row.description ?? null,
    releaseYear: row.release_year ?? null,
    // The edition's own count wins: the scan is for the copy in the reader's
    // hands, and that is the number reading progress is scaled against.
    pages: edition.pages ?? row.pages ?? null,
  };
}

/**
 * Digits, and the X an ISBN-10 check digit may be. Anything else never becomes
 * a request — a barcode that is not an ISBN (a UPC off a cereal box) should
 * cost nothing from the shared token.
 */
export function normalizeIsbn(raw: string): string | null {
  const clean = raw.replace(/[^0-9X]/gi, "").toUpperCase();
  return clean.length === 10 || clean.length === 13 ? clean : null;
}

// Shared by book.search's output and folder.create's input: the client hands
// back the hit it picked, and the server upserts it. Deliberately not a
// `bookId` — that would be an unvalidated foreign key straight from a client.
export const bookInputSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  // Only Hardcover's own asset host or an Open Library link the server would
  // build is kept; anything else is stored as no cover rather than failing the
  // folder. See isSharableCover for why the row can't take an arbitrary URL.
  coverImageUrl: z
    .string()
    .nullish()
    .transform((url) => (url && isSharableCover(url) ? url : null)),
  description: z.string().nullish(),
  pages: z.number().int().positive().nullish(),
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
      pages: input.pages ?? null,
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
        pages: input.pages ?? null,
      },
    })
    .returning({ id: book.id });

  return row.id;
}

/**
 * One POST to Hardcover, with the four failures both procedures handle
 * identically: no token, a rate limit, a transport error, and GraphQL's habit
 * of reporting failure with HTTP 200 and an `errors` array.
 */
async function hardcoverRequest<T>(document: string, variables: Record<string, unknown>): Promise<T> {
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
    body: JSON.stringify({ query: document, variables }),
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

  const payload = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (payload.errors?.length) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: `Book search failed: ${payload.errors[0]!.message}` });
  }

  return (payload.data ?? {}) as T;
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
    .input(
      z.object({
        query: z.string().trim().min(2),
        limit: z.number().int().min(1).max(25).default(10),
        // Paging through results, one Hardcover request per page. Capped
        // because a caller walking to page 500 spends the shared token's quota.
        page: z.number().int().min(1).max(20).default(1),
      }),
    )
    .query(async ({ input }) => {
      const data = await hardcoverRequest<{ search?: { results?: unknown } }>(SEARCH_QUERY, {
        query: input.query,
        perPage: input.limit,
        page: input.page,
      });

      return mapSearchResults(data.search?.results);
    }),

  // A scanned barcode. Same budget as search — it is the same shared token —
  // and the same one-request-per-call shape.
  byIsbn: protectedProcedure
    .use(rateLimit({ name: "book.byIsbn", max: 20, windowSeconds: 60 }))
    .input(z.object({ isbn: z.string() }))
    .query(async ({ input }) => {
      const isbn = normalizeIsbn(input.isbn);
      if (!isbn) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That barcode is not an ISBN." });
      }

      const data = await hardcoverRequest<{ editions?: unknown }>(ISBN_QUERY, { isbn });
      return mapEdition(data);
    }),
});
