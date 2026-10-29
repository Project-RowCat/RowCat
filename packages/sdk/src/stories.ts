import {
	RelatedStoriesResponse,
	StoriesPage,
	StoriesQuery,
	StoryChatSeedDto,
	StoryCoverResponse,
	StoryDto,
	type StoryLifecycleAction,
	StoryLifecycleResponse,
	StoryPlaybackDto,
	StoryPlayStartRequest,
	StoryPlayStartResponse,
	StoryPublishRequest,
	StoryPublishResponse,
	StoryUpdateRequest,
	StoryUpdateResponse,
	toStoriesSearchParams,
} from "@rowcat/contracts";
import type { Story, StoryPage } from "@rowcat/domain";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/** List query input. Axes left out are filled by the contract's defaults. */
export type StoriesListInput = Partial<StoriesQuery>;

export interface StoriesApi {
	list(input?: StoriesListInput, options?: RequestOptions): Promise<StoryPage>;
	/** One story. A story the viewer cannot see returns the same 404 as a nonexistent story. */
	get(storyId: string, options?: RequestOptions): Promise<Story>;
	/**
	 * Related stories: those sharing tags, up to eight. An empty array when there are none, which is
	 * not an error. An original the viewer cannot see returns the same 404 as the detail call.
	 */
	related(storyId: string, options?: RequestOptions): Promise<Story[]>;
	/**
	 * Records one view.
	 *
	 * Kept separate from the detail fetch (`get`). GET runs for SSR, prefetch, revalidation, and
	 * crawlers, with no real view involved. The screen knows what counts as a real view (the detail
	 * actually drew in the browser). The server decides deduplication and self-view exclusion.
	 */
	recordView(storyId: string, options?: RequestOptions): Promise<void>;

	/**
	 * Records a play start. Call it once, after the device has actually created the local session.
	 *
	 * This is a different event from `play` or `playback` succeeding. Those responses mean the body
	 * was received. This call means a room (conversation) or a VM session (runtime) actually started
	 * from that body. Only the device knows that boundary, so the server cannot count it alone.
	 * `sessionKey` is the session's identity (room id or library row id) and serves as the server's
	 * idempotency key, so retries and re-renders are not counted twice.
	 *
	 * An ineligible story returns 404, the same as a nonexistent one. Swallowing failures is the
	 * screen's job. A conversation that started must not appear as an error because a metric failed.
	 */
	recordPlayStart(
		storyId: string,
		input: StoryPlayStartRequest,
		options?: RequestOptions,
	): Promise<StoryPlayStartResponse>;

	/**
	 * Acquires the playback snapshot. Call it once, when starting a conversation.
	 *
	 * Separate from `get` because of size and intent. Detail returns discovery metadata. This returns
	 * the full body, including scenario, character cards, and lore, which is much heavier. Merging it
	 * into detail would send the whole body whenever someone merely browses, including prefetch.
	 *
	 * The exposure check goes through the same gate as detail. An unviewable story returns 404 here
	 * too, so the failure reason cannot reveal whether the story is private, blocked, or adult-only.
	 */
	play(storyId: string, options?: RequestOptions): Promise<StoryChatSeedDto>;

	/**
	 * Unified playback: decides what the story should open with now.
	 *
	 * It stands beside `play` for compatibility. Turning `play` into a discriminated union would make
	 * already-deployed clients receive shapes they do not know, and that failure would look like 'the
	 * story cannot be opened'. So the old path keeps returning a conversation snapshot even for
	 * runtime stories. This is an intended compatibility fallback.
	 *
	 * Authorization goes through the same door as the old path. An ineligible caller is rejected here
	 * with the same code, and the failure reason cannot reveal private, blocked, or adult status.
	 *
	 * The artifact arrives as `unknown`. This layer does not know execution formats. Pre-execution
	 * validation is done by the player's runtime host.
	 */
	playback(
		storyId: string,
		options?: RequestOptions,
	): Promise<StoryPlaybackDto>;

	/**
	 * First publish: uploads a local draft as a story. Idempotent.
	 *
	 * Calling again with the same `originDraftId` updates the story that draft created. It does not
	 * create a new one, and it returns `created: false`. The caller therefore need not distinguish a
	 * lost response from a failure. Retrying either way converges on the same story.
	 *
	 * Retry logic is not placed in this layer, because that judgment belongs to the screen. Publishing
	 * is an explicit user action, and the account may have changed in between. The app records the
	 * result only after it re-checks ownership.
	 */
	publish(
		input: StoryPublishRequest,
		options?: RequestOptions,
	): Promise<StoryPublishResult>;

	/**
	 * Updates a published story. The owner re-uploads their own story from their own draft.
	 *
	 * This is a full replacement, not a partial edit. Play snapshots are self-contained. Swapping only
	 * some parts would produce a story whose characters are the new version and whose lore is the old
	 * one.
	 */
	update(
		storyId: string,
		input: StoryUpdateRequest,
		options?: RequestOptions,
	): Promise<Story>;

