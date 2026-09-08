# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

**GlossNote** is a vocabulary-capture app for readers: while reading a book you log words you don't know, the app defines them (offline from a bundled dictionary, richer once online), and words are filed into per-book folders. The intended differentiator is **crowdsourced discovery** — seeing which words other readers of the same book also looked up.

Naming is deliberately split, so don't "fix" the inconsistencies: the product is GlossNote, the root `package.json` name is `glossnote`, the Expo scheme/slug is `glossnote` and the bundle ID is `com.anonymous.glossnote` — but the GitHub repo is `pphmtrungkin/glossnote` while **workspace packages keep the `@better-vocab/*` scope** (renaming it would churn every import for no product gain), and `bts.jsonc` preserves the original `better-vocab` scaffold command as a historical record.

The first vertical slice is built and working end to end. What actually exists:

- **Domain schema** (`packages/db/src/schema/`) — `book`, `folder`, `word`, `dictionary_entry`, `user_preference`, plus enums (`folder_status`, `capture_method`, `dictionary_source`, `offline_dictionary_tier`). Four migrations are generated, the latest being `0003_add_dictionary_contexts.sql`.
- **Domain API** (`packages/api/src/routers/`) — `book` (`search`, a server-side proxy to Hardcover), `dictionary` (`lookup`, a Datamuse proxy that caches into `dictionary_entry`), `folder` (`list`/`create`/`update`/`delete`), `preference` (`get`/`update`) and `word` (`listByFolder`/`search`/`create`/`createMany`/`suggestions`/`quiz`/`update`/`delete`), all `protectedProcedure`. The scaffold's `publicProcedure` `healthCheck` is still there; its `privateData` was deleted.

  `apps/server` is transport only — a Hono app mounting Better Auth and tRPC. New endpoints are tRPC procedures here, not `app.get`/`app.post` in the Hono app; a parallel REST surface would have no consumer (the Expo client speaks tRPC) and would drop the shared types.

  `word.create` and `word.createMany` both go through one private `captureWord`, so the "a client never writes `dictionary_entry`" rule cannot hold for the live save and lapse for the offline flush. `createMany` returns a per-capture `saved`/`dropped` result rather than failing the batch: a folder deleted on another device must not strand every other queued word behind it. `dropped` means never retry; a thrown error means keep the queue.
- **Account management** — Better Auth's `deleteUser` is enabled (`packages/auth/src/index.ts`), gated on the caller's password or a session fresher than a day; the cascades off `user.id` do the rest. Changing an email is deliberately not enabled: Better Auth needs a verification mail and this app has no email sender.
- **Screens** (`apps/native/app/`) — `(tabs)/index` shelf, `(tabs)/search`, `folder/[id]`, `add-word`, `(auth)/sign-in`. Page themes live in `contexts/app-theme-context.tsx`: the **Ochre spot** scheme (`ochre`, the default, and `dark` as its night half) plus Kindle's White/Sepia/Green pages.
- **On-device SQLite** (`apps/native/lib/local-db.ts`, `glossnote.db`, `user_version` 3) — tables `dictionary` (one table for all three tiers, distinguished by a `source` column: bundled `core`, downloaded `extended`, online-resolved `cached`), `pending_sync`, `app_setting`. Reads and writes go through `apps/native/lib/dictionary.ts`; screens never query it directly.
- **Definition resolution** (`apps/native/hooks/use-definition.ts`) — the one answer to "get me a definition for this term": device tiers first, `dictionary.lookup` second, result written back to the `cached` tier. Returns a `found`/`missing`/`unreachable` union so a screen renders a state rather than merging two query results. Pass `{ online: false }` for list rows, which must not fire a request each.

Known gaps — these are groundwork with no producer yet, so check before assuming a feature works:

- **Book linking only happens at folder creation.** `folder.create` takes the picked Hardcover hit (not a `bookId` — that would be an unvalidated FK from a client) and upserts the `book` row on `(provider, external_id)`. There is deliberately no `folder.updateBook`: `word.bookId` is snapshotted from `folder.bookId` at capture time, so linking a book to an existing folder would strand its earlier words outside the aggregate unless the same transaction also runs `update word set book_id = ... where folder_id = ...`.
**The sharing model — do not break this.** Users share *how often a word was saved*, never *what it means*. Definitions are per-device: resolved from the bundled dictionary offline, or from the server when online. Only counts cross between users.

Two rules follow, both asserted by `db:smoke`:
- `word.create` accepts a `definition` from the client and stores it on that user's `word.definitionOverride`. It must **never** write `dictionary_entry`, and it leaves `dictionaryEntryId` null. Only a server-side resolver may fill either. A client-writable shared cache means the first person to capture a term defines it permanently for every other reader.
- `word.suggestions` returns `{term, normalizedTerm, readers}` and nothing else. Adding a definition, sentence, or note column to that result breaks both the privacy model and spoiler safety.

