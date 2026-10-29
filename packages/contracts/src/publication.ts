import { z } from "zod";
import {
	CHAT_SCENE_IMAGE_LIMITS,
	CHAT_SCENE_TRIGGER_PATTERN,
	ChatLorePosition,
} from "./chat.ts";
import { Orientation, STORY_TAG_MAX_LENGTH, StoryDto } from "./gallery.ts";
import { StoryPublishRuntimeInput } from "./story-runtime.ts";
import { StoryVisibility } from "./story-visibility.ts";

/**
 * Publishing protocol: the single boundary where a local draft becomes a server work.
 *
 * This file is separate from StoryChatSeedDto (chat.ts) on purpose. The playback snapshot contains
 * storyId, title, adult and promptProtected. Those are all server-owned publishing state. If the
 * client sent them, the story id in the payload could differ from the actual row, and the rating
 * badge could disagree with the payload's rating. Both drift silently, and afterwards nothing can
 * say which is true. So only authored content goes up. The server assembles the final snapshot with
 * the metadata it confirmed.
 *
 * Server-owned values (id, owner, view count, favorite count, download count, hidden, created_at)
 * are absent from the request schema entirely. Received and ignored is not enough. A field that
 * cannot be represented cannot be forgotten. An implementation that ignores it would eventually
 * miss one, and that field would then become client-controlled.
 */

/**
 * Size caps for user content that crosses the server boundary.
 *
 * These live in the contract because both sides must read the same values. The creation screen uses
 * them to block early, so the user does not learn about a failure only after pressing publish. The
 * server does not trust that check and re-checks. Separate copies would bounce a valid draft with a
 * 400 when only one side changed.
 *
 * The legacy limits were not carried over. Most came from varchar(n) column widths and had no
 * product basis (nobody can explain why a story description is 255 characters). Our body columns
 * are all text. These values mean bigger than this is a mistake, not a work. 100,000 characters is
 * one long novel.
 */
export const STORY_PUBLISH_LIMITS = {
	title: 120,
	tagline: 200,
	description: 4_000,
	tags: 20,
	/**
	 * Same value as the gallery tag filter (gallery.ts), so a filter cannot accept a length that could
	 * never be stored.
	 */
	tag: STORY_TAG_MAX_LENGTH,
	playGuide: 20_000,
	firstScene: 40_000,
	personaName: 60,
	personaDescription: 4_000,
	characters: 30,
	characterName: 60,
	lore: 300,
	loreKeys: 40,
	loreKey: 60,
	loreContent: 20_000,
	startScenes: 20,
	startSceneTitle: 80,
	startSceneContent: 40_000,
	/**
	 * Scene image count. Same value as the playback snapshot cap.
	 *
	 * If the two numbers differed, some stories would pass publishing and then fail the playback
	 * contract. The failure would land on whoever starts a chat with that story, not on the creator.
	 */
	sceneImages: CHAT_SCENE_IMAGE_LIMITS.perStory,
} as const;

/**
 * The visibility vocabulary lives in its own file (story-visibility.ts).
 *
 * It is re-exported here because code already imports it through this path. It was moved out to
 * avoid a circular import: this file uses StoryDto from gallery.ts, and that projection now carries
 * the canonical visibility.
 */
export {
	STORY_VISIBILITIES,
	StoryVisibility,
} from "./story-visibility.ts";

/**
 * Characters. Only one expression crosses the boundary: the one chosen at publish time.
 *
 * A draft keeps both the structured items and the free-form prompt, so switching modes does not
 * lose what was written. Only the side chosen for publishing is sent. Sending both would conflict
 * with the playback snapshot's rule for empty versus non-empty prompt (chat.ts). A card built in
 * structured mode would then silently replay from an old prompt draft.
 */
export const StoryPublishCharacter = z.object({
	name: z.string().max(STORY_PUBLISH_LIMITS.characterName),
	description: z.string().default(""),
	personality: z.string().default(""),
	speechStyle: z.string().default(""),
	exampleDialogue: z.string().default(""),
	/**
	 * Free-form prompt. If non-empty, playback uses this body as the card in place of the items above.
	 */
	prompt: z.string().default(""),
});
export type StoryPublishCharacter = z.infer<typeof StoryPublishCharacter>;