	/**
	 * Lifecycle transition: moves the exposure state of a story that is already published.
	 *
	 * The name resembles `publish` (which uploads a draft), but the operation differs. This sends no
	 * authoring content, so the original draft need not exist on this device. A creator who published
	 * from another device, or who deleted the draft, can still take the story down and back up.
	 *
	 * All five take no body and are idempotent. Calling one on a story already in that state succeeds
	 * and returns the current story. The only rejections are forbidden transitions: switching an
	 * archived story to public or private, and restoring a public story. `STORY_LIFECYCLE_ERROR_CODE`
	 * names only those two.
	 *
	 * The five are separate methods rather than one `lifecycle(storyId, action)`, so call sites do not
	 * carry vocabulary strings. The query layer still needs that vocabulary, since the cache to evict
	 * differs per transition, so the vocabulary itself belongs to the contract.
	 */
	makePublic(storyId: string, options?: RequestOptions): Promise<Story>;
	/**
	 * Moves the story to link-only sharing: removed from lists, search, and profiles, but openable by
	 * address.
	 *
	 * The name is close to `makePrivate`, but the effect is nearly the opposite. This moves the story
	 * to a state that others can open. So the gate is the same as `makePublic`, and the server
	 * decides.
	 */
	makeUnlisted(storyId: string, options?: RequestOptions): Promise<Story>;
	makePrivate(storyId: string, options?: RequestOptions): Promise<Story>;
	archive(storyId: string, options?: RequestOptions): Promise<Story>;
	restore(storyId: string, options?: RequestOptions): Promise<Story>;

	/**
	 * Uploads or replaces the cover, and sends the bytes as-is.
	 *
	 * The bytes are not wrapped in base64 inside JSON. That would add 33% to the transfer size. More
	 * importantly, it would turn the image into a document with one field, pushing the server's body
	 * size limit behind JSON parsing. The limit must apply before parsing.
	 *
	 * The return value is the story after the change. The screen does not assemble `coverUrl` itself.
	 * The rules for building the address (origin, path, version axis) belong to the server, and a
	 * browser copy would go stale when the deployment changes those rules.
	 *
	 * `Content-Type` carries the file's own declared type, but the server does not trust it and
	 * decodes the bytes to judge. It is sent for diagnostics.
	 */
	setCover(
		storyId: string,
		image: Blob,
		options?: RequestOptions,
	): Promise<Story>;

	/**
	 * Removes the cover. Idempotent.
	 *
	 * A story without a cover succeeds, and the returned story's `coverUrl` is `null`. Treating a
	 * retry of a lost response as an error would make the screen report failure when the state the
	 * user wanted is already true.
	 */
	removeCover(storyId: string, options?: RequestOptions): Promise<Story>;
}

/**
 * Publish result. `created` says whether this request created the story. It is false when the
 * request recovered an existing one.
 */
export interface StoryPublishResult {
	created: boolean;
	story: Story;
}

/** An id containing `/` or `?` breaks the path entirely, so it is encoded before appending. */
const storyPath = (storyId: string) =>
	`/stories/${encodeURIComponent(storyId)}`;

const coverPath = (storyId: string) => `${storyPath(storyId)}/cover`;

/**
 * Maps each lifecycle action to its path segment. Each action's name is in the address, so a
 * forbidden transition cannot be expressed.
 */
const LIFECYCLE_PATH: Record<StoryLifecycleAction, string> = {
	publish: "publish",
	unlist: "unlist",
	unpublish: "unpublish",
	archive: "archive",
	restore: "restore",
};

