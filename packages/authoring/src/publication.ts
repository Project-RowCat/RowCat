import type {
	StoryPublishLore,
	StoryPublishMetadata,
	StoryPublishRequest,
	StoryPublishSceneImage,
	StoryPublishStartScene,
} from "@rowcat/contracts/publication";
import type { StoryPublishRuntimeInput } from "@rowcat/contracts/story-runtime";
import type {
	DraftLoreEntry,
	DraftSceneImage,
	DraftStartScene,
	StoryDraft,
} from "./model.ts";
import {
	isLiveRecord,
	resolveDefaultStartScene,
	sortLore,
	sortSceneImages,
	sortStartScenes,
} from "./model.ts";
import type {
	DraftRuntimeAsset,
	DraftRuntimeFile,
	DraftRuntimeProject,
} from "./runtime.ts";
import {
	isRuntimeEnabled,
	runtimeAssetBindings,
	sortRuntimeFiles,
} from "./runtime.ts";
import type { PublicationIssue } from "./validation.ts";
import { validateStoryPublication } from "./validation.ts";

/**
 * Draft to publish request. This file is one pure function. What it does not do defines the
 * boundary:
 * - No `fetch`. The app decides when to send, and holds off while an account switch is in
 *   progress.
 * - No IndexedDB. The function has no access to storage.
 * - Unaware of the viewer. The server reads who is uploading from the session.
 * - Does not create a story id. None exists at first publish, and a client-made id could differ
 *   from the id on the real row (@rowcat/contracts/publication).
 *
 * So the result is a publish request, not a `StoryChatSeedDto`. The server builds the final
 * snapshot by injecting the metadata it has confirmed (story id, title, rating, protection status).
 * That makes `play_payload.storyId === story.id` structurally true.
 */

export interface StoryPublicationSource {
	draft: StoryDraft;
	/**
	 * This function does the sorting and the deleted-record filtering. If each caller did it, one of
	 * them would miss a step.
	 */
	lore: DraftLoreEntry[];
	startScenes: DraftStartScene[];
	/**
	 * Scene images. Normalization filters them here: entries with an empty trigger or no asset are
	 * left out of the publish payload. That state is a normal moment during editing, and validation
	 * reports it separately.
	 */
	sceneImages: DraftSceneImage[];
	/**
	 * Creator runtime. Absent and disabled are different states.
	 * - Field absent (undefined): the caller does not know the runtime axis. No `runtime` is sent.
	 * - Project null or off: the author turned it off. `{ mode: "disabled" }` is sent.
	 * - On: one source bundle, sent as `{ mode: "source" }`.
	 *
	 * The absent case is kept separate because several callers exist (publish, playtest, fixtures). A
	 * caller that does not handle the runtime and invents an empty project would make it look off. On
	 * update, that deletes the published runtime.
	 *
	 * `apiVersion` is passed in rather than read from storage, for layering reasons. This package does
	 * not import the language contract package (`@rowcat/runtime`). The app that sets up the editor
	 * knows the version. Both apps read the same constant (`RUNTIME_API_VERSION`), so no copy exists.
	 */
	runtime?: {
		project: DraftRuntimeProject | null;
		files: DraftRuntimeFile[];
		/**
		 * Images bound under logical names. Normalization filters them here. Deleted records are left
		 * out, and the order is fixed by path (`runtimeAssetBindings`).
		 *
		 * This list is required on purpose, not optional. A caller that knows `runtime` also knows the
		 * assets. If only this were left out, the publish would silently delete images it had already
		 * bound.
		 */
		assets: DraftRuntimeAsset[];
		apiVersion: number;
	};
}

/**
 * Normalized value only. It does not yet ask whether publishing is allowed.
 *
 * Two consumers need this. Publishing adds validation on top. The playtest (`playtest.ts`) uses the
 * same normalized result without validation, so drafts with empty catalog fields can still be
 * tried. If each consumer normalized on its own, a story could run one way in playtest and another
 * way once published, and the author would find out only after publishing.
 *
 * The split is between normalization and validation, not normalization itself. Validation is not
 * loosened: the rules `buildStoryPublication` applies are unchanged.
 */
