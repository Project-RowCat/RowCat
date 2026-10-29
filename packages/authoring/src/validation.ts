import type { StoryPublishRequest } from "@rowcat/contracts/publication";
import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts/publication";

/**
 * Pre-publish validation: a judgment made for UX.
 *
 * Passing here does not mean the value is safe. The server is the final authority and validates the
 * same contract again with zod. The goal of this function is that the user never sees a 400 after
 * pressing `Publish`.
 *
 * So the return value is a list of which field has which problem, not a boolean. The editor has to
 * be able to take the user to that spot in order to fix it.
 *
 * Limits are read from the contract (`STORY_PUBLISH_LIMITS`) rather than written here. If they were
 * written in two places, fixing only one would create values the screen accepts and the server
 * rejects, a state the user cannot escape on their own.
 */

export const PUBLICATION_ISSUE_CODE = {
	required: "required",
	tooLong: "too_long",
	tooMany: "too_many",
	/**
	 * Lore that never triggers: no keyword, and not always-on.
	 *
	 * It is saved, but it does nothing during play. If it passed silently, the creator would believe
	 * their setting is in effect and never find out why the result looks wrong.
	 */
	loreNeverTriggers: "lore_never_triggers",
	unresolvedDefaultStartScene: "unresolved_default_start_scene",
	/**
	 * A scene image is missing either its trigger or its picture. Publishing would drop the whole
	 * entry.
	 */
	incompleteSceneImage: "incomplete_scene_image",
	/**
	 * The same trigger appears more than once.
	 *
	 * Rather than blocking publication, this states which one wins. Matching takes the first one
	 * encountered (`indexSceneImages` in @rowcat/chat), so later entries become dead references that
	 * are never drawn.
	 */
	duplicateSceneTrigger: "duplicate_scene_trigger",
	/**
	 * The runtime is on but has no entry file.
	 *
	 * Publishing is blocked. Silently publishing as a conversation work would make the creator publish
	 * a product they did not build (see §19), and that fact would only surface when a player opens it.
	 * The validator also does not pick any remaining file as the entry point.
	 */
	runtimeEntryMissing: "runtime_entry_missing",
} as const;
export type PublicationIssueCode =
	(typeof PUBLICATION_ISSUE_CODE)[keyof typeof PUBLICATION_ISSUE_CODE];

export interface PublicationIssue {
	/**
	 * Where the problem is. Children are referenced by their index after normalization, for example
	 * `lore.2.keys`.
	 *
	 * Index rather than record id: the list the editor shows went through the same normalization
	 * (deleted items excluded, sorted), so the index maps directly. An id would make the screen look
	 * the item up again.
	 */
	field: string;
	code: PublicationIssueCode;
	/** Human-readable message, built here so the UI does not have to pick copy from the code. */
	message: string;
}

const issue = (
	field: string,
	code: PublicationIssueCode,
	message: string,
): PublicationIssue => ({ field, code, message });

const chars = (n: number): string => `${n.toLocaleString("en-US")} characters`;

/**
 * Length is checked against the normalized string, so surrounding whitespace cannot cause a
 * rejection.
 */
function checkLength(
	out: PublicationIssue[],
	field: string,
	label: string,
	value: string,
	max: number,
): void {
	if (value.length > max)
		out.push(
			issue(
				field,
				PUBLICATION_ISSUE_CODE.tooLong,
				`${label} can't exceed ${chars(max)}.`,
			),
		);
}

function checkCount(
	out: PublicationIssue[],
	field: string,
	label: string,
	count: number,
	max: number,
): void {
	if (count > max)
		out.push(
			issue(
				field,
				PUBLICATION_ISSUE_CODE.tooMany,
				`${label} can't exceed ${max} items.`,
			),
		);
}

