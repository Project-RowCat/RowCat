import type { AuthoringStore, PublicationIssue } from "@rowcat/authoring";
import { buildStoryPublication } from "@rowcat/authoring";
import type { StoryPublishRequest } from "@rowcat/contracts";
import {
	CAPABILITY_ERROR_CODE,
	STORY_LIFECYCLE_ERROR_CODE,
	STORY_PUBLISH_ERROR_CODE,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";

/**
 * The publish order. It lives outside the screen because the order decides what cannot be undone.
 *
 * ```text
 * 0. flush pending autosave               ← stop here on failure
 * 1. wait for the local scope to open     (storage bound to a confirmed member)
 * 2. read the draft and children at once  (consistent snapshot)
 * 3. pure assembly and validation         (@rowcat/authoring)
 * 4. ownership check                      ← right before the server write
 * 5. upload                               (POST /v2/stories)
 * 6. ownership check                      ← right before writing the draft
 * 7. record the work id on the draft      (SQLite)
 * 8. ownership check                      ← right before navigating
 * 9. navigate to /stories/:id
 * ```
 *
 * The rule is that a failure at one step never triggers the next: a failed flush skips the read, a
 * failed validation sends nothing to the server, and a server rejection writes nothing to the
 * draft.
 *
 * Step 0 is the newest line. Publishing assembles from storage, so a sentence still in the debounce
 * buffer would be missed; publishing without flushing uploads a snapshot different from what the
 * creator sees, and only after publishing does that show. Failing the flush also means not
 * publishing: uploading without the unsaved edits is worse than not uploading.
 *
 * Three ownership checks because step 1's guarantee has a shelf life. The store was handed over at
 * one moment; during the round trips a logout or account switch can leave this closure holding
 * another account's store or a closed one. The check before step 5 matters most: the request leaves
 * with this device's session cookie, so sending after an account switch would make this manuscript
 * another account's work. The window cannot be closed (once sent, the server has acted as the old
 * account), only narrowed, and idempotency covers the rest.
 *
 * No retry state machine: server publish is idempotent per (member, draft), so one request serves
 * both a first attempt and a retry. Having the client decide "is this the first time" goes wrong
 * after a lost response, and that is how duplicate works get created.
 *
 * The web runs the same order in `apps/web/src/features/create/publish-draft.ts`. It is not in a
 * shared package because this function sees the authoring assembler, the SDK error classification
 * and the storage port together, and no package above those layers exists here. A test pins the
 * order instead, as `start-story-chat.ts` does.
 */

/**
 * Internal failure branches, not one-to-one with screen copy. `storage` and `unknown` show the same
 * sentence but stay apart: failing to open local storage and failing at the server need different
 * fixes.
 */
export type PublishFailureReason =
	| "scene_image_invalid"
	/**
	 * Runtime code failed server compilation, the runtime's managed-asset bindings cannot be
	 * published, or a sanction restricts publishing. The web splits these out too
	 * (`apps/web/.../publish-draft.ts`). Folding them into the generic copy would hide a failure that
	 * pressing again never fixes. This app has no studio, but runtime drafts sync here and publish
	 * from here, so the rejections need names.
	 */
	| "runtime_invalid"
	| "runtime_asset_invalid"
	| "restricted"
	| "archived_unavailable"
	| "story_archived"
	| "adult_not_permitted"
	| "origin_mismatch"
	| "storage"
	| "unknown";

export type PublishDraftOutcome =
	| {
			status: "published";
			storyId: string;
			created: boolean;
			navigated: boolean;
			/**
			 * Whether the staged cover was actually uploaded. `true` when there was nothing to upload.
			 *
			 * Same axis as `navigated`: both say "published, but the next step failed". Folding it into
			 * failure would make the screen offer retry. Retrying is harmless (the server is idempotent),
			 * but the user lost one cover and would read it as a lost publish.
			 */
			coverUploaded: boolean;
	  }
	/** Already in progress. Not a failure, so the screen changes nothing. */
	| { status: "busy" }
	/** Pending edits could not be written to storage. Nothing was sent to the server. */
	| { status: "unsaved" }
	/**
	 * The scope that started is no longer active: the user signed out or switched accounts mid-flight.
	 * Kept apart from `failed` because nothing is wrong with the draft or the server. It is the result
	 * of the user's own action, so the screen shows no error, just that nothing was published.
	 */
	| { status: "stale" }
	/** The draft cannot be published yet. Carries which fields block it and why. */
	| { status: "invalid"; issues: PublicationIssue[] }
	| { status: "failed"; reason: PublishFailureReason };

export interface PublishDraftResult {
	created: boolean;
	story: { id: string };
}

export interface PublishDraftInput {
	draftId: string;
	/**
	 * Synchronous lock against same-tick double runs. React state cannot do this: `setState` lands on
	 * the next render, so two events in one tick would both see "not running". A ref is visible at
	 * once.
	 *
	 * This is not a substitute for server idempotency. A second request that leaks through does not
	 * create two works, because the server is idempotent per (member, draft). The lock avoids
	 * uploading the same manuscript twice and a screen that depends on which response arrives first.
	 */
	lock: { current: boolean };
	/**
	 * Writes pending autosave now. `false` means do not publish.
	 *
	 * Injected because this function knows neither React nor timers. What it decides is when to call
	 * this and what it must not do on failure; both are part of the order on every platform.
	 */
	flushAutosave: () => Promise<boolean>;
	ensureStore: () => Promise<AuthoringStore | null>;
	/**
	 * Whether this store still belongs to the active scope.
	 *
	 * Passed in as a predicate: how ownership is judged differs per platform, but *when* to ask does
	 * not, and that timing is what this function must keep. Synchronous on purpose: awaiting inside
	 * the check would let the check itself go stale.
	 */
	stillOwnsStore: (store: AuthoringStore) => boolean;
	publish: (request: StoryPublishRequest) => Promise<PublishDraftResult>;
	/**
	 * Uploads the cover staged on this device to the new work, after the draft link is written.
	 *
	 * Injected because this function knows neither storage nor the SDK. Returns `Promise<boolean>`
	 * because a failure here is not a publish failure: the work already exists on the server. With
	 * nothing staged it makes no request and resolves `true`, so a publish without a cover stays one
	 * request.
	 */
	uploadStagedCover: (storyId: string) => Promise<boolean>;
	/** Navigation. Returning a promise is part of the contract: native stack navigation is asynchronous too. */
	navigate: (storyId: string) => Promise<unknown>;
}

/**
 * Server rejection → the branch the screen draws.
 *
 * Decided by error code, not status code: most policy rejections are 403 or 409, but the user's
 * next step differs, so status alone would give them the same copy.
 */
function publishFailureReason(error: unknown): PublishFailureReason {
	if (!isRowCatApiError(error)) return "unknown";
	switch (error.code) {
		case STORY_LIFECYCLE_ERROR_CODE.archived:
			return "story_archived";
		case STORY_PUBLISH_ERROR_CODE.archivedUnavailable:
			return "archived_unavailable";
		case STORY_PUBLISH_ERROR_CODE.adultNotPermitted:
			return "adult_not_permitted";
		case STORY_PUBLISH_ERROR_CODE.originMismatch:
			return "origin_mismatch";
		case STORY_PUBLISH_ERROR_CODE.sceneImageInvalid:
			return "scene_image_invalid";
		case STORY_PUBLISH_ERROR_CODE.runtimeInvalid:
			return "runtime_invalid";
		case STORY_PUBLISH_ERROR_CODE.runtimeAssetInvalid:
			return "runtime_asset_invalid";
		case CAPABILITY_ERROR_CODE.restricted:
		case "account_restricted":
			return "restricted";
		default:
			return "unknown";
	}
}

export async function publishDraft({
	draftId,
	lock,
	flushAutosave,
	ensureStore,
	stillOwnsStore,
	publish,
	uploadStagedCover,
	navigate,
}: PublishDraftInput): Promise<PublishDraftOutcome> {
	if (lock.current) return { status: "busy" };
	// Lock before the first `await`, so a second call in the same tick cannot get this far.
	lock.current = true;

	try {
		/**
		 * Flush first. The read below takes from storage, so a sentence still in the debounce buffer
		 * would be missed.
		 */
		if (!(await flushAutosave())) return { status: "unsaved" };

		const store = await ensureStore();
		if (!store) return { status: "failed", reason: "storage" };

		/**
		 * Read the draft and its children in one call. Separate reads could mix an autosave between them,
		 * publishing a new prompt with an old lore. The storage makes the snapshot atomic
		 * (`loadPublicationSource`).
		 */
		const source = await store.loadPublicationSource(draftId);
		// A deletion from another device arrived mid-edit: nothing is left to send.
		if (!source) return { status: "failed", reason: "storage" };

		const built = buildStoryPublication(source);
		/**
		 * A validation failure sends nothing over the network. The server validates again, but stopping
		 * here lets the user see "enter a title" instead of "publish failed".
		 */
		if (!built.ok) return { status: "invalid", issues: built.issues };

		/**
		 * Check right before the server write. The request leaves with this device's session cookie, so
		 * if the account changed, this manuscript would become another account's work.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		let result: PublishDraftResult;
		try {
			result = await publish(built.publication);
		} catch (error) {
			return { status: "failed", reason: publishFailureReason(error) };
		}

		/**
		 * The server write has already happened, so stopping here still leaves the work on the server.
		 * What this check prevents is writing to another member's draft. The lost link is recovered by
		 * idempotency: signing back in as the original member and publishing again finds the same work
		 * and links it to the draft then.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		try {
			await store.markPublished(draftId, result.story.id);
		} catch {
			/**
			 * Local write failed; the work already exists on the server. Navigating now would show the work
			 * while the draft still reads unpublished, so the next publish would look like a first one.
			 * Idempotency prevents a duplicate, but the screen should not lie. Errors are not logged: the
			 * product path has no `console` calls, and the values here include authored content.
			 */
			return { status: "failed", reason: "storage" };
		}

		/**
		 * Last boundary: the account can change while the draft is being written. This window is much
		 * narrower than the ones above (one local write), but navigating now would open the previous
		 * account's work address for whoever is signed in.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		/**
		 * Upload the staged cover after the draft link is written. The order is the rule: uploading first
		 * could leave a cover with no link, and publishing again would upload the same cover a second
		 * time. Written last, the worst case is "work and link exist, cover missing", which the creator
		 * can fix under `Manage cover`.
		 *
		 * Swallows the failure. Throwing here would make the outer `catch` report the already-published
		 * work as `failed`: the user lost one cover and would read it as a lost publish.
		 */
		const coverUploaded = await uploadStagedCover(result.story.id).catch(
			() => false,
		);

		/**
		 * Navigation failure is not a publish failure. This `try` stands apart for that reason: falling
		 * through to the outer `catch` would report the published work as `failed` and offer retry. Retry
		 * is harmless (idempotent), but the user lost only the navigation and would read a failed
		 * publish.
		 */
		try {
			await navigate(result.story.id);
		} catch {
			return {
				status: "published",
				storyId: result.story.id,
				created: result.created,
				navigated: false,
				coverUploaded,
			};
		}
		return {
			status: "published",
			storyId: result.story.id,
			created: result.created,
			navigated: true,
			coverUploaded,
		};
	} catch {
		return { status: "failed", reason: "unknown" };
	} finally {
		lock.current = false;
	}
}