/** Partner persona the work proposes. null when there is none. */
export const StoryPublishPersona = z.object({
	name: z.string().max(STORY_PUBLISH_LIMITS.personaName),
	description: z
		.string()
		.max(STORY_PUBLISH_LIMITS.personaDescription)
		.default(""),
});
export type StoryPublishPersona = z.infer<typeof StoryPublishPersona>;

/**
 * Lore entries.
 *
 * The injection position reuses ChatLorePosition from the playback contract as-is. Restating the
 * vocabulary here would split the two lists. The creation screen could then offer a position the
 * assembler does not know, and the position the creator picked would appear to vanish silently.
 */
export const StoryPublishLore = z.object({
	keys: z
		.array(z.string().max(STORY_PUBLISH_LIMITS.loreKey))
		.max(STORY_PUBLISH_LIMITS.loreKeys)
		.default([]),
	content: z.string().max(STORY_PUBLISH_LIMITS.loreContent).default(""),
	constant: z.boolean().default(false),
	position: ChatLorePosition.default("system_bottom"),
	order: z.number().int().default(0),
});
export type StoryPublishLore = z.infer<typeof StoryPublishLore>;

export const StoryPublishStartScene = z.object({
	title: z.string().max(STORY_PUBLISH_LIMITS.startSceneTitle).default("Start"),
	content: z.string().max(STORY_PUBLISH_LIMITS.startSceneContent).default(""),
});
export type StoryPublishStartScene = z.infer<typeof StoryPublishStartScene>;

/**
 * One scene image. Same shape as the playback contract.
 *
 * This is a separate definition rather than a reuse of ChatSeedSceneImageDto. As with the rest of
 * this file, the publish request is what the creator sends, and the playback snapshot is what the
 * server builds. Changing a limit on one side must not turn an already-stored payload on the other
 * side into a contract violation. The shapes match today, and publication.test.ts checks that by
 * value.
 *
 * The server decides whether the asset really belongs to this creator. The shape can only check
 * form. A request naming someone else's media id has the same shape as one naming the creator's
 * own.
 */
export const StoryPublishSceneImage = z.object({
	trigger: z
		.string()
		.trim()
		.min(1)
		.max(CHAT_SCENE_IMAGE_LIMITS.trigger)
		.regex(CHAT_SCENE_TRIGGER_PATTERN),
	assetId: z.string().min(1).max(CHAT_SCENE_IMAGE_LIMITS.assetId),
});
export type StoryPublishSceneImage = z.infer<typeof StoryPublishSceneImage>;

/**
 * All authored content that goes into playback. Contains no work identity and no rating.
 *
 * It overlaps with StoryChatSeedDto, but that schema is not reused. It requires version, storyId,
 * title, adult and promptProtected, and the server sets all five. If the client filled them, they
 * would be forgeable values. On first publish they do not exist yet either, because the server
 * creates the work id.
 */
export const StoryPublishPlayInput = z.object({
	tagline: z.string().max(STORY_PUBLISH_LIMITS.tagline).default(""),
	/**
	 * Scenario text. There is no length cap.
	 *
	 * A long free-form manuscript arrives here in full (the draft's bodyMode). Checking length is not
	 * the publish boundary's job. An overlong setting really matters in the generation context, where
	 * the limit is in tokens and already has its own cap (CHAT_MAX_SYSTEM_CHARS). A cap here would not
	 * prevent that problem, and it would bounce valid novel-length manuscripts with a 400.
	 */
	scenario: z.string().default(""),
	/** Opening scene text, taken from the draft's default starting scene. */
	firstScene: z.string().max(STORY_PUBLISH_LIMITS.firstScene).default(""),
	playGuide: z.string().max(STORY_PUBLISH_LIMITS.playGuide).default(""),
	persona: StoryPublishPersona.nullable().default(null),
	characters: z
		.array(StoryPublishCharacter)
		.max(STORY_PUBLISH_LIMITS.characters)
		.default([]),
	lore: z.array(StoryPublishLore).max(STORY_PUBLISH_LIMITS.lore).default([]),
	startScenes: z
		.array(StoryPublishStartScene)
		.max(STORY_PUBLISH_LIMITS.startScenes)
		.default([]),
	/**
	 * Scene images. `.default([])` lets publish requests from older clients that do not know this
	 * field pass through unchanged.
	 */
	sceneImages: z
		.array(StoryPublishSceneImage)
		.max(STORY_PUBLISH_LIMITS.sceneImages)
		.default([]),
});
export type StoryPublishPlayInput = z.infer<typeof StoryPublishPlayInput>;

