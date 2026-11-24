# Desktop signing and notarization

Public macOS distribution remains blocked until a release maintainer supplies
real credentials and validates the signed artifact. The local artifact produced
in this phase is **unsigned internal testing only**. No notarization was attempted.
Windows SmartScreen behavior is also not a substitute for publisher signing.

## Build identity and source

Use the exact RowCat commit whose CI and desktop rehearsal passed. Retain
`pnpm@10.34.5`, the frozen lockfile and `apps/desktop/afterstate-source.json`.
The afterstate source revision must be clean, reachable and match its reviewed
tree hash. A dirty pin blocks public packaging. Review the platform PostgreSQL
and native-library redistribution inventory before public distribution; the
existing wrapper MIT license alone is not that inventory.

The date remains the public name (`desktop-YYYY-MM-DD`, KST); the installer uses
`YYYY.M.D`. Never rebuild an already-published date. Only `desktop-release.yml`
creates the desktop GitHub release/update target. Source releases stay
`--latest=false`; temporary file drops stay drafts. No step below publishes.

## macOS release-maintainer procedure

1. Use a clean supported macOS runner (Apple Silicon first; Intel needs its own
   native dependencies and validation). Obtain a **Developer ID Application**
   certificate from the maintainer's Apple Developer account. Do not use an Apple
   Distribution/Mac App Store identity for direct DMG distribution.
2. Supply `CSC_LINK` and `CSC_KEY_PASSWORD` through the runner's protected secret
   store, or import the identity into an ephemeral keychain and set `CSC_NAME`.
   Never commit the `.p12`, password, keychain or Apple `.p8` file. Disable shell
   tracing and delete temporary credentials/keychains after the run.
3. Supply either the App Store Connect API-key variables `APPLE_API_KEY` (a
   temporary protected file path), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, or
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
4. Run the normal frozen install, build and explicit `prepare:afterstate` from
   the reviewed artifact. Package with `ROWCAT_MAC_SIGN=1`. The build requires
   signing and notarization credentials, enables hardened runtime, and grants
   only the V8 JIT entitlement. It never falls through to unsigned output in
   this mode. The pinned electron-builder is **26.18.0**: its signing options are
   the v26 flat `mac.*` keys, not the v27 `mac.sign.*` schema.
5. The packaging hook initializes WASM and boots the packaged PostgreSQL/API/web
   stack in a scratch directory. electron-builder signs nested Mach-O binaries,
   including PostgreSQL and native dependencies, then notarizes/staples. Verify
   its result independently (including every nested native executable/library):

   ```sh
   codesign --verify --deep --strict --verbose=2 'apps/desktop/out/mac-arm64/RowCat.app'
   spctl --assess --type execute --verbose=2 'apps/desktop/out/mac-arm64/RowCat.app'
   xcrun stapler validate 'apps/desktop/out/mac-arm64/RowCat.app'
   hdiutil verify apps/desktop/out/*.dmg
   shasum -a 256 apps/desktop/out/*.dmg apps/desktop/out/*.blockmap
   ```

6. On a separate clean Mac, download the quarantined DMG, mount it, drag the app
   to Applications, and launch through Finder with Gatekeeper enabled. Verify
   first-run setup, Keychain access, offline local memory, long-history restart,
   edit/erase, shutdown and manual upgrade over the previous supported build.
   Repeat on Intel before claiming Intel support. CI/Node-mode smoke is not this
   physical-device validation.

macOS self-update remains deliberately disabled by `selfUpdateSupported`.
This phase does not enable Squirrel.Mac or promise ZIP update compatibility.
Before enabling it, validate signed ZIP/feed generation, publisher identity
continuity, data preservation and actual quit/install behavior. A public macOS
beta must explicitly state manual upgrades until that work is completed.

## Windows

Build x64 on a Windows runner. `desktop-release.yml` validates the selected
commit, builds WASM from the clean source pin, checks packaged worker and stack
startup, installs a previous supported installer, then installs the new version
and verifies account, IndexedDB sentinel and fixed-port preservation. This is
prepared CI coverage; it has not been executed from this local macOS task.

Use an external Windows publisher certificate through electron-builder's
supported signing configuration. Do not print PFX material or credentials. Check
Authenticode, SmartScreen, a clean real Windows machine, offline behavior and the
actual updater path before public beta approval. The existing `latest.yml`,
installer name, `.blockmap`, date-version and never-downgrade rules are unchanged.
The NSIS upgrade smoke is not proof of an auto-downloaded update installing on quit.

## Evidence required before a public release

- Clean, reviewed source commits and reachable afterstate source pin.
- Full target-commit CI plus Windows installed/upgrade smoke results.
- Native PostgreSQL/library notices and corresponding-source obligations closed.
- Platform long-history memory/restart/edits within accepted budgets.
- Real macOS Developer ID credentials and independent signing/notarization checks.
  Windows retains the existing unsigned-beta policy unless the maintainer chooses
  a publisher certificate; SmartScreen still needs real Windows validation.
- Physical Windows/macOS Gatekeeper/upgrade checks, recorded separately from CI.
- Existing owner decisions in `DISCLOSURE-AUDIT.md` remain open until the maintainer
  confirms them; this task did not change npm metadata, rotate credentials or
  inspect private GitHub security settings.