export interface PreparedStoryPublication {
	/** The value as it will be uploaded. It has not passed validation yet. */
	publication: StoryPublishRequest;
	/**
	 * IDs of the live start scenes after normalization, in the same order as
	 * `publication.play.startScenes`.
	 *
	 * The publish contract does not carry these IDs, since stable scene IDs belong to the authoring
	 * tool. Playtest must point at a scene by ID to offer `Start from this scene`. So the mapping
	 * normalization already knows is exported here. A caller that re-sorted the draft list to match
	 * would be a second copy of the normalization.
	 */
	startSceneIds: string[];
	/** Whether the default opening the draft names was actually found. Validation reads this value. */
	defaultStartSceneResolved: boolean;
	/**
	 * Scene images that normalization dropped. Validation reads this. The normalized result alone
	 * cannot reveal this fact, which is why the field exists. It has the same shape as
	 * `defaultStartSceneResolved`. If the images were dropped silently and the story published, the
	 * author would believe it went out with its pictures. That only shows up by chatting with their
	 * own story.
	 */
	sceneImageIssues: {
		/** Number of entries where the trigger or the asset was empty. */
		incomplete: number;
		/**
		 * Duplicate triggers dropped because an earlier entry took the slot. Kept as the author wrote
		 * them.
		 */
		duplicateTriggers: string[];
	};
	/**
	 * ID of the scene that actually became the opening. If nothing was named and it fell back to the
	 * first scene, that scene's id is used.
	 */
	defaultStartSceneId: string | null;
	/**
	 * Whether runtime normalization found a contradiction. Validation reads this value. Only one case
	 * exists: the runtime is on but the entry file is missing. That happens during editing, for
	 * example after the entry file is deleted or renamed. Publishing it silently would send a project
	 * that does not compile. The server rejects it too, but this check runs first, so the author sees
	 * `No entry file` rather than a generic publish failure.
	 */
	runtimeIssues: { entryMissing: boolean };
}

export type BuildStoryPublicationResult =
	| { ok: true; publication: StoryPublishRequest; issues: [] }
	/**
	 * Cannot publish. No request is built. Returning a partially assembled value alongside the issues
	 * would let callers build a 'send anyway' path, which only server validation would then catch.
	 */
	| { ok: false; publication: null; issues: PublicationIssue[] };

/**
 * Trims leading and trailing whitespace only. Inner formatting is left alone, because line breaks
 * in story text carry meaning.
 */
const trim = (value: string): string => value.trim();

/**
 * Tag normalization: trims spaces, drops empty values, and removes duplicates while keeping the
 * first occurrence. Does not sort. The order the author wrote has meaning (most important first).
 * Alphabetical sorting would lose that in lists that mix Hangul, Latin, and digits.
 */
function normalizeTags(tags: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of tags) {
		const tag = trim(raw);
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		out.push(tag);
	}
	return out;
}

/**
 * Maps one lore entry to its published form. Keywords are trimmed, emptied, and de-duplicated. Case
 * is left as is. Trigger matching already ignores case (@rowcat/chat). Lowercasing here would
 * change only the keywords the author sees on screen, with no gain.
 */
function toPublishLore(entry: DraftLoreEntry): StoryPublishLore {
	const seen = new Set<string>();
	const keys: string[] = [];
	for (const raw of entry.keys) {
		const key = trim(raw);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		keys.push(key);
	}
	return {
		keys,
		content: trim(entry.content),
		constant: entry.constant,
		position: entry.position,
		order: entry.order,
	};
}

/**
 * Maps the draft's visibility to a value that publishing can produce. The draft field covers all
 * four vocabulary values.
 *
 * Imported or hand-edited data can carry `archived`. Sent as-is, the server rejects it with
 * `archived_unavailable`. Both apps' publish screens already display that value as `Private`, so a user
 * pressing `Publish as private` would get `Can't publish while archived`. On web, re-selecting `Private` does not change the
 * draft value, because the screen already shows it. So the folding happens here, where the request
 * is built, not in the UI. The preview card passes through this function too, so all three agree.
 *
 * Folding to private is the narrowest of the three visibility values. Guessing too broadly would
 * list a withdrawn story in the catalog, which cannot be undone. Writing this as an allowlist
 * follows the same logic: new vocabulary values fall to the narrow side instead of passing through.
 */
function toPublishVisibility(
	visibility: StoryDraft["visibility"],
): StoryPublishMetadata["visibility"] {
	switch (visibility) {
		case "public":
		case "unlisted":
		case "private":
			return visibility;
		default:
			return "private";
	}
}

