import { protectedProcedure, publicProcedure, router } from "../index";
import { folderRouter } from "./folder";
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
  folder: folderRouter,
  word: wordRouter,
});
export type AppRouter = typeof appRouter;
