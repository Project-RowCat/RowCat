<!-- English or Korean is fine. See CONTRIBUTING.md. -->

## What

<!-- What does this change do? -->

## Why

<!-- The reason for the change. Link the issue if there is one. -->

## Impact scope

<!--
Which apps and packages does it touch (web · mobile · admin · API · MCP · packages/…)?
Does it change a wire contract, a stored or synced record, a migration, or a public runtime API?
-->

## Checklist

- [ ] `pnpm check && pnpm typecheck && pnpm test` passes locally
- [ ] Every commit is signed off (`git commit -s`, Developer Certificate of Origin)
- [ ] Commit subjects follow Conventional Commits
- [ ] Docs and file-header rationale are updated where behaviour changed (`AGENTS.md`, `docs/`)
- [ ] Generated files were regenerated with their command, not edited by hand (`AGENTS.md` → "Do not touch")