/**
 * Catalog values: only the parts the creator decides.
 *
 * adult and visibility are requests, not decisions. The server re-judges them against membership
 * eligibility and publish policy. If they fail, the request is rejected explicitly rather than
 * quietly lowered. Quiet lowering would let a story made as adult content go up labelled all-ages,
 * unknown to its creator.
 */
export const StoryPublishMetadata = z.object({
	title: z.string().min(1).max(STORY_PUBLISH_LIMITS.title),
	description: z.string().max(STORY_PUBLISH_LIMITS.description).default(""),
	tags: z
		.array(z.string().min(1).max(STORY_PUBLISH_LIMITS.tag))
		.max(STORY_PUBLISH_LIMITS.tags)
		.default([]),
	orientation: Orientation.nullable().default(null),
	adult: z.boolean().default(false),
	visibility: StoryVisibility.default("private"),
	promptProtected: z.boolean().default(false),
});
export type StoryPublishMetadata = z.infer<typeof StoryPublishMetadata>;

/**
 * Length cap for the draft identity. The server stores this value and puts a uniqueness constraint
 * on it.
 *
 * Without a cap, a client could inflate the index with arbitrarily long strings. 64 leaves room for
 * a UUID (36 characters with hyphens).
 */
export const ORIGIN_DRAFT_ID_MAX = 64;

/**
 * First-publish request. originDraftId is the core of this contract.
 *
 * Publishing is a network round trip, and a round trip can lose only the response. The server may
 * have created the work while the browser failed to record that. Sending the draft id lets a retry
 * find the work already made from this draft and return it. The user gets the original back instead
 * of a second copy.
 */
export const StoryPublishRequest = z.object({
	originDraftId: z.string().min(1).max(ORIGIN_DRAFT_ID_MAX),
	metadata: StoryPublishMetadata,
	play: StoryPublishPlayInput,
	/**
	 * Creator runtime: optional, and omission does not mean disabled.
	 *
	 * .optional() is the whole point. During rollout, until web, iOS and Android ship together,
	 * clients that do not know this field will send publish requests. Reading omission as disable the
	 * runtime would make one update silently delete the runtime that is already published. So there
	 * are three meanings:
	 * - Omitted: nothing is said. On update, the currently published runtime is kept.
	 * - mode: "disabled": turned off. The published runtime is removed. The source stays on the
	 *   device.
	 * - mode: "source": one source set. The server compiles it into an artifact.
	 *
	 * The request never carries an artifact. A client-built result would let a plain HTTP client skip
	 * the RowCat compiler's policy layer (see the story-runtime.ts header).
	 */
	runtime: StoryPublishRuntimeInput.optional(),
});
export type StoryPublishRequest = z.infer<typeof StoryPublishRequest>;
/** Shape before validation. Fields with defaults may be omitted; fixtures and tests use this. */
export type StoryPublishRequestInput = z.input<typeof StoryPublishRequest>;

/**
 * First-publish response. created is included so the screen can tell retry results apart.
 *
 * false is not a failure but a recovery. An earlier request had already made the work, and this one
 * found it. The screen should not show an error. It should record that work's id in the draft.
 */
export const StoryPublishResponse = z.object({
	created: z.boolean(),
	story: StoryDto,
});
export type StoryPublishResponse = z.infer<typeof StoryPublishResponse>;

