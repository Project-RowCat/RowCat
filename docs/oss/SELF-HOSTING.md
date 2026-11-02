# Running and self-hosting RowCat

[한국어](SELF-HOSTING.ko.md) · [Back to the README](../../README.md)

The minimal configuration is **Postgres plus one secret**. Everything else (mail, push, social sign-in,
identity verification, the managed-generation key, Redis) is optional and reported as off rather than
blocking startup.

## Running it locally

Prerequisites: Node.js 22 or newer (the container images use Node 26), pnpm at the version pinned in
`package.json`'s `packageManager` field (`corepack enable` picks it up — do not install with npm or yarn),
and Docker with Compose.

```bash
pnpm install
pnpm dev:setup   # env files, one shared secret, Postgres in Docker, schema, a development account
pnpm dev:all     # web, API and the operations console together
```

`pnpm dev:setup` is safe to run again — it never overwrites a file or a secret that already exists. It
creates `.env` (read by docker compose) and `apps/api/.env` (read by the API on the host) from their
examples, generates one `BETTER_AUTH_SECRET` into both and a `POSTGRES_PASSWORD` into `.env` (with
`DATABASE_URL` in `apps/api/.env` following it), and writes a gitignored
`docker-compose.override.yml` that publishes Postgres on loopback only — on 5432, or the next free port
when a Postgres already runs on this machine (then `DATABASE_URL` follows it). `--no-docker` uses your own
Postgres instead (whatever `DATABASE_URL` in `apps/api/.env` points at); `--no-seed` skips the development
account. To see what this configuration turns on: `pnpm env:doctor --file apps/api/.env` (add
`--mode production` to see release blockers).

**Or open it in a Dev Container** (`.devcontainer/`): the container runs the same `pnpm dev:setup` when it
is created, with Postgres in Docker inside it. Use a fresh clone ("Clone Repository in Container Volume" or
a Codespace opened in the desktop editor).

| Port | Service |
| --- | --- |
| 3000 | Web app |
| 3001 | API (`/v2`) |
| 3002 | Operations console |

`db:seed:dev-user` creates `dev@rowcat.test` with password `rowcat-dev` (pass an email and password as
arguments to choose others). It marks the email as verified, opens the identity and adult gates, and puts
the account on the managed-generation allowlist. It refuses to run with `NODE_ENV=production`.

To reach Postgres from a shell without the override: `docker compose exec db psql -U rowcat rowcat`.

## The first administrator

While a deployment has no admin, the API prints a one-time setup code each time it starts
(`docker compose logs api | grep "\[setup\]"`, or the terminal running `pnpm dev:api`). Open `/setup` in the
console (`http://localhost:3002/setup` locally), create or sign in to the account that will run the
deployment, and enter the code. That account becomes `admin`, setup closes for good, and the page ends with
what the deployment has turned on and which variables turn on the rest. A deployment that already has an
admin when it boots never opens setup.

## AI generation

Generation needs a key from somewhere. Managed generation uses `OPENROUTER_API_KEY` in `apps/api/.env`;
without it, managed requests answer 503 and everything else keeps working. Any member can instead connect
their own Anthropic or Gemini key under AI settings — that path never touches this server.
`MANAGED_GENERATION_ACCESS` decides who may use the operator's key (`allowlist`, the default, or
`everyone`).

## Deploying

**A deployment is four values, not two.** Locally the origins fall back to localhost; a production
deployment also sets `WEB_ORIGIN` and `API_ORIGIN` (and `AUTH_COOKIE_DOMAIN` when web and API sit on
different hosts). With those four, `pnpm env:doctor --mode production --file <env file>` reports no release
blockers and names every feature that stays off — see `docs/ops/CONFIGURATION.md` (최소 구성).

### The published images

Every push to `main` publishes the three app images to GHCR (`.github/workflows/images.yml`), and they
carry no deployment value — web and the operations console take the API origin from their environment
when they start. So a deployment needs no build:

```bash
cp .env.example .env   # set BETTER_AUTH_SECRET and POSTGRES_PASSWORD, and for a real domain WEB_ORIGIN, API_ORIGIN, VITE_API_ORIGIN
docker compose up -d   # pulls api, web and admin; Postgres and Redis come along
```

The pull needs the GHCR packages to be public (a setting the repository owner flips once). While they are
not, the pull is refused and compose builds this checkout instead — slower, and it says so only by starting
a build. `docs/ops/CLEAN-INSTALL.md` checks which of the two a deployment actually ran.

Both secrets are generated, never copied: `openssl rand -base64 32` for `BETTER_AUTH_SECRET`, `openssl rand
-hex 24` for `POSTGRES_PASSWORD` (hex goes into the database URL unescaped). Compose will not start without
them, and the API refuses to boot in production on a short session key or on the old example password
`rowcat` — a database first created with that password needs `ALTER ROLE` before the upgrade
(`docs/ops/CONFIGURATION.md`, 개발 기본값은 운영 시크릿이 아니다).

`docker compose up --build` runs this checkout instead of the published images. Pin a deployment to one
build with `ROWCAT_IMAGE_TAG=sha-<commit>`; a fork that publishes its own images points
`ROWCAT_IMAGE_REGISTRY` at them (`docs/oss/FORKING.md` §15).

### HTTPS

For a public domain, `deploy/caddy/` puts the stack behind HTTPS: set `ROWCAT_DOMAIN` (and
`COMPOSE_FILE=docker-compose.yml:deploy/caddy/compose.yml`) in `.env`, and Caddy serves web, API and console
on three host names with certificates it renews itself, deriving every origin and the cookie domain from that
one value and closing the apps' plain-HTTP ports (`docs/ops/HTTPS.md`).

### Backups and upgrades

`scripts/backup.sh` dumps the database — which holds everything, media bytes included — and `scripts/restore.sh`
puts a dump into an empty one; keep `.env` with the dumps, since `BETTER_AUTH_SECRET` also encrypts 2FA secrets.
Upgrades, rollback boundaries and what no backup can recover (lost end-to-end keys) are in `docs/ops/BACKUP.md`.

## On one computer, without Docker

`apps/desktop` packages the whole deployment as a desktop app — a bundled Postgres and the same three
builds, opened in its own window on `localhost`. Build the three apps, then
`pnpm --filter @rowcat/desktop package` writes an installer for the OS you run it on to `apps/desktop/out/`.
It is unsigned until a deployment signs it with its own certificates (`apps/desktop/README.md`). A `desktop-<date>`
tag publishes the Windows installer as a GitHub release (`.github/workflows/desktop-release.yml`), and installed
Windows copies update themselves from those releases.

## Verifying a change

```bash
pnpm check && pnpm typecheck && pnpm test
```

`pnpm check` runs Biome plus the drift checks for configuration and generated artifacts. The API tests use
a real Postgres (each test worker creates its own database) and skip when none is reachable.
`pnpm test:e2e` runs the Playwright browser journeys and starts the stack it needs. `pnpm test:compose`
boots the production compose stack, claims first-run setup and tears it down (`--build` to build this
checkout first). CI runs all three, and images and npm releases publish only a commit CI passed on.
