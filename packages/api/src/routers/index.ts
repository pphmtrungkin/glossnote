import { protectedProcedure, publicProcedure, router } from "../index";
import { bookRouter } from "./book";
import { dictionaryRouter } from "./dictionary";
import { folderRouter } from "./folder";
import { preferenceRouter } from "./preference";
import { wordRouter } from "./word";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
  book: bookRouter,
  dictionary: dictionaryRouter,
  folder: folderRouter,
  preference: preferenceRouter,
  word: wordRouter,
});
export type AppRouter = typeof appRouter;
