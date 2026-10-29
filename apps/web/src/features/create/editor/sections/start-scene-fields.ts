import { translator } from "#/lib/i18n/current.ts";
/**
 * What a collapsed start-scene card shows. Unlike lore, there is only one rule (what to call a
 * scene with an empty title), so the file is short. The rule lives outside the component because it
 * is easy to confuse with saved data. The fallback text is display-only, and the record must keep
 * an empty string. If that boundary lived only in a JSX `||`, someone could later write the
 * fallback into the draft as 'it is only the displayed value anyway', and a title the creator never
 * wrote would be published.
 */

/**
 * The label is meant to read as 'not written yet', not as a finished name like `Untitled`. The slot is
 * usually a scene the user just created, and that should be obvious in the list so the next step is
 * clear.
 */
export const untitledStartScene = (): string =>
	translator("create")("startScene.untitled");

/** Headline shown on the collapsed scene card. */
export interface StartSceneSummary {
	headline: string;
	/**
	 * Whether a real title exists. The screen uses this to dim the fallback text. It is not computed
	 * by comparing `headline` with the fallback string: a user can type that exact word as a title,
	 * and the scene would then look empty even though it is fine.
	 */
	hasTitle: boolean;
}

/**
 * Leading and trailing whitespace alone counts as no title, because it would look blank in the
 * list.
 */
export function startSceneSummary(scene: { title: string }): StartSceneSummary {
	const title = scene.title.trim();
	return {
		headline: title === "" ? untitledStartScene() : title,
		hasTitle: title !== "",
	};
}

/**
 * Same reasoning as the matching lore check (`lore-fields.ts`). Using 'was just added' would
 * require the list to remember which id is new, and that memory is wrong for scenes that arrived
 * through sync.
 *
 * It does not consider whether the scene is the default opening. That is a separate axis; including
 * it would make only the first scene open by default.
 */
export const isBlankStartScene = (scene: {
	title: string;
	content: string;
}): boolean => scene.title.trim() === "" && scene.content.trim() === "";
