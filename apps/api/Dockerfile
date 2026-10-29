# syntax=docker/dockerfile:1

# The build context is the repository root: pnpm workspace links (@rowcat/*) need the lockfile
# and every manifest in one tree.
#   docker build -f apps/api/Dockerfile .

FROM node:26-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
WORKDIR /app
# Node 26 dropped corepack, so install exactly the root package.json's packageManager — writing
# the version here again would let the image and local silently diverge.
COPY package.json ./
RUN npm i -g "$(node -p "require('./package.json').packageManager")"

# Manifests first so source edits do not bust the install layer cache. Copy every workspace
# manifest: with only some, pnpm sees the lockfile importers mismatch and refuses --frozen-lockfile.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
# Mobile is not in this image; its manifest is copied only because --frozen-lockfile checks that
# every workspace in the lockfile exists.
COPY apps/mobile/package.json apps/mobile/
COPY apps/web/package.json apps/web/
COPY packages/authoring/package.json packages/authoring/
COPY packages/chat/package.json packages/chat/
COPY packages/contracts/package.json packages/contracts/
COPY packages/design/package.json packages/design/
COPY packages/domain/package.json packages/domain/
COPY packages/query/package.json packages/query/
COPY packages/runtime/package.json packages/runtime/
COPY packages/runtime-compiler/package.json packages/runtime-compiler/
COPY packages/sdk/package.json packages/sdk/
COPY packages/sync/package.json packages/sync/
COPY packages/ui-web/package.json packages/ui-web/

# Runtime dependencies: tsdown bundles @rowcat/* and leaves npm deps (hono, zod, ...) external,
# so only those are installed. No --node-linker=hoisted — hoisting ignores --filter/--prod and
# expands the whole lockfile (web's rolldown/tailwind, mobile's react-native), adding ~250MB.
#
# react, react-dom and react-email are runtime deps because mail copy renders with React Email
# (apps/api/src/services/mail/emails/); missing one, the build passes and the first send dies with
# ERR_MODULE_NOT_FOUND. react-email drags in its preview CLI (esbuild, socket.io, tailwind); to
# shrink the image, demote it to a devDependency and import @react-email/components and
# @react-email/render instead.
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter @rowcat/api

FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @rowcat/api...
# Copy the source of every workspace package the API depends on (keep in step with
# apps/api/package.json). A missing one still installs and builds — tsdown leaves it external —
# and the first boot dies with ERR_MODULE_NOT_FOUND.
#
# `typescript-compiler-api` is a direct dependency of apps/api for the same reason: it stays
# external in the bundle and the runtime image does not copy packages/*/node_modules, so it must
# resolve from apps/api for both the import and `require.resolve` (default lib reads).
COPY packages/authoring packages/authoring
COPY packages/chat packages/chat
COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY packages/runtime packages/runtime
COPY packages/runtime-compiler packages/runtime-compiler
COPY packages/sync packages/sync
COPY apps/api apps/api
RUN pnpm --filter @rowcat/api build

FROM node:26-alpine AS runner
# Same path depth as the builder: pnpm's tree is relative symlinks
# (apps/api/node_modules/hono -> ../../../node_modules/.pnpm/...) that break if moved.
WORKDIR /app/apps/api
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

COPY --from=prod-deps --chown=node:node /app/node_modules/.pnpm /app/node_modules/.pnpm
COPY --from=prod-deps --chown=node:node /app/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
# Migration SQL is not bundled (tsdown bundles .ts only) and is applied at boot; without it the
# first boot dies on a missing migrations folder.
COPY --from=build --chown=node:node /app/apps/api/drizzle ./drizzle

USER node
EXPOSE 3001

# Run as PID 1 directly; a wrapping shell would not forward SIGTERM and graceful shutdown breaks.
CMD ["node", "dist/index.mjs"]