`word.suggestions` is served as a live `count(distinct user_id) ... group by normalized_term` over `word`, excluding the caller's own rows and anything already in the folder. There is deliberately no materialized `book_word_aggregate` table (deleted in `0002`; add one back only if that query shows up in slow logs).
- ~~**No AI enrichment.**~~ — built. `dictionary.lookup` finishes by calling `enrichDefinition` (`packages/api/src/enrich.ts`, the one place an AI provider is called), which writes `exampleSentence`/`usageNote`/`enrichedAt` onto the shared row. Keyed by term, never per user. `enrichedAt` is the marker *and* the lock: it is claimed with a conditional update before the call, so concurrent lookups of a new word buy one enrichment between them — that is what makes "at most one AI call per unique word" hold under concurrency. A failed call releases the claim. Enrichment is optional (`AI_GATEWAY_API_KEY`) and every failure returns the base row: it may never turn a working lookup into a broken one. No screen renders the two columns yet.

  `dictionary.lookup` is the **only** writer of `dictionary_entry` outside `seed.ts`. Datamuse's `sp` parameter is a *fuzzy* match — asking for `sietch` returns `sketch` — so `pickDefinition` requires an exact word match before accepting a result. Removing that check silently files wrong definitions. No API key is needed before 2027-01-01; after that a free key is required (100k requests/day). Datamuse asks to be acknowledged in app documentation.
- **Usage contexts and the quiz.** Enrichment writes `dictionary_entry.contexts` — invented sentences with the term brace-marked, `"The house had an {eldritch} stillness about it."` — and `word.quiz` turns them into fill-in-the-blank cards over the caller's own words. The braces are the format `parseContext` (`@better-vocab/domain`) owns; three callers read it, so never parse a context by hand. The quiz costs no AI call of its own: contexts sit on the shared term-keyed row, so every card came from that term's one enrichment. Cards exclude mastered words, words with no resolved entry, and entries with no contexts; the sort ends on `word.id` because batch-written words share `createdAt` and a partial order lets the session reshuffle between opens. No screen renders it yet.
- **The AI columns have no reader.** `dictionary.lookup` fills `exampleSentence`/`usageNote`, but no screen displays either — `useDefinition` returns the whole entry, so showing them is a render change, not a server one.
- **`pending_sync` has a server, but no producer.** `word.createMany` is the flush endpoint the table was designed for, and it is tested. The device half does not exist: nothing writes a row when a capture happens offline, and nothing calls `createMany` on reconnect. Wiring it needs connectivity detection and a flush trigger in `apps/native`.
- ~~**Nothing writes `source = 'cached'` rows**~~ — fixed. `hooks/use-definition.ts` writes back every server-resolved definition via `cacheDefinition` (`apps/native/lib/dictionary.ts`), so the tier's top priority is now reachable.
- **No bundled dictionary asset ships.** `scripts/build-dictionary-db.ts` and `wordnet-to-dictionary.ts` can build one, but no `.db` asset is committed, so the `dictionary` table is empty at runtime and lookups fall through. A built asset stamps `user_version = 3` itself so `migrateLocalDb` leaves it alone — keep the two in sync.
- ~~**`user_preference` has no router.**~~ — fixed. `preference.get`/`preference.update` exist, `get` returns `PREFERENCE_DEFAULTS` without writing a row, and `update` upserts field by field. No settings screen calls them yet.

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