/**
 * Update request: replaces the whole snapshot, not a partial edit.
 *
 * There are no PATCH semantics. The playback payload is a self-contained snapshot. Replacing only
 * some parts would produce a character set from the new revision with lore from the old. Publishing
 * means sending one moment of the work whole, and the contract keeps that property.
 *
 * originDraftId is required on update too, to confirm which draft owns this work. A draft on
 * another device cannot overwrite someone else's work.
 */
export const StoryUpdateRequest = StoryPublishRequest;
export type StoryUpdateRequest = z.infer<typeof StoryUpdateRequest>;

export const StoryUpdateResponse = z.object({ story: StoryDto });
export type StoryUpdateResponse = z.infer<typeof StoryUpdateResponse>;

/**
 * Publish failure codes. A status code alone does not let the screen choose guidance, so each
 * failure gets a machine-readable name.
 *
 * Each branch needs a different action from the user: a state that cannot be published (move it to
 * another state); overwriting an archived work (restore it first); not being eligible (adult
 * verification); or a draft that points at someone else's work (fix it in that draft). Folding them
 * into one would show the same message in every case.
 *
 * public_story_publishing_unavailable was removed. It was a temporary policy, not a technical
 * limit, from when the public UGC boundary did not exist. Now that the boundary exists, the code is
 * unreachable, and unreachable codes are not kept in the vocabulary. The screen would otherwise
 * keep a branch showing `Public publishing is not ready yet`, which is now false.
 */
export const STORY_PUBLISH_ERROR_CODE = {
	/**
	 * Cannot publish a work in archived state.
	 *
	 * This rejection stays after public publishing opened, because the nature differs. Public and
	 * private are states publishing can create. Archive is a state transition that removes an
	 * already-published work from the catalog, and it has its own endpoint (story-lifecycle.ts). If a
	 * publish request could reach archive, the result would be a work published but listed nowhere,
	 * and the screen would still show success.
	 */
	archivedUnavailable: "archived_story_publishing_unavailable",
	/**
	 * The member is not eligible for adult-rated publishing (identity verification and age 19 or
	 * over).
	 */
	adultNotPermitted: "adult_publishing_not_permitted",
	/**
	 * This work's origin draft differs from the draft in the request. A draft from another device
	 * tried to overwrite it.
	 */
	originMismatch: "story_origin_draft_mismatch",
	/**
	 * Scene image assets are not this creator's, or do not exist.
	 *
	 * Missing and others' assets are not split in the response. Splitting would let the response work
	 * as a detector (this media id exists). Media and cover already make the same decision. The
	 * publish also does not silently skip the bad item. The creator would believe the work with
	 * pictures was published, and would leave believing it.
	 */
	sceneImageInvalid: "story_scene_image_invalid",
	/**
	 * The runtime source could not be published: compile diagnostics or a project limit.
	 *
	 * The work is not published silently as a chat work. The creator explicitly turned the runtime on.
	 * Publishing without it would put a product on the catalog that the creator did not make. Scene
	 * images make the same decision. The failure body carries StoryRuntimePublishFailure.
	 */
	runtimeInvalid: "story_runtime_invalid",
	/**
	 * Runtime managed-image bindings cannot be published.
	 *
	 * Kept apart from runtimeInvalid because the screen's action differs. The earlier code says fix
	 * the code (the response includes diagnostics). This one says fix the asset list. Folding them
	 * together would make a creator who lost one picture search the Problems panel.
	 *
	 * The response does not say which binding is at fault. Splitting missing from others' assets would
	 * turn the response into a detector (this media id exists), as scene images already decided.
	 * Publishing also does not silently drop the item. The creator would leave believing the
	 * picture-bearing work was published, and would find out only by playing it.
	 */
	runtimeAssetInvalid: "story_runtime_asset_invalid",
} as const;
export type StoryPublishErrorCode =
	(typeof STORY_PUBLISH_ERROR_CODE)[keyof typeof STORY_PUBLISH_ERROR_CODE];
