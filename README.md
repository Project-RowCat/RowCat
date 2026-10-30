# RowCat

RowCat was a user-generated story platform: people published interactive stories to a shared gallery and
played them as AI conversations, or as small programs written against a sandboxed creator runtime. The
hosted service has been shut down. **This repository is the code**, released so anyone can read it, learn
from it, or run their own deployment under a different name. There is no hosted instance behind it.

[한국어 요약](#한국어-요약)

## What is in here

- **Story gallery** — publish, discover (search, tags, related works, popular ranking), favourite, comment
  with one level of replies, follow and block creators, public creator profiles.
- **Local-first conversations and drafts** — conversations and story drafts live in the device's own
  database (IndexedDB on the web, SQLite on mobile) and sync between a member's devices with end-to-end
  encryption. The server stores ciphertext it cannot open; new devices are paired with a short code.
- **AI generation, two ways** — a server-side "managed" path that uses the operator's provider key
  (OpenRouter), gated by an allowlist and rate limits, and a bring-your-own-key path where the browser or
  app calls Anthropic or Gemini directly with the member's own key. Per-room memory, personas, characters
  and rolling summaries are assembled on the device.
- **Creator runtime** — creators write TSX against `@rowcat/runtime`; the server compiles it at
  publication, and players run it inside an isolated QuickJS/WASM virtual machine. The same patch bundles
  are rendered to a shadow DOM on the web and to React Native views on mobile. A Monaco-based studio
  previews it while authoring.
- **Clients** — a web app (TanStack Start, SSR), an Expo mobile app with a self-hosted, signed OTA update
  server, an operations console for moderation and deployment settings, and an MCP server
  (`apps/mcp`) that lets a coding agent author runtime projects as one of the member's devices.
- **The rest of a real product** — passkeys, two-factor authentication, Google/Apple/Kakao sign-in,
  moderation with appeals, in-app and native push notifications, guardian consent and age gating.
  No terms of service or privacy policy ship with it — a deployment writes its own (`docs/oss/FORKING.md`).

Most of the design rationale is written down: `AGENTS.md` is the index, `docs/` holds the decision
records, and file headers explain the boundaries they enforce. `AGENTS.md` and the code comments are in
English; the decision records in `docs/` are in Korean.

## Quick start

The minimal configuration is **Postgres plus one secret**. Everything else (mail, push, social sign-in,
identity verification, the managed-generation key, Redis) is optional and reported as off rather than
blocking startup.

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

**The first administrator comes from the operations console.** While a deployment has no admin, the API
prints a one-time setup code each time it starts (`docker compose logs api | grep "\[setup\]"`, or the
terminal running `pnpm dev:api`). Open `/setup` in the console (`http://localhost:3002/setup` locally),
create or sign in to the account that will run the deployment, and enter the code. That account becomes
`admin`, setup closes for good, and the page ends with what the deployment has turned on and which
variables turn on the rest. A deployment that already has an admin when it boots never opens setup.

`db:seed:dev-user` creates `dev@rowcat.test` with password `rowcat-dev` (pass an email and password as
arguments to choose others). It marks the email as verified, opens the identity and adult gates, and puts
the account on the managed-generation allowlist. It refuses to run with `NODE_ENV=production`.

**AI generation needs a key from somewhere.** Managed generation uses `OPENROUTER_API_KEY` in
`apps/api/.env`; without it, managed requests answer 503 and everything else keeps working. Any member can
instead connect their own Anthropic or Gemini key under AI settings — that path never touches this server.
`MANAGED_GENERATION_ACCESS` decides who may use the operator's key (`allowlist`, the default, or
`everyone`).

**Deploying is four values, not two.** Locally the origins fall back to localhost; a production deployment
also sets `WEB_ORIGIN` and `API_ORIGIN` (and `AUTH_COOKIE_DOMAIN` when web and API sit on different hosts).
With those four, `pnpm env:doctor --mode production --file <env file>` reports no release blockers and names
every feature that stays off — see `docs/ops/CONFIGURATION.md` (최소 구성).

To reach Postgres from a shell without the override: `docker compose exec db psql -U rowcat rowcat`.

### Running the published images

Every push to `main` publishes the three app images to GHCR (`.github/workflows/images.yml`), and they
carry no deployment value — web and the operations console take the API origin from their environment
when they start. So a deployment needs no build:

```bash
cp .env.example .env   # set BETTER_AUTH_SECRET and POSTGRES_PASSWORD, and for a real domain WEB_ORIGIN, API_ORIGIN, VITE_API_ORIGIN
docker compose up -d   # pulls api, web and admin; Postgres and Redis come along
```

Both secrets are generated, never copied: `openssl rand -base64 32` for `BETTER_AUTH_SECRET`, `openssl rand
-hex 24` for `POSTGRES_PASSWORD` (hex goes into the database URL unescaped). Compose will not start without
them, and the API refuses to boot in production on a short session key or on the old example password
`rowcat` — a database first created with that password needs `ALTER ROLE` before the upgrade
(`docs/ops/CONFIGURATION.md`, 개발 기본값은 운영 시크릿이 아니다).

`docker compose up --build` runs this checkout instead of the published images. Pin a deployment to one
build with `ROWCAT_IMAGE_TAG=sha-<commit>`; a fork that publishes its own images points
`ROWCAT_IMAGE_REGISTRY` at them (`docs/oss/FORKING.md` §15).

### On one computer, without Docker

`apps/desktop` packages the whole deployment as a desktop app — a bundled Postgres and the same three
builds, opened in its own window on `localhost`. Build the three apps, then
`pnpm --filter @rowcat/desktop package` writes an installer for the OS you run it on to `apps/desktop/out/`.
It is unsigned until a deployment signs it with its own certificates (`apps/desktop/README.md`).

