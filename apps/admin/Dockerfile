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

# The API origin is not baked in: the container writes it into index.html at startup (below), so one
# image serves any deployment.
RUN pnpm --filter admin build

# Static files only — no Node. The one runtime value is the API origin.
FROM nginx:1.27-alpine AS runner

# The origin used when the container is given none. It is the local API, as in web: this repository
# knows no operator's domain, and a console silently attaching to someone's production API is the
# most expensive default here — its buttons stop every user's conversations and lock the app. A
# deployment sets `VITE_API_ORIGIN` on the container (compose passes it).
ENV ROWCAT_DEFAULT_API_ORIGIN=http://localhost:3001

# The config is a file because it carries three rules (SPA fallback, cache policy, header
# inheritance) whose reasons need room that a printf here would not have. It and index.html are kept
# as pristine templates; `rowcat-runtime-config.sh` renders the served copies from them at startup —
# the CSP `connect-src` and the bundle's `<meta>` from one value, so they cannot disagree (the
# symptom of a mismatch is only "network failure").
COPY apps/admin/nginx.conf /etc/rowcat/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
RUN cp /usr/share/nginx/html/index.html /etc/rowcat/index.html \
 && grep -q "__API_ORIGIN__" /etc/rowcat/default.conf \
 && grep -q "</head>" /etc/rowcat/index.html
COPY --chmod=755 apps/admin/docker/rowcat-runtime-config.sh /docker-entrypoint.d/40-rowcat-runtime-config.sh

EXPOSE 3002
