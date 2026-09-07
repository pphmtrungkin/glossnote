# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

**GlossNote** is a vocabulary-capture app for readers: while reading a book you log words you don't know, the app defines them (offline from a bundled dictionary, richer once online), and words are filed into per-book folders. The intended differentiator is **crowdsourced discovery** — seeing which words other readers of the same book also looked up.

Naming is deliberately split, so don't "fix" the inconsistencies: the product is GlossNote, the root `package.json` name is `glossnote`, the Expo scheme/slug is `glossnote` and the bundle ID is `com.anonymous.glossnote` — but the GitHub repo is `pphmtrungkin/glossnote` while **workspace packages keep the `@better-vocab/*` scope** (renaming it would churn every import for no product gain), and `bts.jsonc` preserves the original `better-vocab` scaffold command as a historical record.

The first vertical slice is built and working end to end. What actually exists:

- **Domain schema** (`packages/db/src/schema/`) — `book`, `folder`, `word`, `dictionary_entry`, `user_preference`, plus enums (`folder_status`, `capture_method`, `dictionary_source`, `offline_dictionary_tier`). Three migrations are generated, the latest being `0002_collapse_aggregate_and_unused_columns.sql`.
- **Domain API** (`packages/api/src/routers/`) — `book` (`search`, a server-side proxy to Hardcover), `folder` (`list`/`create`/`updateStatus`/`delete`) and `word` (`listByFolder`/`search`/`create`/`update`/`delete`), all `protectedProcedure`. The scaffold's `healthCheck`/`privateData` are still there.
- **Screens** (`apps/native/app/`) — `(tabs)/index` shelf, `(tabs)/search`, `folder/[id]`, `add-word`, `(auth)/sign-in`. Kindle-style reading themes live in `contexts/app-theme-context.tsx`.
- **On-device SQLite** (`apps/native/lib/local-db.ts`, `glossnote.db`, `user_version` 3) — tables `dictionary` (one table for all three tiers, distinguished by a `source` column: bundled `core`, downloaded `extended`, online-resolved `cached`), `pending_sync`, `app_setting`.

Known gaps — these are groundwork with no producer yet, so check before assuming a feature works:

- **Book linking only happens at folder creation.** `folder.create` takes the picked Hardcover hit (not a `bookId` — that would be an unvalidated FK from a client) and upserts the `book` row on `(provider, external_id)`. There is deliberately no `folder.updateBook`: `word.bookId` is snapshotted from `folder.bookId` at capture time, so linking a book to an existing folder would strand its earlier words outside the aggregate unless the same transaction also runs `update word set book_id = ... where folder_id = ...`.
- **Crowdsourced discovery is unbuilt.** `word.contributesToAggregate` and `word_bookId_contributesToAggregate_idx` exist; no procedure reads them. It is meant to be served as a live `count(distinct user_id) ... group by normalized_term` over `word` — there is deliberately no materialized `book_word_aggregate` table (it was deleted in `0002`; add one back only if that query shows up in slow logs). Join definitions in from `dictionary_entry` on the *normalized* term — `dictionary_entry.term` is a lowercased match key, not a display string.
- **No AI enhancement.** `dictionary_source` has an `ai_enhanced` value and `dictionary_entry` has `exampleSentence`/`usageNote`/`enrichedAt` columns waiting for it, but there is no AI client anywhere in the repo. Enrichment is keyed by term on the shared `dictionary_entry`, never per user — that is what holds the spec's "each unique word triggers at most one AI call" cost target.
- **`pending_sync` is dead schema** — created by the migration, read/written by nothing. Offline capture does not queue yet.
- **Nothing writes `source = 'cached'` rows** — `hooks/use-dictionary-lookup.ts` reads them, no online lookup populates them.
- **No bundled dictionary asset ships.** `scripts/build-dictionary-db.ts` and `wordnet-to-dictionary.ts` can build one, but no `.db` asset is committed, so the `dictionary` table is empty at runtime and lookups fall through. A built asset stamps `user_version = 3` itself so `migrateLocalDb` leaves it alone — keep the two in sync.
- **`user_preference` has no router.** `word.create` reads it; nothing lets a user change it.

Future feature work should follow the extension points below (new Drizzle schema files, new tRPC routers merged into `routers/index.ts`, new Expo route groups).

## Commands

Package manager is **Bun** (`bun@1.3.14`), workspaces defined via Bun's `workspaces` object (`apps/*`, `packages/*`) and orchestrated by Turborepo (`turbo.json`). Root `package.json` scripts fan out through `turbo run <task>`, optionally filtered with `-F <package>`:

```
bun install                 # install all workspace deps
bun run dev                 # start all apps (server + native) in dev mode
bun run dev:server          # start only apps/server (bun --hot)
bun run dev:native          # start only apps/native (expo start --clear)
bun run build               # build all apps
bun run check-types         # typecheck every workspace (turbo-fanned)
bun run db:push             # push Drizzle schema to Postgres (packages/db)
bun run db:generate         # generate Drizzle migrations
bun run db:migrate          # run Drizzle migrations
bun run db:studio           # open Drizzle Studio
```

`check-types` fans out to two workspaces only: `tsc -b` in `apps/server` and `tsc --noEmit` in `apps/native`. `apps/fumadocs` names its script `types:check`, not `check-types`, so turbo never picks it up — check the docs site with `bun run build` from `apps/fumadocs`, which also validates every MDX page.

```
bun run db:start            # start the local Postgres container (packages/db/docker-compose.yml)
bun run db:stop             # stop it (keeps the volume; add -v by hand for a clean slate)
bun run db:seed             # write dev fixtures (packages/db/src/seed.ts), local DBs only
bun run db:smoke            # assert the DB + routers behave (packages/api/src/smoke.ts)
```