## Repository map

pnpm workspaces (`apps/*`, `packages/*`), TypeScript strict, Biome, Turborepo for task ordering.

| Path | What |
| --- | --- |
| `apps/api` | Hono + Better Auth + Drizzle (Postgres). The one public API, `/v2` |
| `apps/web` | TanStack Start (SSR) + React 19 + TanStack Router/Query + Tailwind 4 |
| `apps/admin` | Operations console (Vite SPA, no SSR) |
| `apps/mobile` | Expo native client — SQLite, SecureStore, self-hosted OTA |
| `apps/mcp` | `@rowcat/mcp`, the stdio MCP server (`rowcat-mcp`) |
| `apps/desktop` | One-computer installer (Electron): bundled Postgres + the three builds |
| `packages/contracts` · `domain` · `sdk` · `query` | Wire shapes (zod) · product model · API client · TanStack Query policy |
| `packages/chat` · `authoring` · `markdown` | Pure rules for conversations, story drafts and message bodies |
| `packages/sync` | The sync protocol: envelope crypto, keyring, HLC, engine |
| `packages/runtime` · `runtime-compiler` · `runtime-host` | The creator language contract · source → artifact (no execution) · the QuickJS/WASM host |
| `packages/runtime-renderer-web` · `runtime-renderer-native` · `runtime-persistence` | Patch bundles → DOM / React Native · player saves |
| `packages/runtime-ai-docs` · `runtime-mcp` | The AI-readable runtime docs corpus · the MCP tool layer |
| `packages/design` · `ui-web` · `ui-native` | Design tokens · shared web components · shared native components |
| `docs/` | Decision records (Korean); `docs/public/runtime` is the creator-facing runtime documentation |

Layer rules — which package may import which — are the table in `AGENTS.md` ("Layer rules"), and each
package's `src/index.ts` header restates them.

## Verifying a change

```bash
pnpm check && pnpm typecheck && pnpm test
```

`pnpm check` runs Biome plus the drift checks for configuration and generated artifacts. The API tests use
a real Postgres (each test worker creates its own database) and skip when none is reachable.
`pnpm test:e2e` runs the Playwright browser journeys and starts the stack it needs. `pnpm test:compose`
boots the production compose stack, claims first-run setup and tears it down (`--build` to build this
checkout first). CI runs all three, and images and npm releases publish only a commit CI passed on.

## License

The repository is licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`),
see `LICENSE`.

Eight packages that form reusable building blocks are licensed under the **Apache License 2.0** instead,
each with its own `LICENSE` file: `packages/runtime`, `runtime-compiler`, `runtime-host`,
`runtime-renderer-web`, `runtime-renderer-native`, `runtime-persistence`, `runtime-ai-docs` and
`contracts`. Bundled third-party assets and their licenses are listed in `NOTICE`.

## Trademark

The code is yours to use under its license; the name is not. "RowCat" stays with this project. If you
deploy a fork, publish it under a different name and identity — `docs/oss/FORKING.md` lists every place
that carries the name, the app identity and operator-specific settings.

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to propose changes (DCO sign-off required)
- [SECURITY.md](SECURITY.md) — report vulnerabilities privately, not in public issues
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [docs/oss/FORKING.md](docs/oss/FORKING.md) — running your own deployment

## 한국어 요약

RowCat은 이용자가 이야기를 발행해 갤러리에 올리고, 그 이야기를 AI 대화나 샌드박스 안에서 도는 작은
프로그램으로 즐기던 UGC 서비스였다. 호스팅 서비스는 종료되었고, 이 저장소는 **그 코드**다 — 돌고 있는
인스턴스는 없다.

- 구성: 이야기 갤러리, 기기 로컬 우선 + 종단간 암호화 동기화되는 대화와 초안, 관리형(운영자 키)과
  BYO(이용자 키) 두 갈래의 AI 생성, QuickJS/WASM 샌드박스에서 크리에이터 TSX를 실행하는 런타임,
  웹·Expo 모바일·운영 콘솔·MCP 서버.
- 빠른 시작: `pnpm install && pnpm dev:setup && pnpm dev:all`. `dev:setup`이 env 파일 둘, 공유 시크릿, Docker의
  Postgres, 스키마, 개발 계정까지 만든다. 배포는 GHCR에 올라간 이미지를 `docker compose up -d`로 당겨 쓴다.
  로컬 최소 구성은 Postgres와 `BETTER_AUTH_SECRET` 하나이고(운영 배포는
  `WEB_ORIGIN`·`API_ORIGIN`까지 넷 — `docs/ops/CONFIGURATION.md` 「최소 구성」),
  `db:seed:dev-user`가 만드는 `dev@rowcat.test` / `rowcat-dev` 계정으로 로그인한다.
- 설계 근거: `AGENTS.md`가 색인이고, `docs/`와 각 파일 머리 주석이 이유를 적는다(`docs/`는 한국어,
  `AGENTS.md`와 코드 주석은 영어).
- 검증: `pnpm check && pnpm typecheck && pnpm test`
- 라이선스: 저장소는 AGPL-3.0-only, 런타임 계열 일곱 패키지와 `contracts`는 Apache-2.0(`NOTICE` 참고).
- 이름: 코드는 라이선스대로 쓰되 "RowCat"이라는 이름은 이 프로젝트에 남는다. 포크는 다른 이름으로
  배포한다 — 바꿀 자리는 `docs/oss/FORKING.md`.
- 기여는 `CONTRIBUTING.md`(DCO 서명 필요), 취약점 제보는 `SECURITY.md`.