There is **no lint command** — `turbo.json` declares a `lint` task but no workspace implements it, and no linter (eslint/biome/prettier) is installed. There is also **no unit test suite and no test runner** — `db:smoke` is the only automated check: a self-cleaning script that drives the real `appRouter` against a seeded local Postgres to verify what the schema (not TypeScript) enforces — relation joins, ownership scoping (including that `word.delete`/`folder.delete` refuse another user's row rather than reporting success), the partial unique index on `(user_id, book_id)`, capture idempotency, cascades, the Hardcover book upsert, the enrichment claim on `dictionary_entry`, and the live crowdsourced aggregate query. It also asserts `normalizeTerm` directly, and reads the live `pg_enum` labels back to prove the Postgres enums still match `@better-vocab/domain` — a value added to a domain array without a generated migration fails there. It calls no external service: `mapSearchResults` is exported from `routers/book.ts` precisely so the mapping can be asserted against a fixture without a token or a rate-limited round trip, and the enrichment checks assert the *unconfigured* path (which is also the failure path), skipping themselves when `AI_GATEWAY_API_KEY` is set rather than spending money on a smoke run. It needs `db:start` + `db:seed` first, and it is re-runnable without reseeding. Extend it rather than adding a test framework; don't invent lint or test commands beyond it.

Shared dependency versions are pinned once in root `package.json`'s `workspaces.catalog` and referenced as `"catalog:"` in each workspace's `package.json`.

## Environment setup

No `.env.example` files exist; env vars are validated via zod schemas in `packages/env`:
- `apps/server/.env` — `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN`, `PORT`, and the optional `HARDCOVER_API_TOKEN` and `AI_GATEWAY_API_KEY` (schema: `packages/env/src/server.ts`). Set `SKIP_ENV_VALIDATION=true` to bypass.

`AI_GATEWAY_API_KEY` powers AI enrichment through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) and is **server-only by SoftwareSpec §8.1** — the Expo app calls its own tRPC procedures, never a provider — so it must never become an `EXPO_PUBLIC_*` var either. Optional: without it, `dictionary.lookup` still resolves and caches base definitions. The model is one `provider/model` string in `enrich.ts` (`zai/glm-4.7-flashx` — a small/fast tier per §8.4, ~$0.06/$0.40 per million tokens), so switching model or vendor is that line and no new SDK. Slugs must match the catalog exactly; `GET https://ai-gateway.vercel.sh/v1/models` lists them and needs no auth. Cheap models come with quirks: this one nests the answer under an invented key on about half of calls, which `unwrapWrappedObject` repairs (exported so `db:smoke` asserts it without a call), and it ignores `reasoning: "none"`. A gateway account with no purchased credits also can't reach much of the catalog, and rate-limits what it can within a few requests. The AI SDK reads the key from `process.env` itself — `enrich.ts` still checks `env.AI_GATEWAY_API_KEY` first, which is what keeps enrichment optional.

`HARDCOVER_API_TOKEN` powers `book.search` and is **server-only by Hardcover's own rules** — their docs state queries "are not allowed to run in the browser, they must be run in an environment where the token can be kept secure", so it must never become an `EXPO_PUBLIC_*` var. Get one at <https://hardcover.app/account/api>. It is optional: without it `book.search` returns a clean `PRECONDITION_FAILED` and folder creation still works with a typed title. Free tier is 5,000 requests/day, 60/minute, burst 10, and **at most one `search` query per request** — the client debounces via `useDebouncedValue`, so don't batch searches or drop the debounce.

