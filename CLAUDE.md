# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

`better-vocab` is a Bun/Turborepo monorepo scaffolded by [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack) (see `bts.jsonc` for the exact generator invocation). It is currently at the infrastructure-scaffold stage: auth is wired up end-to-end and there's a placeholder tRPC router (`healthCheck`, `privateData`) plus one demo tab screen, but **no vocabulary/deck/learning domain logic exists yet**. Future feature work should follow the extension points described below (new Drizzle schema files, new tRPC routers, new Expo route groups) rather than assuming existing domain modules.

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

`check-types` fans out per-workspace: `tsc -b` in `apps/server`, `tsc --noEmit` in `apps/native`, `next typegen && tsc --noEmit` in `apps/fumadocs`.

There is **no lint command** — `turbo.json` declares a `lint` task but no workspace implements it, and no linter (eslint/biome/prettier) is installed. There is also **no test suite** in the repo. Don't invent lint or test commands; if either is added later, update this section.

Shared dependency versions are pinned once in root `package.json`'s `workspaces.catalog` and referenced as `"catalog:"` in each workspace's `package.json`.

## Environment setup

No `.env.example` files exist; env vars are validated via zod schemas in `packages/env`:
- `apps/server/.env` — `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN` (schema: `packages/env/src/server.ts`). Set `SKIP_ENV_VALIDATION=true` to bypass.
- `apps/native/.env` — `EXPO_PUBLIC_SERVER_URL` (schema: `packages/env/src/native.ts`).

## Architecture

Monorepo layout: `apps/*` (deployable apps) + `packages/*` (shared workspace libraries).

- **`apps/server`** — Hono app (`apps/server/src/index.ts`). Mounts Better Auth at `/api/auth/*` and tRPC at `/trpc/*` (via `@hono/trpc-server`). This is just the transport layer.
- **`packages/api`** (`@better-vocab/api`) — the actual tRPC router/context logic, kept separate from the Hono app. `context.ts` builds per-request context by calling `auth.api.getSession()`; `routers/index.ts` exports the single `appRouter` — new feature routers get merged in here.
- **`packages/auth`** (`@better-vocab/auth`) — Better Auth config (`packages/auth/src/index.ts`): Drizzle adapter against `packages/db`, `@better-auth/expo` plugin for native deep-link auth, email/password only (no social providers configured). Exported `auth` singleton is imported by both `apps/server` (mounting the handler) and `packages/api` (session lookup in context).
- **`packages/db`** (`@better-vocab/db`) — Drizzle ORM + PostgreSQL (`drizzle-orm/node-postgres`). Schema lives under `packages/db/src/schema` (currently only Better Auth's `user`/`session`/`account`/`verification` tables); the migrations directory is empty. New domain tables (words, decks, progress, etc.) belong here, re-exported from `schema/index.ts`.
- **`apps/native`** — Expo app using Expo Router file-based routing under `apps/native/app/`. Talks to the backend via tRPC + TanStack React Query (`apps/native/utils/trpc.ts`, using `createTRPCOptionsProxy` typed against `AppRouter` from `@better-vocab/api`) — not plain REST/fetch. Styling via Uniwind (Tailwind-for-RN) and HeroUI Native components.
- **`apps/fumadocs`** — Next.js + Fumadocs docs site (dev port 4000), independent of the product runtime; content under `apps/fumadocs/content/docs/*.mdx`.
- **`packages/env`** (`@better-vocab/env`) — typed env vars via `@t3-oss/env-core` + zod, split into `./server` and `./native` entry points (see Environment setup above).
- **`packages/config`** (`@better-vocab/config`) — ships only `tsconfig.base.json`, extended by every app/package's own `tsconfig.json`.

Type-safety flows one direction across these boundaries: `packages/db` schema → `packages/auth` (Drizzle adapter typed against it) → `packages/api` (`Context`/`AppRouter` types) → `apps/native` (imports only the `AppRouter` type for its tRPC client). There's no duplicated type definitions across the client/server boundary.
