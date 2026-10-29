import type {
	ChatNarrationSettings,
	NarrationBlockedReason,
	NarrationScope,
	PromptPackDensity,
} from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Copy for the narration screen. The rules live in `narration.ts` in `@rowcat/chat`.
 *
 * The copy lives here because the pure package holds no product copy. The `Record` tables pay for that:
 * adding a value to the vocabulary breaks compilation in this file.
 *
 * ## The legacy slang is not carried over
 *
 * The legacy words were `[anti-impersonation]`, `[impersonation]`, `[autoplay]`, the two pack names and
 * `simulation`. None of them says **what changes**. `Impersonation` names the failure mode in developer terms, while users
 * experience "the AI moves my character for me". The rest are aliases of the original work and
 * carry no meaning.
 *
 * Instead, each sentence states what changes. The value chosen here changes the nature of the
 * conversation (who writes my character), so it cannot be picked from a name alone.
 */

/**
 * The four narration scopes form **one dial**.
 *
 * The array order (`NARRATION_SCOPES`) is the screen order, and the left end gives the AI the least
 * of my character. The copy has to carry that continuity: read the four rows together and *how much
 * the AI writes for me* must grow in one direction. Otherwise this control becomes another list of
 * unrelated options.
 */
export const narrationScopeLabel = (key: NarrationScope): string =>
	translator("chat")(`narration.scope.${key}`);

export const narrationScopeDescription = (key: NarrationScope): string =>
	translator("chat")(`narration.scopeDescription.${key}`);

/** The state with no pack. It is the first tick on the dial. */
export const narrationOffLabel = (): string =>
	translator("chat")("narration.off");
export const narrationOffDescription = (): string =>
	translator("chat")("narration.offDescription");

/**
 * The two density values.
 *
 * The cost belongs in the copy. What this axis actually changes is the length of the prompt, which
 * is the token cost of each request; for a directly connected provider, it is that account's bill.
 * If the copy does not say so, the user experiences a rise in cost with no visible cause.
 */
export const narrationDensityLabel = (key: PromptPackDensity): string =>
	translator("chat")(`narration.density.${key}`);

export const narrationDensityDescription = (key: PromptPackDensity): string =>
	translator("chat")(`narration.densityDescription.${key}`);

/**
 * The cast-card axis, explained by **the difference the user sees**.
 *
 * The legacy label "character database maintenance assist" does not say what this axis does. What
 * actually happens is that one more character-state panel appears below the response. That fact is
 * confirmed by value in the pack bodies (`keys.test.ts` in `@rowcat/prompt-packs`, in a build that
 * carries them — the public release ships none, and then this pane is not reachable).
 */
/**
 * One line stating that the **other two axes exist** while the pack is off.
 *
 * The version without this line was the real problem. The default is `Off` (off), so on first
 * open only one tick is visible, and nothing on screen shows that density and cast cards exist.
 * That is the cost of not drawing unusable controls, and an invisible control is worse than a
 * disabled one, which at least says "it is here". The decision not to draw controls stands; only
 * the silence becomes a one-line statement of fact.
 */
export const narrationLockedHint = (): string =>
	translator("chat")("narration.lockedHint");

/**
 * The fact that this model has **only one** density.
 *
 * This slot used to draw nothing. The product default model is in the reduced family (one density),
 * so for most users that axis never appeared, and the screen stated only half of what it decided: a
 * value applied while nothing on screen showed it.
 *
 * This is a different sentence from `narrationDensityFoldedNotice()`. That one says a chosen value
 * was folded, which only means something to someone who chose it. This one tells someone who never
 * chose anything what applies now.
 */
export const narrationSingleDensityNotice = (label: string): string =>
	translator("chat")("narration.singleDensity", { label });

export const narrationCastLabel = (): string =>
	translator("chat")("narration.cast");
export const narrationCastDescription = (): string =>
	translator("chat")("narration.castDescription");

/**
 * The fact that this model does not accept the pack.
 *
 * **It does not tell the user to change models.** That decision is not this screen's: the model is
 * a device value and lives in another pane, and the user chose that model for a reason. Half of
 * this sentence says the stored setting is kept. Without that, the user cannot tell whether the
 * setting survives a return to a supported model.
 */
export const narrationUnsupportedNotice = (): string =>
	translator("chat")("narration.unsupported");

/** Shown when the catalogue could not be read. It claims nothing. */
export const narrationCatalogUnknownNotice = (): string =>
	translator("chat")("narration.catalogUnknown");

/** The fact that the stored density is not offered by this model, so it has been folded. */
export const narrationDensityFoldedNotice = (): string =>
	translator("chat")("narration.densityFolded");

export const narrationSaveFailureMessage = (): string =>
	translator("chat")("narration.saveFailed");

/**
 * Source credit: **it cannot be removed.**
 *
 * The body this screen handles is the original work (the Gosumdori project), and the port depends
 * on the original author's license grant. Legacy carried the same text in the same place. Dropping
 * it while moving the feature would move the feature and leave its conditions behind.
 *
 * It stands with the bodies. The public release ships none, so the pane that draws this is not reachable
 * (`PROMPT_PACKS_AVAILABLE`). The lines describe the grant RowCat held for its hosted service; a build
 * that carries bodies under a grant of its own rewrites them to that grant, here and in the mobile copy.
 */
export const narrationCredit = () => {
	const t = translator("chat");
	return {
		heading: t("narration.credit.heading"),
		lines: [
			t("narration.credit.line1"),
			t("narration.credit.line2"),
			t("narration.credit.line3"),
		],
		body: t("narration.credit.body"),
		thanks: t("narration.credit.thanks"),
	} as const;
};

/**
 * The summary on the settings home. It states the value **currently in effect**.
 *
 * The scope name alone is not used, for the same reason as the persona row: a name alone does not
 * separate the chosen value from the value actually applied. In a conversation whose model does not
 * accept the pack, a bare `Autoplay` would describe a state that is not true.
 */
export function narrationRowSummary(
	settings: ChatNarrationSettings | null | undefined,
	blocked: NarrationBlockedReason | null,
): string {
	if (!settings) return narrationOffLabel();
	const label = narrationScopeLabel(settings.scope);
	if (blocked === "model-unsupported")
		return translator("chat")("narration.notApplied", { label });
	return settings.castTracking ? `${label} · ${narrationCastLabel()}` : label;
}
