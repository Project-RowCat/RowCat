import type {
	GenerationModelDto,
	ModelPromptPackDto,
	PromptPackDensityDto,
	PromptPackLineageDto,
} from "@rowcat/contracts/chat";
import { PROMPT_PACK_DENSITIES as PROMPT_PACK_DENSITY_VALUES } from "@rowcat/contracts/chat";
import type { GenerationTarget } from "./generation-preference.ts";
import { generationTargetKey } from "./generation-preference.ts";
import { applyNarrationOutputPolicy } from "./narration-output.ts";

/**
 * Narration pack: how the AI writes this conversation. A block of instructions placed near the
 * front of the system prompt.
 *
 * The pack bodies are original work (the hedgehog project, by its original author), kept in
 * @rowcat/prompt-packs. **The public release ships none**: the license RowCat held was granted for its
 * own features and no right to redistribute was established, so that package's loader table is empty and both apps leave the
 * narration row out (`docs/chat/NARRATION.md` §공개본). This file holds only the vocabulary and rules,
 * which stay so a build that carries bodies it may use gets the whole feature back.
 *
 * Three axes, each of a different nature:
 * - scope: how far the AI writes the user's character. The one axis the user can judge.
 * - density: how finely things are described. Allowed only where the model permits it.
 * - castTracking: whether a character status panel is drawn too. A visible difference.
 *
 * The legacy UI exposed these as three dropdowns with slang names. The names were changed on
 * purpose. The four scope values form one scale, from not writing the user's character to writing
 * all of it, and the names should show that.
 *
 * Not here:
 * - The pack bodies. They would drag about 660 KB into everything that imports @rowcat/chat,
 *   including apps/api, which never reads them.
 * - Which model gets which pack. The server catalog answers that (GenerationModelDto.promptPack).
 *   The legacy screen checked model.includes('haiku').
 * - Labels and descriptions. Those belong to the app.
 * - Pack aliases (hedge, thumbs, deepseek). They are body file names; they appear only in the one
 *   table below.
 */

/**
 * Array order is the order of the on-screen scale. The left end uses the user's character least,
 * the right end most. A commit that reorders this array flips the on-screen scale, so the order is
 * decided in this one place.
 * - strict: the AI never writes the user's character. It continues from after the user's last
 *   action.
 * - reactive: characters react to everything the user did. (default)
 * - assisted: the AI also continues the user's character's actions and dialogue.
 * - auto: the AI also writes the user's thoughts and feelings.
 */
