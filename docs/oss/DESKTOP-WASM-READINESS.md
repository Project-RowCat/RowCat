# Desktop WASM release readiness — 2026-11-23

**Implemented and verified for internal Apple Silicon testing. Public beta is NO-GO.**
The desktop runs afterstate WASM through authenticated IPC and a Node Worker Thread;
its installer contains no native afterstate executable. An unsigned internal DMG was
built and tested. Windows execution, public macOS signing/notarization, complete native
library redistribution evidence, clean target-commit CI and large-history readiness
remain open. No release, tag, package upload or paid inference call was made.

## Source identity and reproducible baseline

| Repository | Starting/current HEAD | Working tree |
| --- | --- | --- |
| rowcat-oss | `fca38267e8d9422d33f3bab5a9e73e979e5ee2dc` | Existing user changes preserved; implementation uncommitted |
| afterstate | `c0cb19dbc8855cdc25c37657fa1a704e19afb463` | Existing WASM/character changes preserved; implementation uncommitted |

No new commits were created. These are working-tree results, not a claim that either
HEAD alone contains the implementation. Other character-memory work changed during this
session; it was preserved and is not attributed to this integration.

The independently reproduced baseline is preserved privately in
`.desktop-readiness/baseline/` (gitignored, mode 0700), with the original staging copy
at `/tmp/rowcat-wasm-readiness-baseline` on the build host. Each repository has a Git history bundle, binary dirty patch, untracked-file
archive, original status and SHA-256 manifest. Both were restored into independent
checkouts and their status matched exactly. Preserved native/WASM binaries and the old
local DMG are under its `artifacts/`. Archive checksums are recorded in
[verification.json](evidence/desktop-wasm/verification.json). These local source archives
and test profiles are not distributed. Reproduction uses `git clone history.bundle`,
`git apply --binary changes.patch`, then extraction of `untracked.tar.gz` into that clone.

The final afterstate artifact source-tree hash is `a77cbf391fc1dfa9b899ee2ef904629aa0191775b140e16b944fef34822c302f`;
its source is explicitly `dirty: true`. The public packager and release workflow reject
that state. Commit/review the engine changes upstream, refresh the pin from that clean
revision, then obtain target-commit CI evidence. Do not simply change the dirty boolean.

## Implemented engineering

- **Rust WASM:** portable SQLite snapshots; checksum/version/mapping validation; deletion
  fences; structural verification and normal projection/analyzer checks on restoration;
  borrowed serialization buffers to avoid an additional history-sized copy; a generation
  counter and linear-memory measurement. Metadata-only reconciliation now seeks through
  the existing namespace/source-reference index instead of materializing text/views or
  rescanning earlier pages. Retrieval, authorization and evidence algorithms remain Rust.
- **Desktop:** `afterstate-host.ts` owns bounded FIFO queues, IDs, timeouts, member isolation,
  crash detection/backoff, OS-keychain initialization deadlines, cleanup and graceful shutdown. `afterstate-worker.ts` owns the
  real Node WASM bindings, synchronous Rust operations and encrypted snapshots. Main checks
  the actual main frame/origin and authenticated `/v2/me` member. Authentication itself is
  serialized with operations, so it cannot reorder ingestion and erasure.
- **Persistence:** AES-256-GCM ciphertext only, with a member-bound AAD and an OS-safeStorage
  wrapped key. Ciphertext is streamed to a temporary file, fsynced and renamed. Interrupted
  files are discarded. Potential source erasure invalidates the old snapshot before work;
  no-op reconciliation uses Rust's dry-run planner rather than copying the entire index.
  A missing/corrupt/incompatible index rebuilds from authoritative records in bounded,
  idempotent batches. Unavailable OS key access fails closed; wrapped keys are not silently
  replaced. Account/local-derived-index destruction removes ciphertext and its key.
- **Lifecycle:** native `open/close/destroy` are replaced explicitly by construction/restore,
  free/termination and host file deletion. They are rejected as renderer-forwarded WASM
  operations. Per-member legacy native SQLite files are retired on authorized access or
  destruction; IndexedDB, drafts, sync/E2EE records and historical V2 user data are retained.
- **Packaging:** explicit source pin, checksummed allowlisted artifacts and mandatory real
  packaged-worker initialization. Packaged PostgreSQL/API/web/console boot in a scratch
  directory before installer creation. Production deployment uses the frozen lockfile,
  fixing the previous legacy-deploy re-resolution of newer dependency versions. Missing
  platform binaries or runtime artifacts stop the build. Internal mode has no update feed.
