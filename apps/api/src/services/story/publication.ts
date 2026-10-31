import {
	CHAT_SEED_VERSION,
	STORY_LIFECYCLE_ERROR_CODE,
	STORY_PUBLISH_ERROR_CODE,
	type StoryChatSeedDto,
	StoryChatSeedDto as StoryChatSeedSchema,
	type StoryPublishMetadata,
	type StoryPublishPlayInput,
	type StoryPublishRequest,
} from "@rowcat/contracts";
import type { Story } from "@rowcat/domain";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Viewer } from "../../auth/viewer.ts";
import { db } from "../../db/client.ts";
import { story } from "../../db/schema.ts";
import { ApiError, forbidden, notFound } from "../../lib/errors.ts";
import { isAdultVerified, requireNonChild } from "../../lib/gates.ts";
import { newId } from "../../lib/id.ts";
import {
	findUnusableSceneImages,
	syncStorySceneImageReferences,
} from "../scene-image.ts";
import { getOwnedStory } from "./index.ts";
import { notifyFollowersOfNewPublicStory } from "./publication-notice.ts";
import { applyStoryRuntimePlan, planStoryRuntime } from "./runtime.ts";

/**
 * Publication: the single boundary where a local draft becomes a catalogue work.
 *
 * - The server is the authority. The client sends authored content and a request (rating,
 *   visibility); this file decides whether that is allowed, and rejects rather than silently
 *   lowering it (an adult work quietly published as all-ages is worse than a refusal).
 * - The server assembles the playback snapshot, so `play_payload.storyId` can never differ from
 *   the row id and the catalogue badge cannot diverge from what plays.
 * - Metadata and playback payload are written in one statement; a split would leave a work with a
 *   new title and old content that viewers cannot tell from a healthy one.
 */

/**
 * Publication can produce exactly three visibilities: public, unlisted, private.
 *
 * This is an allowlist so a new contract value falls on the rejecting side (a "reject archived
 * only" form once let a new value through; the `never` assignment catches it at compile time).
 * Public publishing has no pre-moderation: it reaches the catalogue as soon as it passes the gates
 * (report -> case -> `hide_story` enforcement, adult publishing eligibility, adult viewing gate,
 * the `story.publish` capability, the publish breaker).
 *
 * Archived is rejected because it is a state transition of an already-published work with its own
 * endpoint (`services/story/lifecycle.ts`); reachable from publish, a work would be neither in the
 * gallery nor openable from the creator list while the screen reports success. Nothing is lowered
 * silently: someone who chose unlisted means to share the link, and a quiet fold to private would
 * hand out a link that 404s.
 */
function requirePublishableVisibility(metadata: StoryPublishMetadata): void {
	switch (metadata.visibility) {
		case "private":
		/**
		 * Unlisted is a publication destination, not a transition: requiring "publish public, then take
		 * down" would expose the work in the catalogue for seconds, which cannot be undone.
		 */
		case "unlisted":
		case "public":
			return;
		case "archived":
			throw new ApiError(
				403,
				STORY_PUBLISH_ERROR_CODE.archivedUnavailable,
				"You can't publish in the archived state. You can archive after publishing.",
			);
		default: {
			/**
			 * The vocabulary grew without a publish policy. The `never` assignment catches this at compile
			 * time; if it ships anyway, refusal is the default. It is a 500 rather than a policy code
			 * because the client did nothing wrong, and borrowing an existing code would make the screen
			 * invent guidance and hide that this function needs fixing.
			 */
			const unhandled: never = metadata.visibility;
			throw new Error(
				`a visibility state with no publish policy: ${String(unhandled)}`,
			);
		}
	}
}

/**
 * Adult publishing eligibility: the legal requirement only, not the display opt-in
 * (`canViewAdult`). Viewing and publishing are different axes; a verified adult who turned display
 * off can still publish. The screen may pre-lock the button, but this is the final decision.
 *
 * It takes the rating boolean because there are two consumers: publication passes the requested
 * rating, and the public transition (`services/story/lifecycle.ts`) passes the stored row's rating.
 * Without the second, a member who lost verification could raise an adult work to public.
 */
