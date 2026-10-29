# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting: open the
repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue, pull request
or discussion for a suspected vulnerability.

A useful report includes:

- the affected component and commit
- the configuration needed to reach it (which settings are on — `pnpm env:doctor` output helps)
- steps or a proof of concept that reproduce it
- the impact you believe it has

We will acknowledge the report, keep you informed while we investigate, and credit you in the fix unless
you prefer otherwise. This is a volunteer-maintained project: there is **no bug bounty**, and response times
are best effort.

## Supported versions

Only the latest commit on the default branch is supported. Fixes are made there; there are no maintained
release branches.

There is **no hosted RowCat service** — it has been shut down, so there are no production systems,
accounts or user data operated by this project to test against. Do not probe deployments run by other
people; if you find an issue in someone else's fork, report it to them.

## Scope hints

Everything in this repository is in scope. These areas carry the strongest security claims, and reports
against them are especially valuable:

- **Authentication** — Better Auth configuration, trusted origins and redirects, two-factor and passkey
  policy, session listing that must never expose other sessions' tokens (`apps/api/src/auth/`,
  `apps/api/src/routes/me/account.ts`)
- **Remote-image proxy** — SSRF, DNS rebinding, redirect re-validation, response format and byte budgets
  (`apps/api/src/lib/remote-image/`)
- **Encrypted sync** — the claim that the server never decrypts, device pairing's channel binding, and that
  the owner is derived only from the session (`packages/sync/`, `apps/api/src/services/sync/`,
  `docs/sync/ARCHITECTURE.md`)
- **Creator runtime sandbox** — isolation of creator code in the QuickJS/WASM VM, the host capability table,
  generation only from user interaction, and the remote-asset allowlist (`packages/runtime-host/`,
  `docs/creator-runtime/`)
- **Managed generation access** — the allowlist and rate limits that guard the operator's provider key

Note that the runtime compiler's policy checks are documented as **not** a security boundary — the VM is.
A bypass of a compiler policy check alone is a bug, not a sandbox escape; an escape from the VM is a
vulnerability.
