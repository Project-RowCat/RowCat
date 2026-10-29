/**
 * @rowcat/prompt-packs: the narration pack bodies, and their lazy loader.
 *
 * **The public release ships no bodies.** RowCat carried twenty-four, a third party's original work
 * (the hedgehog project) ported under a license granted for RowCat's own features. A right to
 * redistribute them was never established, so they were removed before the code was published, so the loader table is empty and
 * `PROMPT_PACKS_AVAILABLE` is false: the narration axis is still stored and synced, but nothing is
 * injected and neither app draws the narration row (`docs/chat/NARRATION.md` §공개본).
 *
 * This package exists for weight. Bodies run to hundreds of kilobytes. Inside @rowcat/chat, everything
 * that imports it (including apps/api) would carry them, yet the server never reads this text:
 * assembly happens on the device. The vocabulary and rules stay in @rowcat/chat's narration.ts;
 * only the bodies live here.
 *
 * Not here, and why:
 * - Product vocabulary. Axes such as narration scope, description density and the character DB are unknown to this package. It
 *   receives a single string key; the rule that builds the key lives in @rowcat/chat. Repeating the
 *   vocabulary here would create two tables that drift apart.
 * - Model capability. Which target reads which family is answered by the server catalog
 *   (GenerationModelDto.promptPack). A table here would go stale as models are added.
 * - Dependencies. There are none: no contracts, zod or React. This package knows only strings.
 *
 * Bodies are not edited. They are someone's original work. Even a typo or line break fix would make
 * the repo hold a fork with no record of what was kept. Updates replace the whole body.
 *
 * Why preload: the assembler (buildChatGenerationRequest) is synchronous and cannot await. The
 * caller runs ensurePromptPack() just before generation and passes the already-loaded strings in,
 * the same way summaries and memory are passed. Once the assembler knows about loading, it is no
 * longer pure.
 */

import { PROMPT_PACK_LOADERS } from "./loaders.generated.ts";

/**
 * Every key this package actually holds, derived from the loader table. A hand-written list could
 * drift: delete a file and leave its name in the list, and that key claims to exist but cannot be
 * opened. That failure would surface only after the user had selected the combination.
 */
export const PROMPT_PACK_KEYS: readonly string[] =
	Object.keys(PROMPT_PACK_LOADERS);

/**
 * Whether this build holds any pack at all. Both apps read it to decide whether the narration row
 * stands in room settings (`roomSettingsRowAvailable` in @rowcat/chat).
 *
 * Derived from the loader table, not configured: a switch could say "on" in a build with no bodies,
 * and then the screen would offer settings that change nothing, which is the failure the server's
 * capability table already exists to prevent. A model taking a pack (the catalog) and this build
 * having one to give are two facts; the row needs both.
 */
export const PROMPT_PACKS_AVAILABLE: boolean = PROMPT_PACK_KEYS.length > 0;

/**
 * Whether a body exists for this key, regardless of whether it has been loaded. Used to validate
 * user choices.
 */
export const hasPromptPack = (key: string): boolean =>
	Boolean(PROMPT_PACK_LOADERS[key]);

/** Loaded bodies. Module scope: once filled, a body is not fetched again in the same runtime. */
const loaded = new Map<string, string>();
/** In-flight loads. Concurrent requests for the same key share one import. */
const inflight = new Map<string, Promise<string>>();

/**
 * Fetches one key's body. Unknown keys do not throw; they resolve to an empty string.
 *
 * This runs right before generation. A setting kept on the device may be from an older version (a
 * family may have been removed or renamed), and throwing would show the user a broken conversation
 * instead of a stale setting. An empty string makes the assembler skip the block, so the worst case
 * is 'same as before, without the pack.' Unknown keys are also deliberately settled as empty;
 * otherwise every turn would try to re-import a missing module.
 */
export async function ensurePromptPack(key: string): Promise<string> {
	const done = loaded.get(key);
	if (done !== undefined) return done;
	const running = inflight.get(key);
	if (running) return running;

	const loader = PROMPT_PACK_LOADERS[key];
	if (!loader) {
		loaded.set(key, "");
		return "";
	}

	const pending = loader()
		.then((module) => {
			loaded.set(key, module.default);
			return module.default;
		})
		.finally(() => {
			inflight.delete(key);
		});
	inflight.set(key, pending);
	return pending;
}

/**
 * Returns the body already loaded: empty if not loaded, and this never starts a load.
 *
 * It must stay synchronous because the assembler, a pure synchronous function, calls it. If it
 * could start a load, a caller that had not preloaded would silently build a prompt without the
 * pack on the first turn only, and the defect would vanish on the second turn, so nobody could
 * reproduce it. Filling and reading are split by name on purpose.
 */
export const promptPackBody = (key: string): string => loaded.get(key) ?? "";
