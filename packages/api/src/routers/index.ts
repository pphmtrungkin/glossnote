import { publicProcedure, router } from "../index";
import { bookRouter } from "./book";
import { dictionaryRouter } from "./dictionary";
import { folderRouter } from "./folder";
import { passageRouter } from "./passage";
import { preferenceRouter } from "./preference";
import { wordRouter } from "./word";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  book: bookRouter,
  dictionary: dictionaryRouter,
  folder: folderRouter,
  passage: passageRouter,
  preference: preferenceRouter,
  word: wordRouter,
});
export type AppRouter = typeof appRouter;