export function requireAdultPublishEligibility(
	viewer: Viewer,
	adult: boolean,
): void {
	if (!adult) return;
	/**
	 * A child cannot pass through adult verification. `isAdultVerified` would already block them; this
	 * comes first for the reason, since the refusal below ("complete adult verification") is false for
	 * under-14 and sends them looking for a procedure that does not exist.
	 */
	requireNonChild(viewer, "adult");
	if (!isAdultVerified(viewer))
		throw forbidden(
			"Only members who completed adult verification can publish adult stories.",
			STORY_PUBLISH_ERROR_CODE.adultNotPermitted,
		);
}

/**
 * The publish path never touches an archived work and never restores it silently. This is where the
 * `archived -> public` prohibition is enforced: otherwise one press would return a work the creator
 * took down without going through `Restore`, even when sending `private`.
 */
function rejectArchivedTarget(): never {
	throw new ApiError(
		409,
		STORY_LIFECYCLE_ERROR_CODE.archived,
		"This story is archived. Restore it, then publish again.",
	);
}

/**
 * Authored content plus the server-fixed identity -> playback snapshot.
 *
 * `version`, `storyId`, `title`, `adult` and `promptProtected` are filled here, never taken from
 * the client (forgeable, and on first publish the story id does not exist yet). The final contract
 * parse exists because the jsonb column enforces no shape, and a malformed payload would land on
 * user devices and keep that room from ever opening.
 */
export function buildPlayPayload(
	storyId: string,
	metadata: StoryPublishMetadata,
	play: StoryPublishPlayInput,
): StoryChatSeedDto {
	return StoryChatSeedSchema.parse({
		version: CHAT_SEED_VERSION,
		storyId,
		title: metadata.title,
		tagline: play.tagline,
		adult: metadata.adult,
		promptProtected: metadata.promptProtected,
		scenario: play.scenario,
		firstScene: play.firstScene,
		playGuide: play.playGuide,
		persona: play.persona,
		characters: play.characters,
		lore: play.lore,
		startScenes: play.startScenes,
		sceneImages: play.sceneImages,
	});
}

/**
 * Gallery size value: serialized bytes of the playback payload, excluding the cover. Bytes rather
 * than `.length` because Hangul is 3 bytes in UTF-8 and a character count would understate it.
 */
const payloadBytes = (payload: StoryChatSeedDto): number =>
	Buffer.byteLength(JSON.stringify(payload), "utf8");

/**
 * Rejects publication when a scene image reference is not this creator's asset.
 *
 * The contract checks shape only; a 32-char `assetId` does not prove ownership, and an unchecked
 * foreign media id would render fine (media reads are public), letting someone use another person's
 * picture in their scene. The entry is not dropped silently because the creator would believe the
 * images shipped. The response does not say which reference failed: separating missing from foreign
 * assets would make it a probe for media id existence.
 */
async function requireOwnSceneImages(
	ownerId: string,
	play: StoryPublishPlayInput,
): Promise<void> {
	const missing = await findUnusableSceneImages(
		ownerId,
		play.sceneImages.map((image) => image.assetId),
	);
	if (missing.length === 0) return;
	throw new ApiError(
		400,
		STORY_PUBLISH_ERROR_CODE.sceneImageInvalid,
		"A scene image wasn't found. Please upload the image again.",
	);
}

export interface PublishStoryResult {
	/**
	 * Whether this request created the work. `false` is a recovery, not a failure: an existing work
	 * from the same draft was updated.
	 */
	created: boolean;
	story: Story;
}

/**
 * First publication: one work per (member, draft).
 *
 * Calling again with the same draft updates the existing work with this snapshot instead of making
 * a second one. A lost response would otherwise make the creator press again and produce two works
 * with no way to tell which is real. It updates rather than returning the existing row because the
 * draft may have been edited since, and pressing `Publish` means "publish what is here now". This also
 * spares the client a POST-failure -> PUT-retry state machine.
 *
 * It is a single upsert statement: split into SELECT then INSERT, two concurrent requests for the
 * same draft would both see nothing and both insert. The unique index ends the race inside the DB
 * and the loser is absorbed into the update path.
 */
