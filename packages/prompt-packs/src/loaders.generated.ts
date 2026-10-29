/* Pack key → lazy loader. Kept as a literal table; there is no generator command for it.
 *
 * **Empty in the public release.** The twenty-four bodies RowCat shipped are a third party's work, ported
 * under a license granted for RowCat's own features; a right to redistribute them was never established,
 * so they are not in this repository (`docs/chat/NARRATION.md` §공개본). An empty table is a complete state: every key answers
 * absent, `PROMPT_PACKS_AVAILABLE` is false, and both apps stop drawing the narration row.
 *
 * A deployment that holds bodies it may use puts one file per key under `./packs/` and one line per file
 * here, in the shape below. `import()` must take a **static string** for the bundler to split each key
 * into its own chunk; assembled from a variable, every body ends up in one chunk and even users with packs
 * off download all of them:
 *
 *     "hedge:basic:compact": () => import("./packs/hedge-basic-compact.ts"),
 *
 * Adding or removing a pack file updates this table too: `keys.test.ts` holds the pairing by comparing it with
 * the file list, and `apps/web/src/test/prompt-pack-parity.test.ts` holds it against the keys the vocabulary
 * builds (none, or all of them). */

export const PROMPT_PACK_LOADERS: Record<
	string,
	() => Promise<{ default: string }>
> = {};