export function createStoriesApi({
	requestJson,
	requestVoid,
}: RowCatTransport): StoriesApi {
	/**
	 * One implementation covers the five transitions. The only difference is the path segment.
	 *
	 * Validation lives here too. Copying the code five times would eventually drop `safeParse` in one
	 * place, and that unchecked response would sit in the screen's cache.
	 */
	const lifecycle = async (
		storyId: string,
		action: StoryLifecycleAction,
		options?: RequestOptions,
	): Promise<Story> => {
		const path = `${storyPath(storyId)}/${LIFECYCLE_PATH[action]}`;
		/**
		 * No body. The path determines what to move, and the action name determines where it moves to.
		 */
		const json = await requestJson({
			method: "POST",
			path,
			signal: options?.signal,
		});
		const parsed = StoryLifecycleResponse.safeParse(json);
		if (!parsed.success) throw invalidResponse(`POST ${path}`);
		return parsed.data.story;
	};

	return {
		async list(input = {}, options) {
			// Input is also filtered once by the contract. The serialization rule (omitting defaults)
			// assumes normalized values. Passing it through unfiltered would send the same query to two
			// different URLs.
			const query = StoriesQuery.parse(input);
			const json = await requestJson({
				method: "GET",
				path: "/stories",
				search: toStoriesSearchParams(query),
				signal: options?.signal,
			});

			const parsed = StoriesPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/stories");
			/**
			 * A `StoriesPage` that passes validation has fields identical one to one with the domain
			 * `StoryPage`.
			 *
			 * There is no mapper that copies fields one by one. Such code neither validates nor transforms,
			 * and each added field would add another place to edit. If the shapes diverge, compilation fails
			 * at this return, and the difference is absorbed here at that point.
			 */
			return parsed.data;
		},

		async get(storyId, options) {
			const json = await requestJson({
				method: "GET",
				path: storyPath(storyId),
				signal: options?.signal,
			});
			/**
			 * Reads with the same `StoryDto` used for list items. A separate `StoryDetailDto` is not created
			 * just because this is the detail call, since the two responses actually share one shape.
			 * Splitting them now would create two schemas to update per field and blur which one is the
			 * truth. Split them on the day a field that only detail needs actually appears.
			 */
			const parsed = StoryDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/stories/:id");
			return parsed.data;
		},

		async related(storyId, options) {
			const path = `${storyPath(storyId)}/related`;
			const json = await requestJson({
				method: "GET",
				path,
				signal: options?.signal,
			});
			const parsed = RelatedStoriesResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse(path);
			return parsed.data.items;
		},

		async recordView(storyId, options) {
			/**
			 * Sent without a body. Inventing a `{}` the server does not read would signal that the endpoint
			 * takes input, and that false signal would harden into the contract. The response is 204, so
			 * there is no body to validate. Failures are converted to `RowCatApiError` by the shared error
			 * conversion.
			 */
			await requestVoid({
				method: "POST",
				path: `${storyPath(storyId)}/view`,
				signal: options?.signal,
			});
		},

		async recordPlayStart(storyId, input, options) {
			const path = `${storyPath(storyId)}/play-starts`;
			const json = await requestJson({
				method: "POST",
				path,
				body: StoryPlayStartRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = StoryPlayStartResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse(`POST ${path}`);
			return parsed.data;
		},

		async publish(input, options) {
			const json = await requestJson({
				method: "POST",
				path: "/stories",
				// Builds the body with the same contract the server reads, so defaults are filled here.
				body: StoryPublishRequest.parse(input),
				signal: options?.signal,
			});
			/**
			 * Validates the response as well. The result is used to write the story id into a draft and
			 * navigate to that screen. If a mismatched shape passed, a draft pointing at a nonexistent story
			 * would stay on the device.
			 */
			const parsed = StoryPublishResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("POST /stories");
			return { created: parsed.data.created, story: parsed.data.story };
		},

		async update(storyId, input, options) {
			const json = await requestJson({
				method: "PUT",
				path: storyPath(storyId),
				body: StoryUpdateRequest.parse(input),
				signal: options?.signal,
			});
			const parsed = StoryUpdateResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("PUT /stories/:id");
			return parsed.data.story;
		},

		async play(storyId, options) {
			const json = await requestJson({
				method: "GET",
				path: `${storyPath(storyId)}/play`,
				signal: options?.signal,
			});
			/**
			 * Validation matters especially here. This value is not just rendered and discarded. It stays on
			 * the user's device for months. A malformed payload stored in a room would crash the assembler
			 * every time the room opens, and the only fix would be deleting the room. Stopping at
			 * acquisition means the room is never created, and the user simply retries.
			 */
			const parsed = StoryChatSeedDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/stories/:id/play");
			return parsed.data;
		},

		async playback(storyId, options) {
			const json = await requestJson({
				method: "GET",
				path: `${storyPath(storyId)}/playback`,
				signal: options?.signal,
			});
			/**
			 * Validates only the envelope shape. The runtime branch's `artifact` is `unknown`, so passing
			 * here means only that the discriminator and version match. Pre-execution validation is done by
			 * the runtime host.
			 *
			 * If this layer started parsing artifacts, the SDK would be bound to the compiler's emit format.
			 */
			const parsed = StoryPlaybackDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/stories/:id/playback");
			return parsed.data;
		},

		makePublic: (storyId, options) => lifecycle(storyId, "publish", options),
		makeUnlisted: (storyId, options) => lifecycle(storyId, "unlist", options),
		makePrivate: (storyId, options) => lifecycle(storyId, "unpublish", options),
		archive: (storyId, options) => lifecycle(storyId, "archive", options),
		restore: (storyId, options) => lifecycle(storyId, "restore", options),

		async setCover(storyId, image, options) {
			const json = await requestJson({
				method: "PUT",
				path: coverPath(storyId),
				rawBody: image,
				/**
				 * The format the file declares for itself. It can be empty (files without an extension), so
				 * there is a fallback. Without a header, fetch picks one arbitrarily.
				 */
				contentType: image.type || "application/octet-stream",
				signal: options?.signal,
			});
			const parsed = StoryCoverResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("PUT /stories/:id/cover");
			return parsed.data.story;
		},

		async removeCover(storyId, options) {
			/**
			 * Receives the story rather than a 204. If the screen wrote 'the cover has disappeared' on its
			 * own, its judgment could diverge from the server's, since another device may have uploaded a
			 * new cover at the same moment. Returning the story also avoids a second code path that sets
			 * `coverUrl` to `null`.
			 */
			const json = await requestJson({
				method: "DELETE",
				path: coverPath(storyId),
				signal: options?.signal,
			});
			const parsed = StoryCoverResponse.safeParse(json);
			if (!parsed.success) throw invalidResponse("DELETE /stories/:id/cover");
			return parsed.data.story;
		},
	};
}
