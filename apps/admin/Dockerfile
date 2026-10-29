# syntax=docker/dockerfile:1

# The build context is the repository root.
#   docker build -f apps/admin/Dockerfile .
#
# Unlike apps/web, this app has no SSR: the output is static files, so the runtime needs no Node
# and there is no internal API address (`API_INTERNAL_ORIGIN`) for a server render to call.

FROM node:26-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
WORKDIR /app
# Node 26 dropped corepack. Install from the root package.json's packageManager — writing the
# version here again lets local and image silently diverge.
COPY package.json ./
RUN npm i -g "$(node -p "require('./package.json').packageManager")"

FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
# Manifests only: --frozen-lockfile checks that every workspace in the lockfile exists and
# refuses to install if one is missing.
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

FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter admin...
COPY packages packages
COPY apps/admin apps/admin

# Baked into the browser bundle, so it must be given at build time.
#
# The default is the local API, as in web: this repository knows no operator's domain, and a
# production image must pass its origin (`VITE_API_ORIGIN=https://api.example.com docker buildx
# bake admin`). A hand-built console image silently attaching to someone's production API is the
# most expensive default here — its buttons stop every user's conversations and lock the app.
#
# `:-` because compose passes unfilled variables as empty strings; without it an empty value is
# baked into the bundle.
ARG VITE_API_ORIGIN=""
ENV VITE_API_ORIGIN=${VITE_API_ORIGIN:-http://localhost:3001}
RUN pnpm --filter admin build

# Static files only — no Node and no runtime env; the API origin is already in the bundle.
FROM nginx:1.27-alpine AS runner

# The config is a file because it carries three rules (SPA fallback, cache policy, header
# inheritance) whose reasons need room that a printf here would not have.
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

# CSP `connect-src` must equal the API origin the bundle calls. A literal in nginx.conf would
# block every lookup in an image built with a different origin (the symptom is only "network
# failure"), so the same build arg fills the `__API_ORIGIN__` placeholder — one source for the value.
ARG VITE_API_ORIGIN=""
RUN api_origin="${VITE_API_ORIGIN:-http://localhost:3001}" \
 && sed -i "s#__API_ORIGIN__#${api_origin}#g" /etc/nginx/conf.d/default.conf \
 && ! grep -q "__API_ORIGIN__" /etc/nginx/conf.d/default.conf

COPY --from=build /app/apps/admin/dist /usr/share/nginx/html

EXPOSE 3002
