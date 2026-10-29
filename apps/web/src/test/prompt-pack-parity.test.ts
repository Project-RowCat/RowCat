import {
	type ChatNarrationSettings,
	NARRATION_PACK_KEYS,
	type NarrationExecution,
	narrationInjection,
	type PromptPackCapabilityLookup,
	promptPackKey,
	resolveNarrationExecution,
} from "@rowcat/chat";
import {
	ensurePromptPack,
	PROMPT_PACK_KEYS,
	PROMPT_PACKS_AVAILABLE,
} from "@rowcat/prompt-packs";
import { describe, expect, it } from "vitest";

/**
 * Parity test: both packages must know the same packs. It also checks what the bodies instruct after
 * crossing the injection boundary.
 *
 * The public release ships no bodies (`docs/chat/NARRATION.md` §공개본), so "the same packs" is either
 * none or all twenty-four the vocabulary builds, and the body checks stand only in a build that carries
 * them.
 *
 * The check lives in the app because it is the only place both packages can be imported together.
 * @rowcat/chat cannot depend on @rowcat/prompt-packs: the bodies are about 660 KB and would be
 * pulled into apps/api. The reverse direction would make a pure data package know product
 * vocabulary, so it is blocked, as the three compareRev copies are.
 *
 * A mismatch fails silently. If the vocabulary builds a key with no body, conversations that pick
 * that combination run without the pack, with no error or warning. If a body remains with no
 * caller, a 660 KB file stays in the bundle unused.
 */
describe("narration pack key pairs", () => {
	/**
	 * None is a complete state (the narration row does not stand); a partial set is not. With some
	 * bodies present the row stands, and the combinations whose body is missing run without a pack on
	 * every turn.
	 */
	it("the build carries no bodies, or exactly the keys the vocabulary builds", () => {
		if (!PROMPT_PACKS_AVAILABLE) {
			expect(PROMPT_PACK_KEYS).toEqual([]);
			return;
		}
		expect([...NARRATION_PACK_KEYS].sort()).toEqual(
			[...PROMPT_PACK_KEYS].sort(),
		);
	});
});

/**
 * Pins the bug where the cast and character-state table appeared in conversations with the
 * character card turned off, across all twelve bodies.
 *
 * It checks the injected result, not the pack files. packs/*.ts are original works that this repo
 * never edits, so narrowing happens at the injection boundary (narrationInjection →
 * applyNarrationOutputPolicy).
 *
 * If a body's wording for the term changes, the filter silently stops removing the table, and users
 * see 'turned off but still shows' with no error. This test makes that silence visible, like the
 * fold-block name check in keys.test.ts.
 */
describe.skipIf(!PROMPT_PACKS_AVAILABLE)(
	"compact versions do not instruct a character status table",
	() => {
		/**
		 * Every name this screen uses for that table. Checking only one would miss variants that use the
		 * other.
		 */
		const CAST_TERMS = [/character database/i, /relation database/i];

		/** The execution verdict is set by hand. The catalog is not the axis under test here. */
		const execution = (
			key: string,
			castTracking: boolean,
		): NarrationExecution => ({
			packKey: key,
			scope: "reactive",
			density: "light",
			castTracking,
			densityFolded: false,
		});

		const compactKeys = [...PROMPT_PACK_KEYS].filter((key) =>
			key.endsWith(":compact"),
		);
		const simKeys = [...PROMPT_PACK_KEYS].filter((key) => key.endsWith(":sim"));

		it("splits twelve and twelve", () => {
			expect(compactKeys).toHaveLength(12);
			expect(simKeys).toHaveLength(12);
		});

		/**
		 * The file itself still contains the vocabulary, and recording that as a fact is half of the test.
		 * Removing it from the source and removing it from what the model receives are different facts.
		 *
		 * Without this line, the next reader would not know narrowing is needed and could read the filter
		 * as dead code for an already clean body.
		 */
		it("the original bodies really still carry that vocabulary", async () => {
			const bodies = await Promise.all(
				compactKeys.map((key) => ensurePromptPack(key)),
			);
			const dirty = bodies.filter((body) =>
				CAST_TERMS.some((term) => term.test(body)),
			);
			expect(dirty).toHaveLength(12);
		});

		it.each(
			[...PROMPT_PACK_KEYS].filter((key) => key.endsWith(":compact")),
		)("%s — the injected text lacks that vocabulary", async (key) => {
			const body = await ensurePromptPack(key);
			const injected = narrationInjection(execution(key, false), body);
			expect(injected).not.toBeNull();

			/**
			 * The prohibition sentence names the table itself, so the check looks only at the pack-derived
			 * part before the output-rules section. Scanning the whole text would make the test fail forever
			 * on our own prohibition.
			 */
			const fromPack = (injected?.text ?? "").split("# [출력 규약")[0] ?? "";
			for (const term of CAST_TERMS) expect(fromPack).not.toMatch(term);
		});

		/**
		 * The `sim` variant is never narrowed. If the directive vanished from conversations with the
		 * character card on, users who turned it on would see no table, and the failure would be silent
		 * again.
		 */
		it.each(
			[...PROMPT_PACK_KEYS].filter((key) => key.endsWith(":sim")),
		)("%s — the body is carried as is", async (key) => {
			const body = await ensurePromptPack(key);
			const injected = narrationInjection(execution(key, true), body);
			expect(injected?.text.startsWith(body.trimEnd())).toBe(true);
			expect(injected?.text).toContain("<summary>Character Database</summary>");
		});
	},
);

/**
 * Checks that the axis is wired from saved settings through to injection. This needs no real body: the
 * output policy that follows the body is ours, so a stand-in body proves the wiring in every build.
 *
 * The tests above set the execution verdict by hand, so they would miss a regression where
 * castTracking stops flowing from settings into execution. If that line disappears, the policy always
 * takes the 'on' side, and the table returns in conversations with the card off.
 */
describe("narration settings reach the injection boundary", () => {
	const settings = (castTracking: boolean): ChatNarrationSettings => ({
		scope: "reactive",
		density: "light",
		castTracking,
	});
	const STAND_IN_BODY = "# PREAMBLE\n\n{{char}} narrates; {{user}} acts.";

	it("the stored character card setting carries through to injection", () => {
		const capability: PromptPackCapabilityLookup = {
			lineage: "standard",
			densities: ["light"],
		};
		for (const castTracking of [true, false]) {
			const resolved = resolveNarrationExecution({
				settings: settings(castTracking),
				capability,
			});
			expect(resolved?.castTracking).toBe(castTracking);
			expect(resolved?.packKey).toBe(
				promptPackKey("standard", settings(castTracking)),
			);

			const injected = narrationInjection(resolved, STAND_IN_BODY);
			expect(injected?.text.includes("사용하지 않습니다")).toBe(!castTracking);
		}
	});
});
