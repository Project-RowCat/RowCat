# syntax=docker/dockerfile:1

# The build context is the repository root.
#   docker build -f apps/web/Dockerfile .

FROM node:26-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
WORKDIR /app
# Node 26 no longer ships corepack in the distribution. Instead, the packageManager field of the root
# package.json is read directly. Writing the version here again would silently diverge the local
# toolchain from the image.
COPY package.json ./
RUN npm i -g "$(node -p "require('./package.json').packageManager")"

FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
# Mobile is not part of this image. Only its manifest is copied because pnpm's --frozen-lockfile checks
# that every workspace listed in the lockfile exists. If one is missing, the install rejects right there.
# Sources are still not copied.
COPY apps/mobile/package.json apps/mobile/
COPY apps/web/package.json apps/web/
COPY packages/authoring/package.json packages/authoring/
COPY packages/chat/package.json packages/chat/
COPY packages/contracts/package.json packages/contracts/
COPY packages/design/package.json packages/design/
COPY packages/domain/package.json packages/domain/
COPY packages/markdown/package.json packages/markdown/
COPY packages/query/package.json packages/query/
COPY packages/runtime/package.json packages/runtime/
COPY packages/runtime-ai-docs/package.json packages/runtime-ai-docs/
COPY packages/runtime-compiler/package.json packages/runtime-compiler/
COPY packages/runtime-host/package.json packages/runtime-host/
COPY packages/runtime-persistence/package.json packages/runtime-persistence/
COPY packages/runtime-renderer-web/package.json packages/runtime-renderer-web/
COPY packages/sdk/package.json packages/sdk/
COPY packages/sync/package.json packages/sync/
COPY packages/ui-web/package.json packages/ui-web/

FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web...
COPY packages packages
COPY apps/web apps/web
# Single source of truth for the public runtime documentation. `gen:runtime-docs` reads this directory to
# produce the documentation screen's generated module. The following `gen:llms` reads the corpus (the
# committed generated output in `packages/runtime-ai-docs`), so this one line lets both generation steps
# run.
#
# The source is copied even though the generated files are already committed, and that is the point: the
# image must build from the **source**, so there is no path where stale generated output ships. Without
# this line `gen:runtime-docs` dies with ENOENT. That is the right failure: better than silently
# deploying old documentation.
#
# Only the one directory that reaches users is included, not all of `docs`. The rest is architecture
# documentation that the image has no reason to carry.
COPY docs/public/runtime docs/public/runtime
# The API and console origins are **not** baked in. The server reads `VITE_API_ORIGIN` and
# `VITE_ADMIN_ORIGIN` from its environment at runtime and hands them to the browser through `<meta>`
# tags (apps/web/src/lib/api.ts), so one image serves any deployment. Without them the image calls the
# local API (http://localhost:3001) — this repository knows no operator's domain, and failing visibly
# on the first screen beats silently connecting to someone else's production server.
RUN pnpm --filter web build

# --- Runtime ------------------------------------------------------------------
# The nitro node-server preset emits .output as a self-contained bundle, with dependencies included. So the
# runtime image needs neither node_modules nor pnpm.
FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/apps/web/.output ./

USER node
EXPOSE 3000

CMD ["node", "server/index.mjs"]