- **Release preparation:** pinned engine source/build tooling, Windows x64, Apple Silicon
  CI, immutable date releases, checksums, existing latest.yml/blockmap conventions, tag
  revalidation, and prepared installed/upgrade smoke. macOS signing/notarization is an
  explicit credentialed mode. [Signing procedure](DESKTOP-SIGNING.md).

### Architecture and authority

```text
Renderer + authoritative IndexedDB
  → unchanged shared conversation-memory adapter and final source/audience checks
  → narrow preload → main-frame/origin + authenticated member validation
  → bounded ordered IPC/host queue → dedicated member Worker → Rust WASM/SQLite
                                                       ↕
                                  authenticated encrypted derived snapshot
```

The index is never authoritative. Full original messages and full host revisions remain
in the existing store; the snapshot preserves the same source IDs/revision tokens and
provenance as native afterstate. Every restored conversation requires live manifests for
messages, notes and historical summaries before recall/facts/digests. The shared adapter
still checks exact current originals, scenes, note admission and final prompt provenance.
No sync key reaches Main/Worker and no index is uploaded. Character policy remains default-on
for eligible conversations; protected/unsupported-room policy and OOC separation remain.
No V2 fallback or user-selectable engine was introduced.

### Persistence choices and verification boundary

| Option | Result |
| --- | --- |
| New durable WASM/OPFS filesystem | Deferred; unnecessary new VFS/key/lifecycle surface for desktop |
| Versioned authenticated snapshot + incremental reconciliation | Selected; reuses SQLite/Rust and avoids reindexing unchanged records |
| Authoritative-store rebuild | Required safe fallback for missing, invalid or interrupted derived data |

Full replay verification on every restore was rejected after an exploratory 50k-message
restore took about 54 seconds. Restore instead checks envelope checksum, exact engine
version/mapping, SQLite identity/quick_check and ordinary engine consistency. `verify`
retains full event/FTS replay and is tested explicitly. SHA-256 alone is not authorization:
desktop authenticates ciphertext, then reconciles and rechecks live original sources.

## Compatibility and security evidence

Identical native/WASM fixtures cover ingestion/idempotency, reconcile, Korean/audience
filtering, character promise/fulfillment packets, source-time cutoffs, facts/corrections,
narrative provenance, OOC/unknown-audience isolation, edits, consolidation, erasure/sweep,
malformed JSON, oversized fields and error codes. Both measured builds use SQLite 3.54.1.

Two deliberate comparison differences are recorded: elapsed timing fields vary; the
`digests` endpoint's 12-hex revision derives from a random store-local memory ID. That
revision's format is checked separately. Deterministic hierarchical revisions and all
original `source_revisions` remain exactly compared. Native file storage, C ABI/sockets,
out-of-band interruption and threaded maintenance are native capabilities. WASM is
synchronous; a running call is cancelled by terminating its worker. Its 32 MiB framing
cap differs from native stdio's 128 MiB cap. These are documented, not silently emulated.

Tests cover repeated initialization, malformed/large inputs, wrong origins and members,
corrupt/symlinked artifacts, ciphertext tampering/member AAD, truncated/interrupted files,
worker timeout/crash/restart backoff, isolate OOM and memory-pressure retirement. Node
Worker resourceLimits do **not** constrain WASM linear memory: the module has a 1 GiB
hard cap, the host a 768 MiB soft limit, and at most two live member workers. OS-wide OOM
can still kill a process; low-memory real-system behavior is not cleared for release.

## Measurements

Hardware: Apple M1 Pro, 10 logical CPUs, 16 GiB RAM, macOS arm64. Rust 1.98.1,
wasm-pack 0.14.0, pnpm 10.34.5, Electron 45.1.0. Node-only comparisons used 22.23.2;
the packaged Electron benchmark used its actual Node v24.22.1 runtime.
Every size/transport uses a fresh process, the same synthetic history, 64-item batches,
30 questions, explicit perspectives and character budget. No inference service is used.
Cold means a fresh process/engine, not flushed OS caches. Development/validation activity
was not a dedicated benchmark lab; small cross-run differences are not definitive regressions.

### Native bridge versus WASM inside the actual packaged Electron runtime

Paired values are native / WASM. Latency is milliseconds; indexing/restore is seconds.