export const NARRATION_SCOPES = [
	"strict",
	"reactive",
	"assisted",
	"auto",
] as const;
export type NarrationScope = (typeof NARRATION_SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set(NARRATION_SCOPES);

/**
 * Whether the stored value still belongs to this vocabulary. Used only at the read boundary.
 * Another device may have uploaded an old version of a room record. An unknown value that passed
 * through would yield undefined from the alias table below, creating a key that does not exist.
 * That key has no body, so it silently becomes a prompt without a pack, for that room on that
 * device only.
 */
export const isNarrationScope = (value: unknown): value is NarrationScope =>
	typeof value === "string" && SCOPE_SET.has(value);

/** The density vocabulary's source is the contract. The catalog sends the same values. */
export type PromptPackDensity = PromptPackDensityDto;
export const PROMPT_PACK_DENSITIES = PROMPT_PACK_DENSITY_VALUES;

const DENSITY_SET: ReadonlySet<string> = new Set(PROMPT_PACK_DENSITIES);

export const isPromptPackDensity = (
	value: unknown,
): value is PromptPackDensity =>
	typeof value === "string" && DENSITY_SET.has(value);

/**
 * The narration settings for this conversation, held as a value on the room record. This belongs to
 * the room, not to the device preference (GenerationPreference). How this story is written is a
 * property of the story. A story started in autoplay on a Mac that comes back as a plain chat on a
 * phone is a different story, not a lost setting. The persona makes the same call. The cost:
 * density and variant are chosen by the model, and models differ per device. So the stored value is
 * a wish. resolveNarrationExecution decides what is actually sent this turn. There is one way to
 * express 'no override': the absence of this object. 'Off' is not stored as a value. With no layer
 * to inherit from, absence and off mean the same thing, and two shapes would make two records of
 * the same fact.
 */
export interface ChatNarrationSettings {
	scope: NarrationScope;
	/**
	 * The density the user wants. If the current model does not offer this step, execution folds to
	 * the first step the model has, but the stored value stays. Returning to a model that supports it
	 * should bring back the value the user picked.
	 */
	density: PromptPackDensity;
	/**
	 * Whether the character card panel is drawn too. This is a visible difference: when on, the pack
	 * appends a character status block at the end of every response, drawn as a collapsed panel under
	 * the conversation. The wording relies on this fact, which is not just a token cost. The fact is
	 * confirmed by value against the pack bodies (keys.test.ts in @rowcat/prompt-packs, in a build
	 * that carries them).
	 */
	castTracking: boolean;
}

/**
 * The starting point for a room that turns a pack on. reactive is the neutral point of the scale:
 * it neither writes the user's character for them nor cuts their actions. light is the density
 * every variant has; the reduced lineage has only that one. The character card is off because
 * drawing more on screen should be a choice the user makes.
 */
export const DEFAULT_NARRATION_SETTINGS: ChatNarrationSettings = {
	scope: "reactive",
	density: "light",
	castTracking: false,
};

/**
 * Stored value to settings. Never throws, for any input; an unknown shape returns null. null means
 * the same as 'no pack'. A damaged record falls to a room without a pack, so the worst case is
 * 'same as before'. Throwing would show the user a broken conversation instead of a settings
 * problem.
 */
export function readNarrationSettings(
	value: unknown,
): ChatNarrationSettings | null {
	if (typeof value !== "object" || value === null) return null;
	const { scope, density, castTracking } = value as Record<string, unknown>;
	if (!isNarrationScope(scope)) return null;
	if (!isPromptPackDensity(density)) return null;
	if (typeof castTracking !== "boolean") return null;
	return { scope, density, castTracking };
}

/**
 * The only place in this repo where pack aliases appear. hedge, thumbs and deepseek are the
 * original author's names and the body file names. They are not product vocabulary. They do not
 * appear in the contract (PromptPackLineageDto uses standard and reduced), in room records, or on
 * screen. The alias is translated once, here. If this table were scattered, renaming a body file
 * would break stored room settings and shipped clients together.
 */
const LINEAGE_ALIAS: Record<
	PromptPackLineageDto,
	Record<PromptPackDensity, string>
> = {
	standard: { light: "hedge", rich: "thumbs" },
	/**
	 * The reduced lineage has one density (the catalog answers densities: ['light']). Both cells are
	 * still filled, so the table works as a global function. An empty cell could yield undefined,
	 * which would create a key that does not exist.
	 */
	reduced: { light: "deepseek", rich: "deepseek" },
};

const SCOPE_ALIAS: Record<NarrationScope, string> = {
	strict: "anti",
	reactive: "basic",
	assisted: "imp",
	auto: "auto",
};

/**
 * The key that @rowcat/prompt-packs uses to find a body. That package knows no product vocabulary
 * and takes only a string, so the rule that builds the key must live in one place. If two apps
 * assembled it separately, the mismatch would compile and pass tests, while the pack silently went
 * missing in one app only.
 */
export const promptPackKey = (
	lineage: PromptPackLineageDto,
	settings: ChatNarrationSettings,
): string =>
	`${LINEAGE_ALIAS[lineage][settings.density]}:${SCOPE_ALIAS[settings.scope]}:${
		settings.castTracking ? "sim" : "compact"
	}`;

/**
 * All keys this repo can produce: the product of the vocabularies. Exported as values so the
 * pairing can be checked.
 * @rowcat/prompt-packs derives keys from its own file list; this side derives them from the
 * vocabulary. That the two sets match can only be checked where both packages can be imported
 * together, so the comparison lives at the app assembly point, as the three copies of compareRev
 * do.
 */
export const NARRATION_PACK_KEYS: readonly string[] = [
	...new Set(
		(["standard", "reduced"] as const).flatMap((lineage) =>
			NARRATION_SCOPES.flatMap((scope) =>
				PROMPT_PACK_DENSITIES.flatMap((density) =>
					[true, false].map((castTracking) =>
						promptPackKey(lineage, { scope, density, castTracking }),
					),
				),
			),
		),
	),
].sort();

/**
 * Used exactly as the catalog sends it. Restating the shape here would silently drop an axis the
 * day the server adds one.
 */
export type PromptPackCapability = ModelPromptPackDto;

/**
 * The three results of the capability lookup. null and undefined are different facts.
 * - Capability object: the target takes the pack, and density can be chosen from what is listed.
 * - null: the catalog said no pack applies to this target.
 * - undefined: unknown (the catalog was not received, or the entry is missing). No claim is made.
 *   Folding the last two together would turn a brief network hiccup into 'this model does not
 *   support narration packs', and the screen would look as if it erased the user's chosen setting.
 *   reasoning.ts has the same three cases.
 */
export type PromptPackCapabilityLookup =
	| PromptPackCapability
	| null
	| undefined;

export interface PromptPackCapabilityInput {
	models: readonly GenerationModelDto[];
	/**
	 * Whether the catalog was actually received. On failure `models` is empty, and every target would
	 * read as unsupported.
	 */
	catalogLoaded: boolean;
	/** The target currently in effect: the override if set, otherwise the inherited target. */
	target: GenerationTarget;
}

/**
 * Finds a target's pack capability in the catalog. The only key linking a target to a catalog entry
 * is generationTargetKey. Comparing provider and model separately here would create a second copy
 * of that rule, and one day the model picker and this lookup would pick different entries.
 */
export function promptPackCapabilityFor(
	input: PromptPackCapabilityInput,
): PromptPackCapabilityLookup {
	if (!input.catalogLoaded) return undefined;
	const entry = input.models.find(
		(model) => model.id === generationTargetKey(input.target),
	);
	/** A target missing from the catalog (a retired model) makes no claim: undefined, not null. */
	if (!entry) return undefined;
	return entry.promptPack;
}

/**
 * Why no pack is applied. This value decides what the screen says.
 * - not-configured: this conversation is set not to use a pack. The screen says nothing.
 * - model-unsupported: the chosen model does not take a pack. The screen says so in one line.
 * - catalog-unknown: the catalog could not be loaded, so the answer is unknown. The screen makes
 *   no claim. The last case is not folded into model-unsupported. That would be a lie: during a
 *   network blip, users would be told the model is unsupported and go change a model they did not
 *   need to change.
 */
export type NarrationBlockedReason =
	| "not-configured"
	| "model-unsupported"
	| "catalog-unknown";

/**
 * What is actually applied this turn. It can differ from the stored settings. `scope` appears again
 * here, which is the point of this type. The assembler and the guard must read this value, not the
 * stored settings. See resolveNarrationExecution for the reason.
 */
export interface NarrationExecution {
	/** The key that @rowcat/prompt-packs uses to find the body. */
	packKey: string;
	/** The narration scope actually executed. The guard's conditional check reads this value. */
	scope: NarrationScope;
	/**
	 * The density actually executed. If this model does not offer the stored density, this is the
	 * folded value.
	 */
	density: PromptPackDensity;
	/**
	 * Whether the cast-status table is drawn alongside this turn. This is the one line the output
	 * policy reads. packKey already folds the variant (sim or compact), but that key is a string used
	 * to find the body, not a verdict. If the policy parsed the key with endsWith(':sim'), that parse
	 * would silently answer the opposite the day the alias table changes, producing the state where
	 * the card appears in a conversation that turned it off.
	 */
	castTracking: boolean;
	/**
	 * Whether the stored density was folded because this model lacks it. The basis for the screen to
	 * say so.
	 */
	densityFolded: boolean;
}

/**
 * Stored settings plus this target's capability give what is actually applied this turn. If the
 * pack is not applied, the guard is not released either. That is why this function exists. assisted
 * and auto mean the AI writes the user's character, so in those scopes the progress rule's line
 * ('do not describe the user on their behalf') and the last line of the persona block must be
 * removed. If those lines were removed based on the stored setting, a model that cannot take the
 * pack would have no rule at all: the protective sentence is gone, and the pack body meant to
 * replace it is not applied. So the assembler and the guard read this function's result, not the
 * stored scope. If the result is null, the prompt is identical to what it was before this axis
 * existed. Density folds; the stored value stays. There is only one layer, so there is nothing to
 * clear. The density folds to the model's first step at execution time, and the stored value is
 * kept for when a supporting model returns.
 */
export function resolveNarrationExecution(input: {
	settings: ChatNarrationSettings | null | undefined;
	capability: PromptPackCapabilityLookup;
}): NarrationExecution | null {
	if (!input.settings) return null;
	/**
	 * When unknown, do not apply a pack. Guessing the stored scope while the catalog is not loaded
	 * would switch that room to a different pack on this device only. Running without a pack is the
	 * 'same as before' outcome.
	 */
	if (!input.capability) return null;
	const { lineage, densities } = input.capability;
	const supported = densities.includes(input.settings.density);
	const density = supported
		? input.settings.density
		: (densities[0] as PromptPackDensity);
	const settings = { ...input.settings, density };
	return {
		packKey: promptPackKey(lineage, settings),
		scope: settings.scope,
		density,
		castTracking: settings.castTracking,
		densityFolded: !supported,
	};
}

/**
 * Screen only: the assembler does not call this function. It is split from the execution resolver
 * because they answer different questions. The resolver answers what gets applied. This one answers
 * what to tell the user about why nothing is applied. A single function would force the assembler
 * to carry screen wording.
 */
export function narrationBlockedReason(input: {
	settings: ChatNarrationSettings | null | undefined;
	capability: PromptPackCapabilityLookup;
}): NarrationBlockedReason | null {
	if (!input.settings) return "not-configured";
	if (input.capability === undefined) return "catalog-unknown";
	if (input.capability === null) return "model-unsupported";
	return null;
}

/**
 * Whether the AI writes the user's character in this scope. The guard's conditional check reads
 * this one line. If each call site spelled out the comparison (scope === 'auto' || scope ===
 * 'assisted'), every copy would need updating by hand, and a missed one would drop the protective
 * sentence without the pack, or the reverse. This is a Record rather than a comparison, so adding a
 * scope breaks compilation until it is filled in here.
 */
const NARRATES_USER: Record<NarrationScope, boolean> = {
	strict: false,
	reactive: false,
	assisted: true,
	auto: true,
};

export const narrationWritesUser = (scope: NarrationScope): boolean =>
	NARRATES_USER[scope];

/**
 * Attaches narration settings to the room record, or clears them. With no settings, the key is not
 * created. Same rule and same reason as applyRoomPersona. undefined (no key) and null mean the same
 * to readers, but when both shapes coexist in storage, one fact becomes two different objects. That
 * shows up as 'applying the same page twice gives different results' across a two-device round
 * trip, which is where protocol idempotence is checked. The absent form is canonical. Rooms created
 * before this axis have no key, and leaving them unrewritten is the whole migration strategy for
 * this feature.
 */
export function applyRoomNarration<
	T extends { narration?: ChatNarrationSettings | null },
>(room: T, narration: ChatNarrationSettings | null): T {
	if (narration) return { ...room, narration };
	const { narration: _cleared, ...rest } = room;
	return rest as T;
}

/**
 * The narration pack given to the assembler: body and verdict bundled as one value. Why one value
 * rather than two arguments: separate text and writesUser would let a caller pass the body-less
 * combination, with the protective sentence removed and no body to replace it. The model would then
 * judge with no basis. As one value, that combination cannot be expressed.
 */
export interface ChatNarrationInjection {
	/** The pack body, already received. If empty, this value is not created at all. */
	text: string;
	/**
	 * Whether the AI writes the user's character in this conversation. The progress rules and the role
	 * block read it.
	 */
	writesUser: boolean;
}

/**
 * Execution verdict plus the received body gives the value for the assembler. If either is missing,
 * null. The body can be empty in practice: the caller did not call ensurePromptPack(), an older
 * device's room setting points at a combination that no longer exists, or loading failed. In all of
 * those cases the answer is the same: no pack, and the protective sentence stays as it is. The
 * prompt returns to what it was before this axis existed.
 */
export function narrationInjection(
	execution: NarrationExecution | null,
	body: string,
): ChatNarrationInjection | null {
	if (!execution || !body.trim()) return null;
	return {
		/**
		 * The body does not go out unchanged. The output policy follows it, and when the character card
		 * is off, the lines directing that table are removed (narration-output.ts). This function is the
		 * only place where the body and the verdict meet, which is why it does this. If the web and
		 * mobile generation hooks each attached the policy, one of them would eventually forget. The
		 * character card would then reappear in that app only, with no error on screen.
		 */
		text: applyNarrationOutputPolicy(body, execution),
		writesUser: narrationWritesUser(execution.scope),
	};
}
