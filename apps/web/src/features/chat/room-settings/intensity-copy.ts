import type { ChatIntensity } from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Screen copy for expression intensity. The rules live in `intensity.ts` in `@rowcat/chat`.
 *
 * The copy lives here because the pure package holds no Korean. The `Record` tables pay for that:
 * adding a value to the vocabulary breaks compilation in this file.
 *
 * ## ⚠️ Prompt wording is not here
 *
 * This differs from the narration screen, where labels and descriptions are all screen copy. This
 * axis also has text the model reads. That text shares the character of the safety guards, so it
 * lives in the pure package (`chatIntensityBlock`). If each app wrote it separately, the same
 * setting would run at different intensities per platform. Only the human-facing side is here.
 */

/** The default: the middle of the scale. It is the absence of a stored key, not a stored value. */
export const intensityDefaultLabel = (): string =>
	translator("chat")("intensity.default");
export const intensityDefaultDescription = (): string =>
	translator("chat")("intensity.defaultDescription");

/**
 * Labels for the two values.
 *
 * `Intense` is not written as `High`. This axis changes the degree of exposure of description, not
 * the amount, and a high/low word would read as the same kind of value as the neighbouring `Response length`
 * (response length).
 */
export const intensityLabel = (key: ChatIntensity): string =>
	translator("chat")(`intensity.label.${key}`);

/**
 * Descriptions say what changes and also what does not.
 *
 * The second sentence of `softened` matters most. Someone who reads this setting as "the story gets
 * gentler" expects conflict and tension to disappear too, and when they do not, they conclude the
 * setting is broken. The prompt wording draws the same boundary (`intensity.ts`), so the screen
 * must say the same thing.
 */
export const intensityDescription = (key: ChatIntensity): string =>
	translator("chat")(`intensity.description.${key}`);

/**
 * The fact that an all-ages work has no `Intense`.
 *
 * A sentence stands in place of a disabled control. The narration screen made the same call for the
 * same reason: a control drawn but unusable sends the user looking for a way to change it. It is
 * not silent either; with no statement, this screen would describe only half of what it decides.
 */
export const intensityAllAgesNotice = (): string =>
	translator("chat")("intensity.allAgesNotice");

/**
 * An adult work that does not run in adult mode this time.
 *
 * Either adult verification is incomplete or adult content display is off. Half of this sentence
 * says that the chosen value is kept. Without that, the user cannot tell whether the setting
 * survives once eligibility returns (the narration unsupported-notice made the same call).
 */
export const intensityAdultLockedNotice = (): string =>
	translator("chat")("intensity.adultLockedNotice");

/** The rating is this axis's ceiling. This applies to both values. */
export const intensityRatingNote = (): string =>
	translator("chat")("intensity.ratingNote");

export const intensitySaveFailureMessage = (): string =>
	translator("chat")("intensity.saveFailed");

/**
 * The one-line summary on the settings home. It states the value **currently in effect**.
 *
 * Same rule as the narration row: a name alone does not separate the chosen value from the value
 * actually applied. In a room whose adult eligibility has lapsed, a bare `Intense` would describe a state
 * that is not true.
 */
export function intensityRowSummary(
	intensity: ChatIntensity | null,
	/**
	 * Whether this turn runs as all-ages (the result of `resolveAllAges`).
	 *
	 * `null` means not yet known, and then the summary claims nothing. Folding to "not eligible"
	 * before the viewer is read would draw `not applied now` for an eligible viewer, and the user would read
	 * it as their own state (the narration `catalog-unknown` made the same call).
	 */
	allAges: boolean | null,
): string {
	if (!intensity) return intensityDefaultLabel();
	const label = intensityLabel(intensity);
	if (intensity === "intense" && allAges === true)
		return translator("chat")("intensity.notApplied", { label });
	return label;
}