| Messages | Index s (N / W) | Messages/s (N / W) | Native warm p50 / p95 | WASM warm p50 / p95 | WASM restore s | WASM peak MiB |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0.23 / 0.52 | 4280 / 1919 | 1.97 / 2.26 | 3.34 / 4.11 | 0.30 | 165 |
| 10,000 | 2.16 / 3.74 | 4621 / 2673 | 2.55 / 3.05 | 4.21 / 4.66 | 1.82 | 271 |
| 50,000 | 12.76 / 19.58 | 3920 / 2553 | 5.12 / 5.97 | 7.50 / 8.09 | 8.90 | 730 |
| 100,000 | 31.67 / 43.24 | 3157 / 2313 | 8.20 / 13.29 | 11.64 / 12.46 | 17.91 | 1293 |

All four sizes found 30/30 synthetic expected targets with zero forbidden-audience hits.
This is fixture accuracy, not broad semantic/held-out-model accuracy. Narrative and dense
fact behavior is covered separately by regressions; the throughput workload is not a full
RowCat 100k-history UI/IndexedDB benchmark. Peak RSS includes edits/erasure and snapshot
export/restore: native engine peak is measured with `/usr/bin/time`, then conservatively
added to its driver's separate peak; WASM is one process including driver and Worker.
It is not an exact simultaneous native process-group peak comparison.

At 100k, packaged Electron WASM indexed in 43.24s versus
31.67s native; 64 edits took
15.61s versus 8.66s.
Snapshot restoration took 17.91s and process peak was
1293 MiB. The raw worker benchmark reached about
894 MiB linear memory, above the production soft
limit; the production host retires that worker and requires recovery/reconciliation.
**This is an unresolved large-history release limitation, not a passed performance gate.**

### Before/after reconciliation (same Node 22 workload)

| Messages | Before cold ms | After cold ms | Speedup | After warm ms |
| --- | --- | --- | --- | --- |
| 1,000 | 74.0 | 7.8 | 9.4× | 2.6 |
| 10,000 | 704.9 | 58.4 | 12.1× | 19.5 |
| 50,000 | 3441.6 | 336.1 | 10.2× | 100.6 |
| 100,000 | 7614.7 | 834.4 | 9.1× | 214.9 |

These compare the preserved pre-change binaries with the final implementation. The
before binaries are independently retained by hash; byte-identical rebuilding of those
historical binaries was not claimed. The source baseline itself was independently restored.

Actual renderer → authenticated Main → worker status round trips (30 requests) measured
p50 9.68 ms / p95 18.74 ms. These include authentication and status work;
they are not a zero-work subtraction of pure IPC overhead. Raw measurements are in
[before](evidence/desktop-wasm/before-node.json), [after](evidence/desktop-wasm/after-node.json),
[packaged Electron](evidence/desktop-wasm/electron-paired.json) and
[IPC](evidence/desktop-wasm/ipc-latency.json).

## Executed validation

| Check | Observed result |
| --- | --- |
| Baseline desktop / chat / WASM / native bridge | 50 / 1,273 / 4 / 90 passed |
| Final desktop unit/integration | 64 passed |
| Native core including failpoints / bridge | 359 / 91 passed |
| Real Node WASM + differential / browser ESM bindings under Node | 7 / 6 passed |
| Shared chat / web / mobile in repository run | 1,274 / 4,590 (+2 skipped) / 3,473 passed |
| `pnpm check`, complete TypeScript checks | Passed; desktop E2E explicitly added to type checking |
| Full `pnpm test` | Failed API run: 13 tests, 17 files, one worker error; remaining API tests passed |
| Sequential rerun of all 17 failed API files | 413 passed; supports a concurrency/environment cause, not a clean full-run pass |
| Real staged Electron UI/recovery journey | 22 passed, 0 failed |
| Packaged WASM + fresh PostgreSQL/API/web/console | Passed |
| Same packaged smoke with development tools removed from PATH | Passed |
| Public packaging with dirty source pin | Correctly refused |
| Windows installer / installed upgrade / real Windows | Prepared in CI; not executed here |
| macOS Developer ID signing/notarization/Gatekeeper/Intel | Not executed |

The UI journey uses synthetic accounts and a local mock provider. It verifies automatic
old-event recall beyond the history window, historical editing, deletion, ciphertext at
rest, authenticated-member rejection, clean restart, an actual API crash/restart, and an
unclean Electron exit with stack recovery and deletion remaining absent. Earlier harness
runs stopped at the legitimate language-onboarding dialog; the harness now waits for its
own closing transition and targets the actual provider form. Those aborted runs are not
reported as passes. [Final journey results](evidence/desktop-wasm/window-recovery.json).

