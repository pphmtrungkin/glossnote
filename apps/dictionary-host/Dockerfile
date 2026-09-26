# The pack is built here rather than committed: it is ~26 MB, it changes only
# when the WordNet edition below is bumped, and git would keep every copy
# forever. Build context is the repo root, not this directory — the pipeline
# lives in apps/native/scripts.

# ---- build the pack ---------------------------------------------------------
FROM oven/bun:1.3.14 AS pack

# wordnet-to-dictionary.ts shells out to `unzip`; Bun has no zip reader.
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# The pipeline is two scripts plus @better-vocab/domain, which is a
# dependency-free leaf exporting raw .ts — so a symlink is a complete install
# for it, and this stage needs no lockfile, no registry, and none of the Expo
# tree that a root `bun install` would drag in for two build scripts.
COPY packages/domain ./packages/domain
COPY apps/native/scripts ./apps/native/scripts
RUN mkdir -p node_modules/@better-vocab \
  && ln -s ../../packages/domain node_modules/@better-vocab/domain

# Pinned, so a rebuild next year serves the same dictionary. Bump to take a
# newer edition deliberately. JSON exports start at 2025; older tags ship only
# XML and RDF.
#
# The intermediate JSON and the core tier are build waste and are dropped: core
# ships inside the app binary, and only the extended .db is ever served.
ARG WORDNET_EDITION=2025
RUN bun run apps/native/scripts/wordnet-to-dictionary.ts /pack "${WORDNET_EDITION}" \
  && bun run apps/native/scripts/build-dictionary-db.ts extended \
     /pack/dictionary-extended.json /pack/dictionary-extended.db \
  && rm /pack/dictionary-core.json /pack/dictionary-extended.json

# ---- serve it ---------------------------------------------------------------
FROM oven/bun:1.3.14-slim

WORKDIR /app

# src/index.ts imports nothing, so there is no install step and no node_modules.
COPY apps/dictionary-host/src ./src
COPY --from=pack /pack/dictionary-extended.db ./pack/dictionary-extended.db

ENV PACK_FILE=/app/pack/dictionary-extended.db

CMD ["bun", "run", "src/index.ts"]
