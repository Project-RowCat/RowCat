# Contributing to RowCat

Thanks for taking the time. RowCat's hosted service is shut down; this repository is maintained as code
that others can read, run and fork. Bug fixes, documentation corrections and focused improvements are
welcome. For larger changes, open an issue first so the direction can be discussed before you invest in it.

## Developer Certificate of Origin

Every commit must be signed off under the [Developer Certificate of Origin 1.1](https://developercertificate.org).
By adding a `Signed-off-by` line you certify that you wrote the change, or otherwise have the right to submit
it under the license of the files it touches (AGPL-3.0-only for most of the repository, Apache-2.0 for the
packages that carry their own `LICENSE` — see the README).

```bash
git commit -s
```

This appends a line with the name and email from your Git configuration:

```text
Signed-off-by: Your Name <you@example.com>
```

Use a real name or a consistent identity you are known by. Pull requests with unsigned commits cannot be
merged; `git commit --amend -s` or `git rebase --signoff main` fixes them. There is no separate CLA.

## Getting set up

Prerequisites:

- Node.js 22 or newer
- pnpm at the version pinned in `package.json`'s `packageManager` field (`corepack enable`). Do not install
  with npm or yarn — the workspace and lockfile are pnpm's.
- Docker with Compose, for Postgres

The README's **Quick start** brings up a local stack (Postgres, migrations, a development account, web, API
and operations console).

## Before you open a pull request

Run the same verification CI runs:

```bash
pnpm check && pnpm typecheck && pnpm test
```

- `pnpm check` is Biome (lint and format) plus drift checks for environment configuration and generated
  artifacts. `pnpm format` fixes formatting; do not hand-align code.
- The API tests need a reachable Postgres (they skip without one) and create one database per test worker,
  so the database user needs `CREATEDB`. The default Compose user has it.
- If you change something a browser journey covers, `pnpm test:e2e` runs the Playwright suite.
- If you change the images, `docker-compose.yml` or first-run setup, `pnpm test:compose --build` builds the
  production stack from your checkout, boots it, claims first-run setup and tears it down (it needs ports
  3000-3002 free and leaves nothing behind).
- CI runs all of it — the suite with real Postgres and Redis (a test that skips for want of a service fails
  there), the journeys and the compose smoke — and the image and npm releases publish only a commit CI passed on.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), written in English: the subject is one
line, and the body states **why** the change was made, in a sentence or two.

```text
fix(sync): keep the pull cursor in the same transaction as the applied page

If a state where only the cursor commits is representable, that page's records never arrive.

Signed-off-by: Your Name <you@example.com>
```

Keep each commit to one logical change. Public versions are dates (`YYYY-MM-DD`), not SemVer — see
"Versioning" in `AGENTS.md`.

## Language

Code comments, commit messages, `AGENTS.md`, the root documents and the web app's default locale are in
English. The decision records under `docs/` are in Korean, as is the Korean product copy that the conversation
prompts carry (commits from before the open-source release also have Korean bodies). You do not need to write Korean to contribute: issues, pull requests and review
discussion in English are welcome. When you change behaviour that a Korean document explains, update that text
too (in Korean if you can; otherwise say so in the pull request and a maintainer will help).

## Where the rationale lives

This codebase writes down **why** it is shaped the way it is, and most "obvious simplifications" have
already been considered and rejected for a stated reason. Before changing a boundary, read:

- `AGENTS.md` — the index: the repository map, the boundaries that bind more than one package, and pointers
  into the rest
- `docs/` — decision records per area (sync, chat, creator runtime, moderation, OTA, …)
- the header comment of the file or package you are changing

Comments in this repository explain why, not what. When you create a new boundary, say in the file header
what it does not hold and why.

## Layer rules

Packages have strict dependency directions (for example: `@rowcat/sync` imports no React, Dexie, SQLite,
DOM, fetch or `sdk`; the runtime packages have empty or narrow dependency sets). The full table is "Layer
rules" in `AGENTS.md`, and each package's `src/index.ts` header restates its own. Several of these are
enforced by tests — if a boundary test fails, fix the change rather than the guard, and raise the conflict
in the pull request if you think the guard is wrong.

## Generated files

Some files are produced by tools and checked in. Never edit them by hand — edit the source and run the
generator; `pnpm check` fails when a generated file drifts from its source. The list (route tree, design
tokens, runtime declarations and sandbox, runtime docs and the AI corpus, `llms.txt`,
update notes, the mobile runtime harness assets, Drizzle migrations, and more) is the "Do not touch" table
in `AGENTS.md`, with the command for each.

## Code conventions

- Biome, tab indentation, double quotes, sorted imports
- Relative imports carry the file extension (`./lib/errors.ts`)
- File names are kebab-case; tests sit beside their target as `*.test.ts`
- `import type` for type-only imports

More in "Code conventions" in `AGENTS.md`.

## Reporting security issues

Do not open public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
