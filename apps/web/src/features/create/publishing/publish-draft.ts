import type { AuthoringStore, PublicationIssue } from "@rowcat/authoring";
import { buildStoryPublication } from "@rowcat/authoring";
import type { StoryPublishRequest } from "@rowcat/contracts";
import {
	CAPABILITY_ERROR_CODE,
	STORY_LIFECYCLE_ERROR_CODE,
	STORY_PUBLISH_ERROR_CODE,
	StoryRuntimePublishFailure,
} from "@rowcat/contracts";
import { isRowCatApiError } from "@rowcat/sdk";

/**
 * Publish sequence. Kept out of the component because it orders irreversible steps.
 * - Ownership is checked before the server write, before the draft write, and before navigation.
 *   The session cookie goes out with the request, so an account switch would create the work under
 *   the wrong account.
 * - The server write is idempotent per member and draft, so no client retry state machine is
 *   needed. Client-side first-attempt detection breaks after a lost response.
 * - The cover upload is the only step that swallows errors. The work already exists, so the
 *   staged cover stays on the device until upload succeeds, letting the user retry from `Manage cover`.
 */

/**
 * Internal failure branches, not one-to-one with screen copy. They are split because the user's
 * next action differs: adult content needs identity verification, an archived target must be
 * restored in `Published`, and a story owned by another draft is fixed in that draft. `storage` and
 * `unknown` show the same copy but stay separate. A local store failure and a server failure are
 * fixed in different places. `public_unavailable` was removed. The server no longer returns it now
 * that public publishing is open. Keeping the branch would keep the `Public publishing is coming soon` message,
 * which is no longer true.
 */
export type PublishFailureReason =
	/**
	 * The draft was published in archived state. The screen offers only two visibilities (`Public`,
	 * `Private`), so only a hand-built client can reach this. Kept as its own branch because folding it
	 * would show `Please try again in a moment`, and every retry gets the same rejection.
	 */
	/**
	 * Must not be folded into the generic retry copy. Every retry returns the same rejection. The user
	 * must pick the image again, and the copy points to that spot.
	 */
	| "scene_image_invalid"
	/**
	 * Must not be folded into the generic retry copy. Every retry returns the same rejection. The user
	 * must fix the code in the studio. The server sends diagnostics that name the file and line.
	 */
	| "runtime_invalid"
	/**
	 * Split from `runtime_invalid`: that code means fix the code, this one means fix the asset list.
	 * The contract header says the same. The server does not say which binding failed, since that
	 * would act as a media-existence probe. The copy does not guess either.
	 */
	| "runtime_asset_invalid"
	| "archived_unavailable"
	/**
	 * Distinct from the archived-destination case above. Here the request is valid but its target is
	 * archived. The user must restore the work in `Published` and publish again. A silent restore would
	 * raise a work the creator deliberately took down, as a side effect.
	 */
	| "story_archived"
	| "adult_not_permitted"
	/**
	 * The account is restricted from publishing. Cover upload receives the same two codes in
	 * `features/create/cover/file.ts`: account_restricted (whole account) and capability_restricted
	 * (this capability only). Not folded into generic retry copy, for the same reason as above: until
	 * the restriction lifts, every retry gets the same rejection. The reason is not rendered here. The
	 * authority for restriction reasons is `GET /v2/me/moderation`. The copy only points to that
	 * screen.
	 */
	| "restricted"
	| "origin_mismatch"
	| "storage"
	| "unknown";

export type PublishDraftOutcome =
	| { status: "published"; storyId: string; created: boolean }
	/** A publish is already in progress. This is not a failure, so the screen changes nothing. */
	| { status: "busy" }
	/**
	 * The scope that started the publish is no longer active. The user signed out or switched accounts
	 * mid-flight. Split from `failed` because neither the draft nor the server has a problem. The
	 * screen shows no error: the publish simply did not happen.
	 */
	| { status: "stale" }
	| { status: "invalid"; issues: PublicationIssue[] }
	/**
	 * Runtime diagnostics sent by the server, present only when reason is `runtime_invalid`. The
	 * envelope's `details` is parsed with the contract schema. If parsing fails, the list is treated
	 * as absent. When present, the screen draws the same shape as the studio `Problems` list. When
	 * absent, only the generic message is drawn. Never invent diagnostics.
	 */
	| {
			status: "failed";
			reason: PublishFailureReason;
			runtime?: StoryRuntimePublishFailure;
	  };

export interface PublishDraftResult {
	created: boolean;
	story: { id: string };
}

