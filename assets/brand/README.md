# RowCat symbol

`rowcat-symbol.svg` is the source for the abstract symbol. It has a transparent background and
uses `currentColor`; inline web and native renderers follow the current foreground colour.

After editing it, run `pnpm brand:generate`. The existing desktop image toolchain generates:

- `packages/design/src/brand.ts`: platform-neutral path and viewBox, consumed by both UI packages.
- `apps/{web,admin}/public/favicon.svg`: light/dark browser favicon.
- `apps/{web,admin}/public/apple-touch-icon.png`: opaque 180px bookmark icon.
- `apps/mobile/assets/icon.png`: opaque 1024px launcher tile, also used by desktop packaging.
- `apps/mobile/assets/adaptive-icon.png`: transparent 1024px Android foreground within the safe zone.

`pnpm brand:check` checks generated output for drift and is part of `pnpm check`.
Launcher artwork retains the existing purple background (`#644ebd`); Android's
`adaptiveIcon.backgroundColor` in `apps/mobile/app.config.ts` must match the generator.
Changing the launcher artwork needs a new native build to appear on installed devices.
