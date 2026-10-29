import type { ChatIntensity } from "@rowcat/chat";

/**
 * Copy for the expression intensity screen, identical to the web's file of the same name; rules
 * live in `@rowcat/chat`'s `intensity.ts`. It lives here because the pure package holds no Korean,
 * and the `Record` tables pay for that: a new vocabulary value breaks this file's compilation. When
 * fixing, change both files together or the same setting is explained in different words per app
 * (`narration-copy.ts` and `user-note-copy.ts` are paired the same way).
 *
 * The prompt text is not here, unlike the narration screen. This axis also carries text the model
 * reads; it is safety-guard-like and lives in the pure package (`chatIntensityBlock`), because two
 * apps writing it separately would run one setting at different intensities per platform. Only the
 * human-facing side is here.
 */

/** Default: the middle of the dial; not a stored value but the absence of the key. */
export const INTENSITY_DEFAULT_LABEL = "default";
export const INTENSITY_DEFAULT_DESCRIPTION =
	"Uses exactly what the story and its rating set.";

/**
 * Labels for the two values. `Intense` is not written `High`: this axis changes how much the description
 * shows, not quantity, and a high/low wording would read as the same kind of value as the adjacent
 * `Response length`.
 */
export const INTENSITY_LABEL: Record<ChatIntensity, string> = {
	softened: "Softened",
	intense: "Intense",
};

/**
 * Descriptions say what changes and what does not. The softened second sentence matters most:
 * someone reading the setting as "the story gets milder" expects conflict and tension to vanish and
 * takes their persistence as the setting not working. The prompt text draws the same boundary
 * (`intensity.ts`), so the screen must say the same.
 */
export const INTENSITY_DESCRIPTION: Record<ChatIntensity, string> = {
	softened:
		"Sexual scenes and graphic violence are handled through suggestion and implication. Conflict, tension and dark turns stay as they are.",
	intense:
		"Requested scenes are described concretely, without avoiding them or glossing over them.",
};

/**
 * The fact that all-ages works have no `Intense`. A line of fact stands in place of a disabled control,
 * as on the narration screen (an undrawable choice makes users look for a way to change it), but
 * silence is not an option either: with no words the screen says only half of what it decides.
 */
export const INTENSITY_ALL_AGES_NOTICE =
	"This is an all-ages story, so «Intense» can't be chosen. Even at this rating, dark turns such as conflict, combat and death are still handled.";

/**
 * The fact that an adult-rated work is not running in adult mode this time (verification not done,
 * or adult display off). Saying that the chosen value is kept is half the sentence: without it the
 * user cannot know whether the setting survives when entitlement returns (the narration unsupported
 * notice made the same call).
 */
export const INTENSITY_ADULT_LOCKED_NOTICE =
	"This conversation is running as all-ages right now, so «Intense» isn't applied. Your choice is kept and is used again once you can view adult content.";

/** The fact that the rating is this axis's ceiling; applies to both values. */
export const INTENSITY_RATING_NOTE =
	"Intensity only applies within what the story's rating allows.";

export const INTENSITY_SAVE_FAILURE_MESSAGE =
	"Couldn't save the intensity. Please try again.";

/**
 * Settings-home row summary: states the currently applied value, as the narration row does. The
 * name alone cannot tell the chosen value from the one actually applied; writing only `Intense` for a
 * room whose adult verification lapsed states something untrue.
 */
export function intensityRowSummary(
	intensity: ChatIntensity | null,
	/**
	 * Whether this turn runs all-ages (the result of `resolveAllAges`). `null` means not known yet,
	 * and nothing is claimed. Folding it to 'not entitled' before the viewer is read would draw `Not applied
	 * right now` once for someone fully entitled, who would read it as their own state. The narration
	 * catalog's unknown state makes the same call.
	 */
	allAges: boolean | null,
): string {
	if (!intensity) return INTENSITY_DEFAULT_LABEL;
	const label = INTENSITY_LABEL[intensity];
	if (intensity === "intense" && allAges === true)
		return `${label} · not applied now`;
	return label;
}