export async function publishStory(
	viewer: Viewer,
	request: StoryPublishRequest,
	/** The request's signal; a client that leaves ends its compile (`runtime-compile.ts`). */
	signal?: AbortSignal,
): Promise<PublishStoryResult> {
	requirePublishableVisibility(request.metadata);
	requireAdultPublishEligibility(viewer, request.metadata.adult);
	await requireOwnSceneImages(viewer.id, request.play);
	/**
	 * Runtime compilation runs outside the transaction and before the publish DB work. Before, so a
	 * rejected compile writes nothing and leaves the published work untouched; outside, because
	 * building a TypeScript program takes hundreds of milliseconds and holding a connection or lock
	 * that long slows unrelated requests (cover normalization made the same call).
	 */
	const runtime = await planStoryRuntime(request.runtime, viewer.id, signal);

	/**
	 * Mint the identity up front: the payload needs the id before INSERT, which avoids an "insert
	 * first, patch later" window.
	 */
	const candidateId = newId();
	const payload = buildPlayPayload(candidateId, request.metadata, request.play);

	/**
	 * The playback snapshot and its media dependencies commit in one transaction. Split, either a new
	 * payload keeps stale references (account deletion removes an image the work just published) or
	 * new references outlive their payload (indefinite retention). Neither raises an error, so a
	 * transaction boundary guards it rather than discipline.
	 */
	const row = await db.transaction(async (tx) => {
		/**
		 * Read the starting visibility before the upsert; the follower notification decision needs it.
		 * This path is also the lost-response retry path, so the row may already exist, and without
		 * knowing it a republish of a public work could not be told apart from a first publish and would
		 * announce a months-old work as new. `undefined` means no row yet and the decision function reads
		 * it as `null`.
		 *
		 * No `FOR UPDATE`: this read is not the correctness basis. The upsert and its unique index end
		 * the publish race, and two concurrent "first" reads are still stopped by the notification
		 * ledger's `unique(recipient, source_key)`.
		 */
		const [before] = await tx
			.select({ visibility: story.visibility })
			.from(story)
			.where(
				and(
					eq(story.owner, viewer.id),
					eq(story.origin_draft_id, request.originDraftId),
				),
			)
			.limit(1);

		const [inserted] = await tx
			.insert(story)
			.values({
				id: candidateId,
				owner: viewer.id,
				title: request.metadata.title,
				description: request.metadata.description,
				/**
				 * The displayed author name is not an editable field here. Copying the creator's nickname would
				 * leave already-published works with the old name after a nickname change, with no visible
				 * place to fix it. Empty means "not shown"; the screen shows the creator's nickname.
				 */
				author: "",
				tags: request.metadata.tags,
				orientation: request.metadata.orientation,
				adult: request.metadata.adult,
				visibility: request.metadata.visibility,
				prompt_protected: request.metadata.promptProtected,
				size_bytes: payloadBytes(payload),
				play_payload: payload,
				origin_draft_id: request.originDraftId,
			})
			.onConflictDoUpdate({
				target: [story.owner, story.origin_draft_id],
				// A partial unique index must be named with its predicate for Postgres to infer it.
				targetWhere: sql`${story.origin_draft_id} is not null`,
				set: {
					title: sql`excluded.title`,
					description: sql`excluded.description`,
					tags: sql`excluded.tags`,
					orientation: sql`excluded.orientation`,
					adult: sql`excluded.adult`,
					visibility: sql`excluded.visibility`,
					prompt_protected: sql`excluded.prompt_protected`,
					size_bytes: sql`excluded.size_bytes`,
					/**
					 * This is what makes `play_payload.storyId === story.id` structurally true. On the conflict
					 * path the surviving row's id differs from the candidate id, so leaving the payload's id would
					 * split them. Re-reading and patching in the app costs a round trip and a crash in between
					 * leaves a mismatched payload.
					 */
					play_payload: sql`jsonb_set(excluded.play_payload, '{storyId}', to_jsonb(${story.id}))`,
					updated_at: sql`now()`,
					/**
					 * What is absent from this `set` matters: `owner`, `created_at`, `hidden` and the counters.
					 * Owner and creation time do not change on publish, hidden is the operator's axis, and
					 * counters are accumulated by viewers (zeroing them would reset popularity on every edit).
					 * Because `hidden` is not named here, republishing a hidden work cannot undo enforcement; the
					 * guarantee is structural, not disciplinary.
					 */
				},
				/**
				 * An archived row is not an update target. The predicate lives in SQL rather than in an
				 * app-side read because an archive could land between that read and this statement and the
				 * publish would revive a work just taken down. The losing request changes nothing and ends with
				 * 0 rows; the reason is re-read below.
				 */
				setWhere: sql`${story.visibility} <> 'archived'`,
			})
			.returning({ id: story.id });

		/**
		 * 0 rows means the conflicting row was archived (see `setWhere`). The reason is rebuilt by
		 * re-reading the state, since the driver result cannot say why nothing changed and folding an
		 * unknown failure into a known reason would leave it unnamed.
		 */
		if (!inserted) {
			const [conflicting] = await tx
				.select({ visibility: story.visibility })
				.from(story)
				.where(
					and(
						eq(story.owner, viewer.id),
						eq(story.origin_draft_id, request.originDraftId),
					),
				)
				.limit(1);
			if (conflicting?.visibility === "archived") rejectArchivedTarget();
			throw new Error("no publish result row");
		}

		/**
		 * Sync with the surviving row's id, not the candidate's: they differ on the conflict path, and
		 * the candidate id would point at a nonexistent work and fail the FK.
		 */
		await syncStorySceneImageReferences(
			tx,
			inserted.id,
			request.play.sceneImages.map((image) => image.assetId),
		);
		/**
		 * The runtime is in the same transaction: a split would commit a work with a new chat snapshot
		 * and old code, which players cannot tell from a healthy one.
		 */
		await applyStoryRuntimePlan(tx, inserted.id, runtime);
		/**
		 * The follower notification commits with the publish; outside, a rollback would leave a "new
		 * work" line in other people's inboxes for a work that does not exist. Both ends of the
		 * transition decide (`publication-notice.ts`): publishing as private or unlisted, or republishing
		 * an already-public work, sends nothing.
		 */
		await notifyFollowersOfNewPublicStory(tx, {
			storyId: inserted.id,
			creatorId: viewer.id,
			before: before?.visibility ?? null,
			after: request.metadata.visibility,
		});
		return inserted;
	});

	/**
	 * Created or updated: compare with the freshly minted id rather than a system-column idiom like
	 * `xmax = 0`. Equal means the INSERT survived; different means an existing row was updated.
	 */
	const created = row.id === candidateId;
	return { created, story: await readBack(row.id, viewer.id) };
}