/**
 * Draft to catalog-visible values. Authoring content (lore, scenes, body text) is not included.
 *
 * This was split from the publish assembler into its own function because it now has two consumers:
 * publishing, and the editor's gallery card preview. For the preview to show what publishing will
 * produce, title trimming and tag de-duplication must run through the same function as publishing.
 * Two copies would let the preview differ from the card that actually publishes, and the author
 * would find that out only after publishing.
 *
 * Taking no children (lore, start scenes) is the point of the split. The preview draws one card and
 * should not wait for child lists to load.
 */
export function prepareStoryMetadata(draft: StoryDraft): StoryPublishMetadata {
	return {
		title: trim(draft.title),
		description: trim(draft.description),
		tags: normalizeTags(draft.tags),
		orientation: draft.orientation,
		adult: draft.adult,
		visibility: toPublishVisibility(draft.visibility),
		promptProtected: draft.promptProtected,
	};
}

/** An empty scene title folds to the same word the playtest contract uses as its default (`Start`). */
/**
 * One scene image to its published form. The trigger is not lowercased. Matching already ignores
 * case (`sceneTriggerKey` in @rowcat/chat), and keeping what the author typed means a hand-written
 * token still shows the exact letters they chose.
 */
const toPublishSceneImage = (
	image: DraftSceneImage,
): StoryPublishSceneImage => ({
	trigger: trim(image.trigger),
	assetId: trim(image.assetId),
});

/**
 * Whether the entry can be published. Both trigger and asset must be present for an image to count.
 */
const isPublishableSceneImage = (image: DraftSceneImage): boolean =>
	trim(image.trigger).length > 0 && trim(image.assetId).length > 0;

/**
 * Converts a draft runtime record into publish input. There are three branches; the middle one is
 * the point of this function.
 * - No `source.runtime`: undefined. The caller does not know the runtime, so no field is sent.
 * - No project, or off: `{ disabled }`. The published runtime is removed.
 * - On: `{ source, ... }`. One source bundle, compiled by the server.
 *
 * Files are sorted by path, the same rule as the authoring list (`sortRuntimeFiles`). Sorting here
 * matters for artifact identity. The compiler's canonicalization already collapses input order, but
 * relying on it is weaker than making the order deterministic here, so the same source yields the
 * same bytes from any device.
 *
 * Deleted files are never sent. Passing soft-deleted records through would revive them in the
 * published build. If one intercepted the entry point, code the author deleted would run for
 * players.
 */
function toPublishRuntime(
	runtime: NonNullable<StoryPublicationSource["runtime"]>,
): { input: StoryPublishRuntimeInput; entryMissing: boolean } {
	if (!isRuntimeEnabled(runtime.project))
		return { input: { mode: "disabled" }, entryMissing: false };
	const project = runtime.project as DraftRuntimeProject;
	const files = sortRuntimeFiles(runtime.files.filter(isLiveRecord)).map(
		(file) => ({ path: file.path, content: file.content }),
	);
	return {
		input: {
			mode: "source",
			project: {
				apiVersion: runtime.apiVersion,
				entry: project.entry,
				files,
				/**
				 * Only live assets, in path order. The server re-checks this list. Passing here is not evidence
				 * of valid syntax, ownership, kind, or uniqueness. The list is built on the device, and a
				 * client that does not use the browser can send the same shape.
				 */
				assets: runtimeAssetBindings(runtime.assets.filter(isLiveRecord)),
			},
		},
		/**
		 * Whether the entry file actually exists. It is not repaired here. Using any remaining file as
		 * the entry point would publish a program the author never chose.
		 */
		entryMissing: !files.some((file) => file.path === project.entry),
	};
}

const toPublishStartScene = (
	scene: DraftStartScene,
): StoryPublishStartScene => ({
	title: trim(scene.title) || "Start",
	content: trim(scene.content),
});

/**
 * Normalizes a draft and its children into the publish request shape. No validation happens here.
 *
 * Steps, in order:
 * 1. Drop deleted children (soft deletes are not shown in lists).
 * 2. Sort into a stable order (position, then id).
 * 3. Normalize values (whitespace, duplicates, modes).
 * 4. Pick the default opening (named scene, then first scene, then none).
 *
 * Step 4 must run after step 3. The opening's content has to come from the normalized scenes, so
 * `firstScene` and `startScenes[i].content` hold the same value. Otherwise the playtest scene
 * picker could not match the opening in use to an entry in the list.
 *
 * Not validating here is the point of this function. Publishing adds validation right after.
 * Playtest does not, because drafts without a title or tags yet still need to run. Publish
 * validation is not loosened: those rules stay in `validateStoryPublication`, and the server checks
 * the same contract again.
 */