export interface PublicationValidationContext {
	/**
	 * Whether the start scene the draft names actually exists.
	 *
	 * The assembler reports this. The function does not take the draft record directly: that would
	 * expose both the pre-normalization and post-normalization values, and it would blur which one was
	 * validated. The validated value is always the one that will actually be uploaded.
	 */
	defaultStartSceneResolved: boolean;
	/**
	 * Scene images dropped by normalization, counted by `prepareStoryPublication`.
	 *
	 * Validation cannot detect this from the payload alone, because dropped items are already absent
	 * from the array.
	 */
	sceneImageIssues?: {
		incomplete: number;
		duplicateTriggers: readonly string[];
	};
	/**
	 * Contradictions found by runtime normalization, reported by `prepareStoryPublication`.
	 *
	 * The payload alone cannot reveal them. Whether the entry file is missing is a relation between
	 * the `files` array and the `entry` string. If validation recomputed that relation, it would be a
	 * second copy of the normalization logic.
	 */
	runtimeIssues?: { entryMissing: boolean };
}

/**
 * Validates the values exactly as they will be uploaded.
 *
 * Only title and prompt are required, and that choice is deliberate. Without them, playback does
 * not work: a work without a title is a blank line in the catalog, and a work without a prompt
 * gives the model no context. The rest (description, tags, intro) can be empty and the work still
 * runs. Adding requirements would block the common workflow of uploading now and refining later.
 *
 * The prompt requirement follows the execution model. In a publication with `runtime.mode ===
 * "source"`, the executable content is the creator's code. The prompt is kept but not sent, so it
 * may be empty. The runtime project's requirements (entry file, compile) apply instead.
 *
 * Storage has no required fields at all. A draft must stay durable even with an empty title
 * (`model.ts`). The rules here apply only at the publication boundary.
 */