export interface PublishDraftInput {
	draftId: string;
	/**
	 * Synchronous lock against duplicate runs in the same tick. React state cannot do this: `setState`
	 * lands on the next render, so two double-click events both pass. A ref is visible immediately
	 * after assignment, which closes the window. A second request leaking through would not duplicate
	 * the work, since the server is idempotent. The lock still matters: the same draft would upload
	 * twice, and two responses arriving in either order would make the screen flicker.
	 */
	lock: { current: boolean };
	ensureStore: () => Promise<AuthoringStore | null>;
	/**
	 * Whether this store still belongs to the active scope. It takes a predicate on purpose: this
	 * function must not know React or Dexie. How ownership is decided differs by platform, but when to
	 * ask is the same everywhere. That ordering is what this function enforces. It is synchronous on
	 * purpose. Awaiting inside the check would make the check itself stale.
	 */
	stillOwnsStore: (store: AuthoringStore) => boolean;
	publish: (request: StoryPublishRequest) => Promise<PublishDraftResult>;
	/**
	 * Navigation. Must return a promise: router navigation is async (loaders and pending boundaries).
	 * Without awaiting, 'navigated' is reported before the move finishes.
	 */
	navigate: (storyId: string) => Promise<unknown>;
	/**
	 * Uploads the staged cover to this work. Does nothing when there is no staged cover. Injected
	 * because this module knows neither Dexie nor the SDK, same as `publish`. This module decides only
	 * when it is called and how failures are handled. Optional on purpose: callers without cover
	 * support skip this step, and the rest of the order is unchanged.
	 */
	uploadStagedCover?: (storyId: string) => Promise<void>;
}

/**
 * Maps a server rejection to the branch the screen switches on. Decided by error code, not HTTP
 * status. Policy rejections are mostly 403 or 409, but the user's next step differs. Status alone
 * would show them the same copy.
 */
function publishRuntimeFailure(
	error: unknown,
): StoryRuntimePublishFailure | undefined {
	if (!isRowCatApiError(error)) return undefined;
	const parsed = StoryRuntimePublishFailure.safeParse(error.details);
	return parsed.success ? parsed.data : undefined;
}

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
	ensureStore,
	stillOwnsStore,
	publish,
	navigate,
	uploadStagedCover,
}: PublishDraftInput): Promise<PublishDraftOutcome> {
	if (lock.current) return { status: "busy" };
	// Lock before the first await, so a second call in the same tick cannot get past this point.
	lock.current = true;

	try {
		const store = await ensureStore();
		if (!store) return { status: "failed", reason: "storage" };

		/**
		 * Reads the draft and its children in one call. Separate reads could interleave with autosave and
		 * yield a mixed snapshot, such as new characters with the previous lore.
		 */
		const source = await store.loadPublicationSource(draftId);
		// The draft was deleted in another tab during editing. There is nothing to send to the server.
		if (!source) return { status: "failed", reason: "storage" };

		const built = buildStoryPublication(source);
		/**
		 * Validation failure sends nothing over the network. The server validates again anyway, but
		 * stopping here shows the user `Please enter a title`, not a generic `Publish failed`.
		 */
		if (!built.ok) return { status: "invalid", issues: built.issues };

		/**
		 * Ownership check right before the server write. The request carries the current session cookie,
		 * so sending after an account switch creates the draft as another account's work.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		let result: PublishDraftResult;
		try {
			result = await publish(built.publication);
		} catch (error) {
			const reason = publishFailureReason(error);
			if (reason !== "runtime_invalid") return { status: "failed", reason };
			const runtime = publishRuntimeFailure(error);
			return {
				status: "failed",
				reason,
				...(runtime === undefined ? {} : { runtime }),
			};
		}

		/**
		 * The server write has already completed. Stopping here leaves the work in place, so this check
		 * guards against writing into another user's draft, not against creating the work. A lost link is
		 * recovered by idempotency: signing back in as the original member and publishing again returns
		 * the same work, and the link is written then.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		try {
			await store.markPublished(draftId, result.story.id);
		} catch (error) {
			/**
			 * A local write failure after the work already exists on the server. Navigating here would show
			 * the work while the draft still reads unpublished, so the next publish looks like a first
			 * attempt. Idempotency still prevents duplicates, but the screen should not contradict stored
			 * state.
			 */
			console.error(
				"[create] couldn't write the publish result to the draft",
				error,
			);
			return { status: "failed", reason: "storage" };
		}

		/**
		 * Runs after markPublished, because the cover is keyed on the story id, which does not exist
		 * before. It runs before navigation so the arriving screen draws the cover. Failures are
		 * swallowed by contract. The staged cover stays on the device for re-upload from `Manage cover`.
		 */
		if (uploadStagedCover) {
			try {
				await uploadStagedCover(result.story.id);
			} catch (error) {
				console.error(
					"[create] couldn't upload the cover to the published story",
					error,
				);
			}
		}

		/**
		 * Last ownership check, before navigation. The account may have changed while the draft was being
		 * written. The window is much narrower than the earlier checks, but navigating now would send the
		 * current account to the previous account's work address, which ends in a 404.
		 */
		if (!stillOwnsStore(store)) return { status: "stale" };

		await navigate(result.story.id);
		return {
			status: "published",
			storyId: result.story.id,
			created: result.created,
		};
	} catch (error) {
		console.error("[create] couldn't publish", error);
		return { status: "failed", reason: "unknown" };
	} finally {
		lock.current = false;
	}
}