export function prepareStoryPublication(
	source: StoryPublicationSource,
): PreparedStoryPublication {
	const { draft } = source;

	const lore = sortLore(source.lore.filter(isLiveRecord));
	const startScenes = sortStartScenes(source.startScenes.filter(isLiveRecord));
	/**
	 * Folds in slot order, keeping only the first entry for each trigger. If duplicates were sent, the
	 * later entries would never be drawn and would become dead references. Matching picks the earlier
	 * entry (`indexSceneImages`). Validation reports this to the author, and normalization yields the
	 * same result playtime would.
	 */
	const sceneImages: StoryPublishSceneImage[] = [];
	const seenTriggers = new Set<string>();
	const duplicateTriggers: string[] = [];
	let incompleteSceneImages = 0;
	for (const image of sortSceneImages(
		source.sceneImages.filter(isLiveRecord),
	)) {
		if (!isPublishableSceneImage(image)) {
			incompleteSceneImages += 1;
			continue;
		}
		const published = toPublishSceneImage(image);
		const key = published.trigger.toLowerCase();
		if (seenTriggers.has(key)) {
			duplicateTriggers.push(published.trigger);
			continue;
		}
		seenTriggers.add(key);
		sceneImages.push(published);
	}

	const runtime =
		source.runtime === undefined ? undefined : toPublishRuntime(source.runtime);

	const publishScenes = startScenes.map(toPublishStartScene);
	const chosen = resolveDefaultStartScene(
		draft.defaultStartSceneId,
		startScenes,
	);
	/**
	 * Whether the named opening scene was found. Fallback still happens when it was not, but inside
	 * the draft that is a mismatch. If nothing was named yet, that is not a mismatch, so the value is
	 * true.
	 */
	const defaultStartSceneResolved =
		draft.defaultStartSceneId === null ||
		startScenes.some((scene) => scene.id === draft.defaultStartSceneId);
	const firstScene = chosen ? trim(chosen.content) : "";

	const publication: StoryPublishRequest = {
		originDraftId: draft.id,
		metadata: prepareStoryMetadata(draft),
		play: {
			tagline: trim(draft.tagline),
			/**
			 * The whole authored body goes into the world-setting slot. The draft has no other body field.
			 */
			scenario: trim(draft.prompt),
			firstScene,
			/**
			 * In v2, these three slots go out empty. The contract stays as it is, and this code does not
			 * fill them. They look like candidates for removal. Removing them would stop the play snapshots
			 * of already published stories from decoding against the contract. Those snapshots are fixed on
			 * the server and cannot be rewritten here. A shape the authoring tool no longer creates is not
			 * the same as a shape playback can no longer read.
			 */
			playGuide: "",
			persona: null,
			characters: [],
			/** Lore and start scenes are not folded, so they pass through as lists. */
			lore: lore.map(toPublishLore),
			startScenes: publishScenes,
			sceneImages,
		},
		/**
		 * The runtime field is sent only when the caller knows about it. Leaving `undefined` as is gives
		 * the same meaning as an older client: on update, the published runtime is kept.
		 */
		...(runtime === undefined ? {} : { runtime: runtime.input }),
	};

	return {
		publication,
		startSceneIds: startScenes.map((scene) => scene.id),
		defaultStartSceneResolved,
		defaultStartSceneId: chosen?.id ?? null,
		sceneImageIssues: { incomplete: incompleteSceneImages, duplicateTriggers },
		runtimeIssues: { entryMissing: runtime?.entryMissing === true },
	};
}

/**
 * Normalization plus validation. Publish behavior is unchanged: it runs the normalization above and
 * validates with the same rules.
 */
export function buildStoryPublication(
	source: StoryPublicationSource,
): BuildStoryPublicationResult {
	const prepared = prepareStoryPublication(source);

	const issues = validateStoryPublication(prepared.publication, {
		defaultStartSceneResolved: prepared.defaultStartSceneResolved,
		sceneImageIssues: prepared.sceneImageIssues,
		runtimeIssues: prepared.runtimeIssues,
	});
	if (issues.length) return { ok: false, publication: null, issues };
	return { ok: true, publication: prepared.publication, issues: [] };
}