There is **no lint command** — `turbo.json` declares a `lint` task but no workspace implements it, and no linter (eslint/biome/prettier) is installed. There is also **no unit test suite and no test runner** — `db:smoke` is the only automated check: a self-cleaning script that drives the real `appRouter` against a seeded local Postgres to verify what the schema (not TypeScript) enforces — relation joins, ownership scoping, the partial unique index on `(user_id, book_id)`, capture idempotency, cascades, the Hardcover book upsert, and the live crowdsourced aggregate query. It never calls Hardcover: `mapSearchResults` is exported from `routers/book.ts` precisely so the mapping can be asserted against a fixture without a token or a rate-limited round trip. It needs `db:start` + `db:seed` first, and it is re-runnable without reseeding. Extend it rather than adding a test framework; don't invent lint or test commands beyond it.

Shared dependency versions are pinned once in root `package.json`'s `workspaces.catalog` and referenced as `"catalog:"` in each workspace's `package.json`.

## Environment setup

No `.env.example` files exist; env vars are validated via zod schemas in `packages/env`:
- `apps/server/.env` — `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN`, `PORT`, and the optional `HARDCOVER_API_TOKEN` (schema: `packages/env/src/server.ts`). Set `SKIP_ENV_VALIDATION=true` to bypass.

`HARDCOVER_API_TOKEN` powers `book.search` and is **server-only by Hardcover's own rules** — their docs state queries "are not allowed to run in the browser, they must be run in an environment where the token can be kept secure", so it must never become an `EXPO_PUBLIC_*` var. Get one at <https://hardcover.app/account/api>. It is optional: without it `book.search` returns a clean `PRECONDITION_FAILED` and folder creation still works with a typed title. Free tier is 5,000 requests/day, 60/minute, burst 10, and **at most one `search` query per request** — the client debounces via `useDebouncedValue`, so don't batch searches or drop the debounce.

Dev ports: **API 3333** (`PORT`, defaulted in the env schema — not Bun's implicit 3000, which collides with everything), fumadocs 4000, Expo 8081. Three values must agree when the API port changes: `PORT`, `BETTER_AUTH_URL`, and the native app's `EXPO_PUBLIC_SERVER_URL`.
- `apps/native/.env` — `EXPO_PUBLIC_SERVER_URL` (schema: `packages/env/src/native.ts`).

## Architecture

Monorepo layout: `apps/*` (deployable apps) + `packages/*` (shared workspace libraries).

- **`apps/server`** — Hono app (`apps/server/src/index.ts`). Mounts Better Auth at `/api/auth/*` and tRPC at `/trpc/*` (via `@hono/trpc-server`). This is just the transport layer.
- **`packages/api`** (`@better-vocab/api`) — the actual tRPC router/context logic, kept separate from the Hono app. `context.ts` builds per-request context by calling `auth.api.getSession()`; `routers/index.ts` exports the single `appRouter` — new feature routers get merged in here.
- **`packages/auth`** (`@better-vocab/auth`) — Better Auth config (`packages/auth/src/index.ts`): Drizzle adapter against `packages/db`, `@better-auth/expo` plugin for native deep-link auth, email/password only (no social providers configured). Exported `auth` singleton is imported by both `apps/server` (mounting the handler) and `packages/api` (session lookup in context).
- **`packages/db`** (`@better-vocab/db`) — Drizzle ORM + PostgreSQL (`drizzle-orm/node-postgres`). Schema lives under `packages/db/src/schema` — Better Auth's `user`/`session`/`account`/`verification` in `auth.ts`, domain tables in `book.ts`/`word.ts`/`dictionary.ts`/`preference.ts`, shared enums in `enums.ts`, all re-exported from `schema/index.ts`. Migrations are in `packages/db/src/migrations`. Note this is the *server* schema; the app also has an unrelated on-device SQLite schema in `apps/native/lib/local-db.ts` — the two are maintained separately and deliberately don't mirror each other.
- **`apps/native`** — Expo app using Expo Router file-based routing under `apps/native/app/`. Talks to the backend via tRPC + TanStack React Query (`apps/native/utils/trpc.ts`, using `createTRPCOptionsProxy` typed against `AppRouter` from `@better-vocab/api`) — not plain REST/fetch. Styling via Uniwind (Tailwind-for-RN) and HeroUI Native components. On-device storage is `expo-sqlite` via `SQLiteProvider` in `app/_layout.tsx`, migrated by `migrateLocalDb` (`lib/local-db.ts`). Note `lib/folder-status.ts` intentionally duplicates `folderStatusEnum` rather than importing it, to keep Postgres drivers out of the bundle — keep the two in sync by hand.
- **`apps/fumadocs`** — Next.js + Fumadocs docs site (dev port 4000), independent of the product runtime; content under `apps/fumadocs/content/docs/*.mdx`.
- **`packages/env`** (`@better-vocab/env`) — typed env vars via `@t3-oss/env-core` + zod, split into `./server` and `./native` entry points (see Environment setup above).
- **`packages/config`** (`@better-vocab/config`) — ships only `tsconfig.base.json`, extended by every app/package's own `tsconfig.json`.

Type-safety flows one direction across these boundaries: `packages/db` schema → `packages/auth` (Drizzle adapter typed against it) → `packages/api` (`Context`/`AppRouter` types) → `apps/native` (imports only the `AppRouter` type for its tRPC client). There's no duplicated type definitions across the client/server boundary.
