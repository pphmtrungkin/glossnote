import { db } from "@better-vocab/db";
import { book, folder } from "@better-vocab/db/schema/book";
import { MAX_PASSAGE_LENGTH } from "@better-vocab/domain";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { explainPassage } from "../enrich";
import { protectedProcedure, router } from "../index";
import { ownedBy } from "../ownership";
import { rateLimit } from "../rate-limit";

/**
 * Context mode: "I understood every word and still don't know what this says."
 *
 * The other half of being stuck. `dictionary.lookup` answers a word; this
 * answers a sentence — the metaphor, the allusion, the joke whose register a
 * reader can miss with no unfamiliar vocabulary in sight. Munger's "it was
 * wreaking havoc long before it got bad press in the laws of Moses" has not one
 * hard word in it and is opaque without the tenth commandment.
 *
 * This router deliberately writes NOTHING. That is the whole design:
 *
 *   - The passage is the book's text, not the app's. Keeping copies of it on a
 *     shared server, keyed so two readers of the same book hit the same row,
 *     would be a far larger version of the image-rights problem already open
 *     against Hardcover's covers (see docs/dmca.mdx).
 *   - Every other AI answer here is keyed by term on a row every reader shares,
 *     and the first answer is kept forever. That is what makes one call per
 *     unique word hold — and it is also what made a wrong answer permanent.
 *     An explanation nobody stores can be wrong once instead of wrong for good.
 *   - So the reader's own device keeps it (apps/native/lib/passage.ts), which
 *     gives them their history back without any of the above.
 *
 * The cost therefore scales with use rather than with the vocabulary, the one
 * place in this codebase where that is true. Hence the rate limit, which is
 * tighter than the lookups around it, and the length cap in `enrich.ts`.
 */
export const passageRouter = router({
  explain: protectedProcedure
    // Tighter than dictionary.lookup's 60/min: that one is mostly answered from
    // a cached row, while every call here reaches the model. A reader stuck on
    // a page a minute is reading unusually slowly.
    .use(rateLimit({ name: "passage.explain", max: 10, windowSeconds: 60 }))
    .input(
      z.object({
        passage: z.string().trim().min(1).max(MAX_PASSAGE_LENGTH),
        // Which shelf they are reading, so the model gets the title and author.
        // Optional: a passage can be explained with no book behind it, and a
        // freeform shelf has none to give.
        folderId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Scoped by owner like every other read of a user's row — a folder id is
      // a guessable handle to someone else's shelf otherwise. A folder that
      // isn't theirs simply yields no book rather than an error: the
      // explanation does not depend on it.
      const shelf = input.folderId
        ? await db.query.folder.findFirst({
            where: ownedBy(folder, input.folderId, ctx.session.user.id),
            columns: { bookId: true },
          })
        : null;

      const title = shelf?.bookId
        ? await db.query.book.findFirst({
            where: eq(book.id, shelf.bookId),
            // Title and authors only. The description is deliberately left
            // behind: it carries plot, and plot is the thing the prompt must
            // not be able to get ahead of the reader with.
            columns: { title: true, authors: true },
          })
        : null;

      const explanation = await explainPassage(
        input.passage,
        title ? { title: title.title, authors: title.authors ?? [] } : null,
      );

      // Same shape as a missing API token elsewhere: say the feature is off
      // rather than returning an empty answer that reads like a bad one.
      if (!explanation) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Explanations are unavailable right now. Try again in a moment.",
        });
      }

      return explanation;
    }),
});