export function validateStoryPublication(
	publication: StoryPublishRequest,
	context: PublicationValidationContext,
): PublicationIssue[] {
	const out: PublicationIssue[] = [];
	const { metadata, play } = publication;

	if (!metadata.title)
		out.push(
			issue("title", PUBLICATION_ISSUE_CODE.required, "Please enter a title."),
		);
	checkLength(
		out,
		"title",
		"Title",
		metadata.title,
		STORY_PUBLISH_LIMITS.title,
	);
	checkLength(
		out,
		"tagline",
		"One-line intro",
		play.tagline,
		STORY_PUBLISH_LIMITS.tagline,
	);
	checkLength(
		out,
		"description",
		"Description",
		metadata.description,
		STORY_PUBLISH_LIMITS.description,
	);
	checkCount(
		out,
		"tags",
		"Tags",
		metadata.tags.length,
		STORY_PUBLISH_LIMITS.tags,
	);
	metadata.tags.forEach((tag, i) => {
		checkLength(out, `tags.${i}`, "Tag", tag, STORY_PUBLISH_LIMITS.tag);
	});

	/**
	 * The field name stays `scenario` because it is the wire name. The editor has no field with that
	 * name, so the message uses the on-screen word `Prompt`. Guidance that points at a place
	 * the user cannot find is worse than none. The slot string is not renamed either: it is the
	 * publication contract's field path, and the screen finds fields by that path.
	 */
	/**
	 * For a runtime-sourced publication, the prompt is not required. That work's execution model is
	 * the creator's code, and the model context is built per request by `useGeneration()`. The old
	 * prompt is kept but sent nowhere. The runtime project's requirement for executable content is
	 * enforced instead, below (`runtime.entry`) and by the server's compile.
	 *
	 * The condition is an explicit `source`. A request without the field comes from a caller that does
	 * not know about runtimes (an update keeps the published runtime). Reading an absent field as
	 * 'runtime on' would let an old client's update publication pass with an empty prompt. `disabled`
	 * is a conversation work and stays required.
	 */
	const runtimeSourced = publication.runtime?.mode === "source";
	if (!play.scenario && !runtimeSourced)
		out.push(
			issue(
				"scenario",
				PUBLICATION_ISSUE_CODE.required,
				"Please enter a prompt.",
			),
		);
	/** The prompt body has no length limit. The contract records the reason. */

	/**
	 * The progress guide, persona, and cast are not validated. The assembler always sends these three
	 * empty (`publication.ts`). Keeping checks here would create a branch that is never true, and such
	 * a branch tells a reader that a path to set those values still exists.
	 */

	checkCount(out, "lore", "Lore", play.lore.length, STORY_PUBLISH_LIMITS.lore);
	play.lore.forEach((entry, i) => {
		if (!entry.content)
			out.push(
				issue(
					`lore.${i}.content`,
					PUBLICATION_ISSUE_CODE.required,
					"Fill in the lore content or remove it from the list.",
				),
			);
		checkLength(
			out,
			`lore.${i}.content`,
			"Lore content",
			entry.content,
			STORY_PUBLISH_LIMITS.loreContent,
		);
		checkCount(
			out,
			`lore.${i}.keys`,
			"Lore keywords",
			entry.keys.length,
			STORY_PUBLISH_LIMITS.loreKeys,
		);
		entry.keys.forEach((key, k) => {
			checkLength(
				out,
				`lore.${i}.keys.${k}`,
				"Lore keyword",
				key,
				STORY_PUBLISH_LIMITS.loreKey,
			);
		});
		if (!entry.constant && entry.keys.length === 0)
			out.push(
				issue(
					`lore.${i}.keys`,
					PUBLICATION_ISSUE_CODE.loreNeverTriggers,
					"Add a keyword or turn on 'Always include'. With these settings it never reaches the conversation.",
				),
			);
	});

	checkCount(
		out,
		"startScenes",
		"Opening scenes",
		play.startScenes.length,
		STORY_PUBLISH_LIMITS.startScenes,
	);
	play.startScenes.forEach((scene, i) => {
		checkLength(
			out,
			`startScenes.${i}.title`,
			"Scene title",
			scene.title,
			STORY_PUBLISH_LIMITS.startSceneTitle,
		);
		checkLength(
			out,
			`startScenes.${i}.content`,
			"Scene body",
			scene.content,
			STORY_PUBLISH_LIMITS.startSceneContent,
		);
	});
	checkLength(
		out,
		"firstScene",
		"Opening",
		play.firstScene,
		STORY_PUBLISH_LIMITS.firstScene,
	);

	/**
	 * The start scene the draft names does not exist. The assembler dropped it to the first scene, but
	 * that is a recovery, not a value the creator chose. Leaving it would repeat the same mismatch on
	 * the next edit, so it is reported. The editor uses this signal to rewrite the selection.
	 */
	checkCount(
		out,
		"sceneImages",
		"Scene images",
		play.sceneImages.length,
		STORY_PUBLISH_LIMITS.sceneImages,
	);
	const sceneIssues = context.sceneImageIssues;
	if (sceneIssues && sceneIssues.incomplete > 0)
		out.push(
			issue(
				"sceneImages",
				PUBLICATION_ISSUE_CODE.incompleteSceneImage,
				`${sceneIssues.incomplete} scene images have no trigger or picture. Fill them in or remove them from the list.`,
			),
		);
	for (const trigger of sceneIssues?.duplicateTriggers ?? [])
		out.push(
			issue(
				"sceneImages",
				PUBLICATION_ISSUE_CODE.duplicateSceneTrigger,
				`The trigger '${trigger}' is used more than once. Only the first picture appears in the conversation.`,
			),
		);

	if (!context.defaultStartSceneResolved)
		out.push(
			issue(
				"defaultStartSceneId",
				PUBLICATION_ISSUE_CODE.unresolvedDefaultStartScene,
				"The scene set as the default opening doesn't exist. Please choose an opening scene again.",
			),
		);

	/**
	 * Runtime is on but there is no start file. The server rejects this for the same reason (the
	 * compiler's `runtime_entry_missing`), but it must be blocked here first. That way the creator
	 * sees what to fix, not just 'publish failed'.
	 */
	if (context.runtimeIssues?.entryMissing)
		out.push(
			issue(
				"runtime.entry",
				PUBLICATION_ISSUE_CODE.runtimeEntryMissing,
				"The runtime entry file can't be found. Check the entry file in the studio.",
			),
		);

	return out;
}