The final unsigned Apple Silicon DMG is `apps/desktop/out/RowCat-0.0.0-arm64.dmg`:
202,803,627 bytes, SHA-256 `0791b356583fea16695ca7c7f6db2b49b4891ad58a075fea08419b6c8b403bde`. Its blockmap/checksums are in
[verification.json](evidence/desktop-wasm/verification.json). The preserved old local DMG
was 199,311,603 bytes. This comparison also includes changed application outputs and
frozen dependency staging; the size delta is not attributed solely to WASM.
It is an internal artifact, with no update feed, not signed/notarized/publicly released.

## Release matrix

| Target | Decision | Blocking evidence/work |
| --- | --- | --- |
| Internal desktop alpha | **GO, scoped to Apple Silicon engineering/testing and bounded histories** | Keep explicit internal mode, backups and the listed large-history limitations; no Windows support claim |
| Windows public beta | **NO-GO** | Clean upstream source pin + target-commit CI; actual Windows installer/upgrade/feed tests; real-device QA; complete native redistribution inventory; acceptable large-history/low-memory behavior |
| macOS public beta | **NO-GO** | Above platform-independent gates; real Developer ID/notarization/stapling/Gatekeeper checks; clean-user/manual-upgrade QA; define tested architectures. Self-update remains disabled |
| General stable | **NO-GO** | All beta gates, sustained-session/large-history/pressure testing, real existing-user migrations and broader retrieval/evidence evaluation |

## Remaining risks and maintainer actions

1. **Source publication/pinning:** the engine changes are uncommitted and the pinned HEAD
   predates them. Publish no release from this state. Commit/review/push source through the
   maintainer's normal process, refresh the clean pin and run CI on the exact RowCat commit.
2. **Performance:** 100k restart/peak memory and bulk edits remain too costly to call
   release-ready. Full RowCat 100k IndexedDB reconciliation, encrypted periodic checkpoint
   overhead, queued recall deadlines, long-session churn and low-memory Windows behavior
   need measurement/tuning. The existing 400 ms recall deadline can yield a visible degraded
   state during catch-up; recent-window generation can continue without recall. No V2 fills
   that gap. Whether that behavior meets beta expectations has not been signed off.
3. **Platform/update evidence:** Windows installed smoke is prepared, not executed. Its
   sentinel/account/port check is not proof of all real conversation/draft/E2EE-key migrations
   or auto-downloaded quit/install behavior. No PostgreSQL major version changed; a future
   major bump still needs the existing explicit cluster-upgrade procedure.
4. **Native redistribution:** the packaged PostgreSQL tree contains ICU, OpenSSL, libedit,
   libiconv/libintl, Kerberos and other native libraries. The wrapper MIT license/README's
   Apache description is not a complete per-library notice/corresponding-source inventory.
   Close that inventory before public distribution. The WASM artifact includes 65 dependency
   notices; a missing rsqlite-vfs license was recovered from its exact upstream revision.
5. **Existing audits remain binding:** source/asset ownership decisions recorded in
   RIGHTS-AUDIT are preserved. Open operator actions in DISCLOSURE-AUDIT (old npm metadata,
   private reporting settings and past local installer-secret handling) were not performed.
   Existing SECURITY-REVIEW issues (including report-only web CSP) were not declared fixed.
   Filename/package allowlist audits passed; a fresh history-wide gitleaks run was not executed.
6. **Unsupported/unmeasured:** no automatic narrative labeling, new embedding/inference
   provider, OPFS persistence, native transport emulation or macOS auto-update was added.
   OS-key failure needs key access restored or authorized derived-index reset. Snapshot size
   and memory limits are explicit; successful small-history recovery is not a 100k soak test.

## Reproduction and primary references

Build/test instructions are in `apps/desktop/README.md`, afterstate `docs/wasm.md`, and
`crates/afterstate-wasm/tests/production-bench.mjs`. Packaging never needs a sibling checkout
at runtime: a developer prepares an explicit verified artifact, while release CI checks
out the pinned source. No release workflow was dispatched during this task.

The implementation follows [Electron IPC security](https://www.electronjs.org/docs/latest/tutorial/security),
[OS-backed safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage/),
[Node Worker resource limits](https://nodejs.org/api/worker_threads.html),
[electron-builder v26 signing](https://www.electron.build/v26/docs/mac/) and
[GitHub runner architecture labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
The code remains pinned to electron-builder 26.18.0 rather than silently adopting v27 schema.