Dev ports: **API 3333** (`PORT`, defaulted in the env schema — not Bun's implicit 3000, which collides with everything), fumadocs 4000, Expo 8081. Three values must agree when the API port changes: `PORT`, `BETTER_AUTH_URL`, and the native app's `EXPO_PUBLIC_SERVER_URL`.
- `apps/native/.env` — `EXPO_PUBLIC_SERVER_URL` (schema: `packages/env/src/native.ts`).

## Architecture

Monorepo layout: `apps/*` (deployable apps) + `packages/*` (shared workspace libraries).

- **`apps/server`** — Hono app (`apps/server/src/index.ts`). Mounts Better Auth at `/api/auth/*` and tRPC at `/trpc/*` (via `@hono/trpc-server`). This is just the transport layer.
- **`packages/api`** (`@better-vocab/api`) — the actual tRPC router/context logic, kept separate from the Hono app. `context.ts` builds per-request context by calling `auth.api.getSession()`; `routers/index.ts` exports the single `appRouter` — new feature routers get merged in here.
- **`packages/auth`** (`@better-vocab/auth`) — Better Auth config (`packages/auth/src/index.ts`): Drizzle adapter against `packages/db`, `@better-auth/expo` plugin for native deep-link auth, email/password only (no social providers configured). Exported `auth` singleton is imported by both `apps/server` (mounting the handler) and `packages/api` (session lookup in context).
- **`packages/db`** (`@better-vocab/db`) — Drizzle ORM + PostgreSQL (`drizzle-orm/node-postgres`). Schema lives under `packages/db/src/schema` — Better Auth's `user`/`session`/`account`/`verification` in `auth.ts`, domain tables in `book.ts`/`word.ts`/`dictionary.ts`/`preference.ts`, shared enums in `enums.ts`, all re-exported from `schema/index.ts`. Migrations are in `packages/db/src/migrations`. Note this is the *server* schema; the app also has an unrelated on-device SQLite schema in `apps/native/lib/local-db.ts` — the two are maintained separately and deliberately don't mirror each other.
- **`apps/native`** — Expo app using Expo Router file-based routing under `apps/native/app/`. Talks to the backend via tRPC + TanStack React Query (`apps/native/utils/trpc.ts`, using `createTRPCOptionsProxy` typed against `AppRouter` from `@better-vocab/api`) — not plain REST/fetch. Styling via Uniwind (Tailwind-for-RN) and HeroUI Native components.

  **Themes.** `global.css` is the single source: each theme is a `@variant` block setting the custom properties HeroUI Native reads, so overriding them re-skins every component without touching component code. A new theme needs three edits in step — the `@variant` block, `extraThemes` in `metro.config.js`, and `READING_THEMES`/`READING_THEME_META` in `app-theme-context.tsx` — and Metro must be restarted, because the theme union in `uniwind-types.d.ts` is generated from `extraThemes` (it's gitignored; a stale one is what makes `Uniwind.setTheme("ochre")` fail to typecheck). Uniwind's own starting theme is `light` and there is no config option to change it, so the default is applied at runtime in the context's load effect, behind the `isThemeReady` gate `_layout.tsx` holds the splash on.

  **The colour scheme is Ochre spot**: one accent (ochre `#a8560f`, `#d99a52` at night), spent only on the reader's own saved words and the single main action per screen — other readers' data stays muted grey by rule, since crowdsourced counts are reference material rather than the reader's progress. Don't add a second accent.

  The scheme's own names (`bg-primary`, `text-ink`, `text-state-learning`, `rounded-card`) are registered in the same file. Tokens with a HeroUI counterpart are **aliases** — `--color-ink: var(--foreground)` — so they follow the reader's page; never copy the hex in beside them, or one colour gets two spellings that drift. `lib/palette.ts` covers what a className can't reach (StatusBar, SVG, `Animated`), re-exporting `nativewind/theme.ts` rather than restating values; its `usePalette()` reads the app theme context, not RN's `useColorScheme()`, because the theme here is a persisted choice across five pages rather than an OS mirror.

  `apps/native/nativewind/` is the scheme as it was handed over — a NativeWind v4 drop whose `tailwind.config.js` and `global.css` do **not** apply here (this is Uniwind + Tailwind v4: CSS-first, no JS config). Only `theme.ts` in it is live, as the source `lib/palette.ts` re-exports.

  On-device storage is `expo-sqlite` via `SQLiteProvider` in `app/_layout.tsx`, migrated by `migrateLocalDb` (`lib/local-db.ts`). `lib/folder-status.ts` holds only the labels and chip colours; the status values themselves come from `@better-vocab/domain`.
- **`apps/fumadocs`** — Next.js + Fumadocs docs site (dev port 4000), independent of the product runtime; content under `apps/fumadocs/content/docs/*.mdx`.
- **`packages/domain`** (`@better-vocab/domain`) — dependency-free leaf holding what the server and the app must agree on: `normalizeTerm` (the match key every word/definition join uses), the closed value sets (`FOLDER_STATUSES`, `CAPTURE_METHODS`, `DICTIONARY_TIERS`, `OFFLINE_DICTIONARY_TIERS`, `DICTIONARY_SOURCES`) and `PREFERENCE_DEFAULTS` (which `packages/db` applies as the column defaults and `preference.get` returns for a user with no row — editing one needs a generated migration). It exists because `apps/native` cannot import `packages/db` — that would pull Postgres drivers into the RN bundle — so anything both sides need lives here instead of being retyped. `packages/db` builds its `pgEnum`s from these arrays and `packages/api` builds its `z.enum`s from them, so a value is added in one place. **Never inline `term.trim().toLowerCase()` again**: the asset build script (`build-dictionary-db.ts`) stamps the shipped dictionary with the same function, and a drift between it and the runtime lookups would make every offline lookup miss with no error.
- **`packages/env`** (`@better-vocab/env`) — typed env vars via `@t3-oss/env-core` + zod, split into `./server` and `./native` entry points (see Environment setup above).
- **`packages/config`** (`@better-vocab/config`) — ships only `tsconfig.base.json`, extended by every app/package's own `tsconfig.json`.

Type-safety flows one direction across these boundaries: `packages/domain` (values and the match key, no dependencies) → `packages/db` schema → `packages/auth` (Drizzle adapter typed against it) → `packages/api` (`Context`/`AppRouter` types) → `apps/native` (the `AppRouter` type for its tRPC client, plus `@better-vocab/domain` at runtime). There's no duplicated type definitions across the client/server boundary.

Every mutation on a user-owned row goes through `ownedBy` + `assertOwned` (`packages/api/src/ownership.ts`) rather than composing its own `(id, userId)` predicate. Both produce `NOT_FOUND`, never `FORBIDDEN` — a caller has no business learning that a row exists but belongs to someone else.


## Agent skills

### Issue tracker

Issues live as GitHub issues in `pphmtrungkin/glossnote`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` plus `docs/adr/` at the repo root, despite the monorepo layout — GlossNote is one product domain across all workspaces. See `docs/agents/domain.md`.
