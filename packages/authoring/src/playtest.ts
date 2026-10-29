import type { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { draftDisplayTitle } from "./model.ts";
import type { StoryPublicationSource } from "./publication.ts";
import { prepareStoryPublication } from "./publication.ts";

/**
 * Test snapshot of a draft, built without publishing. It runs the draft through the same
 * normalization publishing uses (`prepareStoryPublication`) and keeps only the parts the runtime
 * reads.
 *
 * This file adds no second mapper. A parallel mapper would let a draft run differently in testing
 * than after publishing.
 *
 * Deliberately absent:
 * - Validation. Catalog fields may be empty and the draft must still be playable. Publish
 *   validation stays on the publish path only.
 * - Story id. Drafts have none, and a made-up id would corrupt the meaning of
 *   `StoryChatSeedDto.storyId`, which marks a published story. `PlaytestSeed` omits the field
 *   entirely.
 * - @rowcat/chat. The seed shape comes from @rowcat/contracts. The web assembly point checks
 *   structural typing.
 * - React, storage, fetch. This is a pure function.
 */

/**
 * The seed portion the chat runtime reads. Identity (story id, schema version) is not here. It is
 * picked from `StoryChatSeedDto` so that two copies never exist. When fields are added or change
 * meaning, the contract changes first and this type follows.
 */
export type PlaytestSeed = Pick<
	StoryChatSeedDto,
	| "scenario"
	| "firstScene"
	| "playGuide"
	| "persona"
	| "characters"
	| "lore"
	| "startScenes"
	/** Scene images. The test must draw the same pictures as a real conversation. */
	| "sceneImages"
>;

/**
 * A selectable start scene. The `id` is the only point where this differs from the published shape.
 * The publish contract carries no scene id, since stable ids belong to the authoring tool. The test
 * screen still needs one to point at `Start from this scene`. Normalization already knows that mapping, so
 * it is passed through.
 */
export interface PlaytestStartScene {
	id: string;
	title: string;
	content: string;
}

export interface PlaytestSnapshot {
	/** The draft this snapshot came from. This is not a story id, which may not exist yet. */
	draftId: string;
	/** Name shown on screen. Tests still run when the title is empty. */
	title: string;
	/**
	 * The rating the draft declares. It is the first criterion for the safety guard. The effective
	 * progression rating combines this value with the viewer's eligibility, via `resolveAllAges` in
	 * @rowcat/chat. A real conversation runs that same function. This type carries only the story
	 * rating.
	 */
	adult: boolean;
	seed: PlaytestSeed;
	/** Kept in normalized order. With one scene or fewer, the screen draws no selection control. */
	startScenes: PlaytestStartScene[];
	/**
	 * ID of the scene this snapshot actually uses as its opening. Null when there are no scenes. It
	 * can differ from the draft's `defaultStartSceneId`, either because a playtest-only override was
	 * passed or because the named scene was gone and it fell back to the first. The draft is never
	 * changed in either case, since this function has no access to storage.
	 */
	startSceneId: string | null;
}

export interface BuildPlaytestSnapshotOptions {
	/**
	 * Start scene for this playtest only. An id not in the list (deleted, or from another draft) is
	 * ignored and falls back to the draft's default opening. It does not throw, because this value is
	 * screen state. If another tab deleted the scene in between, pressing `New test from latest draft` would show
	 * an error, and the author would conclude the draft was broken.
	 */
	startSceneId?: string | null;
}

/**
 * Turns a draft (plus its children) into a playable snapshot. The output is deterministic: no
 * clock, randomness, or locale input. That lets two snapshots be compared by value to tell which
 * build a conversation is running on.
 */
export function buildPlaytestSnapshot(
	source: StoryPublicationSource,
	options: BuildPlaytestSnapshotOptions = {},
): PlaytestSnapshot {
	const prepared = prepareStoryPublication(source);
	const { play } = prepared.publication;

	const startScenes: PlaytestStartScene[] = play.startScenes.map(
		(scene, index) => ({
			/**
			 * Matched by index. Both arrays went through the same normalization in the same order, which is
			 * the basis for this mapping (`PreparedStoryPublication.startSceneIds`). A missing id should not
			 * occur, since normalization always produces one. The optional access falls back to an empty
			 * string, and the lookup below never matches that entry.
			 */
			id: prepared.startSceneIds[index] ?? "",
			title: scene.title,
			content: scene.content,
		}),
	);

	/**
	 * Playtest-only override. It changes this snapshot's opening without touching the draft's own
	 * choice. The chosen scene's content is not trimmed again. It is already normalized, and a second
	 * pass could make it differ from the published text by a character.
	 */
	const override =
		options.startSceneId != null
			? (startScenes.find((scene) => scene.id === options.startSceneId) ?? null)
			: null;

	return {
		draftId: source.draft.id,
		title: draftDisplayTitle(source.draft),
		adult: source.draft.adult,
		seed: {
			scenario: play.scenario,
			firstScene: override ? override.content : play.firstScene,
			/**
			 * These three fields are empty, as in publishing, because the v2 authoring tool never produces
			 * them.
			 */
			playGuide: play.playGuide,
			persona: play.persona,
			characters: play.characters,
			lore: play.lore,
			startScenes: play.startScenes,
			sceneImages: play.sceneImages,
		},
		startScenes,
		startSceneId: override ? override.id : prepared.defaultStartSceneId,
	};
}