/**
 * Update a published work: the owner re-publishes their own work from their own draft.
 *
 * There is no partial update. The playback payload is a self-contained snapshot, and swapping part
 * of it would yield new characters with old lore. Publication exports a whole point-in-time work
 * and the API keeps that property.
 */
export async function updatePublishedStory(
	viewer: Viewer,
	storyId: string,
	request: StoryPublishRequest,
	/** The request's signal; a client that leaves ends its compile (`runtime-compile.ts`). */
	signal?: AbortSignal,
): Promise<Story> {
	requirePublishableVisibility(request.metadata);
	requireAdultPublishEligibility(viewer, request.metadata.adult);

	/**
	 * Lookup only to name the failure reason. The UPDATE's WHERE below is the final authority
	 * (ownership can change in between).
	 *
	 * It stands before the compile, not after it. The compile is the most expensive thing this request
	 * can cost and the lookup is one indexed read; in the other order a PUT on any story id, someone
	 * else's included, spent a full compile slot before answering 404. Reading here and compiling
	 * outside the transaction leaves the same window the UPDATE's predicate already closes.
	 */
	const [existing] = await db
		.select({
			owner: story.owner,
			originDraftId: story.origin_draft_id,
			visibility: story.visibility,
		})
		.from(story)
		.where(eq(story.id, storyId))
		.limit(1);

	/**
	 * Someone else's work and a missing work get the same 404; separating them would let this path
	 * undo the existence hiding the detail lookup maintains.
	 */
	if (!existing || existing.owner !== viewer.id)
		throw notFound("Story not found.");

	/**
	 * A different origin is rejected, and this one may be revealed: the caller is already confirmed as
	 * owner and needs to know that another device's draft is trying to overwrite the same work.
	 */
	if (existing.originDraftId !== request.originDraftId)
		throw new ApiError(
			409,
			STORY_PUBLISH_ERROR_CODE.originMismatch,
			"This story was published from another draft.",
		);

	/**
	 * An archived work does not accept updates either, same rule as first publication; leaving this
	 * open would let an update sending `public` skip `Restore` and return to the catalogue.
	 */
	if (existing.visibility === "archived") rejectArchivedTarget();

	await requireOwnSceneImages(viewer.id, request.play);
	/** Same order as first publication otherwise: compile before the DB writes, outside the transaction. */
	const runtime = await planStoryRuntime(request.runtime, viewer.id, signal);

	const payload = buildPlayPayload(storyId, request.metadata, request.play);

	await db.transaction(async (tx) => {
		/**
		 * Re-read the starting visibility inside the transaction. `existing` was read outside it and can
		 * be stale, so it is not the notification basis. No `FOR UPDATE`, for the same reason as first
		 * publication: the UPDATE predicate settles correctness and the ledger's idempotency stops a
		 * duplicate line.
		 */
		const [before] = await tx
			.select({ visibility: story.visibility })
			.from(story)
			.where(eq(story.id, storyId))
			.limit(1);

		const rows = await tx
			.update(story)
			.set({
				title: request.metadata.title,
				description: request.metadata.description,
				tags: request.metadata.tags,
				orientation: request.metadata.orientation,
				adult: request.metadata.adult,
				visibility: request.metadata.visibility,
				prompt_protected: request.metadata.promptProtected,
				size_bytes: payloadBytes(payload),
				play_payload: payload,
				updated_at: new Date(),
			})
			/**
			 * All three conditions are in the WHERE. They were checked above, but if ownership or origin
			 * changes in the gap the update then does not happen; check-only would overwrite someone else's
			 * work in that window.
			 */
			.where(
				and(
					eq(story.id, storyId),
					eq(story.owner, viewer.id),
					eq(story.origin_draft_id, request.originDraftId),
					/**
					 * Same reasoning for archive: it can land after the check above, and the WHERE keeps that
					 * window from reviving a work just taken down.
					 */
					ne(story.visibility, "archived"),
				),
			)
			.returning({ id: story.id });

		/**
		 * 0 rows means one of the four conditions changed in between. If archive is the cause say so
		 * (retrying gives the same result); otherwise ownership is gone and it is the same 404 as a
		 * missing work.
		 */
		if (!rows.length) {
			const [now] = await tx
				.select({ visibility: story.visibility, owner: story.owner })
				.from(story)
				.where(eq(story.id, storyId))
				.limit(1);
			if (now?.owner === viewer.id && now.visibility === "archived")
				rejectArchivedTarget();
			throw notFound("Story not found.");
		}

		/** Reconcile references to their final state in the same transaction (see `publishStory`). */
		await syncStorySceneImageReferences(
			tx,
			storyId,
			request.play.sceneImages.map((image) => image.assetId),
		);
		/**
		 * When the runtime axis was not stated, emit nothing (`preserve`). This is the rollout safety: an
		 * older client that does not know the field sends no `runtime`, and reading that absence as
		 * "turned off" would delete the published runtime on one update.
		 */
		await applyStoryRuntimePlan(tx, storyId, runtime);
		/**
		 * An update can also raise a work to public (`private -> public`), so it passes the same decision
		 * function as first publication and lifecycle transitions; missing one path would silence
		 * notifications for that path alone. Editing an already-public work is the normal case and sends
		 * nothing.
		 */
		await notifyFollowersOfNewPublicStory(tx, {
			storyId,
			creatorId: viewer.id,
			before: before?.visibility ?? null,
			after: request.metadata.visibility,
		});
	});
	return readBack(storyId, viewer.id);
}

/**
 * Re-read the just-written work as a product value. It avoids the gallery gate (`getStory`): that
 * is a viewing boundary and would filter out the owner's own adult work when display is off, giving
 * a 404 right after a successful publish. Authorization is done; only ownership is needed.
 */
async function readBack(storyId: string, ownerId: string): Promise<Story> {
	const found = await getOwnedStory(storyId, ownerId);
	// A missing just-written row is a state we do not understand; surface it rather than invent one.
	if (!found)
		throw new Error(`couldn't read back the published story: ${storyId}`);
	return found;
}
