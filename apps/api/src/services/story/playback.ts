import {
	and,
	eq,
	inArray,
	isNull,
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "../../db/client.ts";
import { story } from "../../db/schema.ts";

/**
 * Playback entitlement: may this viewer receive this story's playback snapshot.
 *
 * Two entitlements exist:
 * - creator: `story.owner = viewer`, regardless of visibility.
 * - reader: public or unlisted + adult gate + blocks; whoever can open the detail can play.
 *
 * Paid ownership once made these differ (`docs/oss/PLAN.md` stage 3 removed it), so they now give
 * the same answer. The decision still lives in this one predicate: `/play`, `/playback`, the
 * server-assembled generation of protected stories and play-start telemetry all go through it, and
 * a caller deciding separately from the detail selector would let the rules diverge.
 *
 * The reader axes match the detail's:
 * - Visibility is an allowlist (same as `isStoryDirectlyViewable`), never `<> 'archived'`: a new
 *   vocabulary value would fall on the passing side.
 * - The adult gate is `canViewAdult` (includes the display opt-in). Only the creator looks at
 *   `isAdultVerified`, so a verified member with display off does not publish their own adult story
 *   and then get a 404 on playback (`ownAdultAllowed` in `routes/stories/access.ts`).
 * - Stories by blocked members stay closed. Ownerless stories (`owner IS NULL`, from account
 *   deletion) stay open regardless of blocks: `NOT IN` with NULL yields NULL, which would hide them
 *   from everyone holding a block list.
 * - Operator hiding is closed even to the creator.
 *
 * Guests can be neither, so `viewerId` is required. The route rejects unauthenticated requests
 * before calling here (a missing story and someone else's private story must give a guest the same
 * 401). Entitlement is re-decided every time, so losing adult eligibility closes playback.
 */

export interface PlaybackAccessInput {
	storyId: string;
	/** Session-resolved member only; required so a guest is not representable. */
	viewerId: string;
	/** `canViewAdult(viewer)`: the reader axis, including the display opt-in. */
	adultAllowed: boolean;
	/** `isAdultVerified(viewer)`: the creator's axis on their own story (legal requirement only). */
	ownAdultAllowed: boolean;
	blocked: string[];
}

/**
 * Shared by the payload read and the entitlement-only check. Written twice, one would loosen
 * eventually: telemetry could rank stories nobody may see, playback could leak a private
 * manuscript.
 */
function playbackWhere(input: PlaybackAccessInput): SQL {
	const { storyId, viewerId, adultAllowed, ownAdultAllowed, blocked } = input;

	const asCreator = and(
		eq(story.owner, viewerId),
		ownAdultAllowed ? undefined : eq(story.adult, false),
	);

	const asReader = and(
		inArray(story.visibility, ["public", "unlisted"]),
		adultAllowed ? undefined : eq(story.adult, false),
		blocked.length
			? or(isNull(story.owner), notInArray(story.owner, blocked))
			: undefined,
	);

	return and(
		eq(story.id, storyId),
		// Operator and legal removal close even to the creator.
		eq(story.hidden, false),
		or(asCreator, asReader),
	) as SQL;
}

/**
 * Raw playback payload, only for entitled viewers.
 *
 * Three outcomes: `null` when not entitled or gated, `{ payload: null }` when entitled but the
 * payload is not ready (awaiting migration). Merging them would make "unusable story" and "not
 * ready yet" the same response, and the creator could not tell why theirs fails. The value is
 * `unknown`; contract validation belongs to the route.
 */
export async function getPlayableStoryPayload(
	input: PlaybackAccessInput,
): Promise<{ payload: unknown } | null> {
	const [row] = await db
		.select({ payload: story.play_payload })
		.from(story)
		.where(playbackWhere(input))
		.limit(1);
	return row ? { payload: row.payload } : null;
}

/**
 * Entitlement only, without reading the payload. Telemetry calls it
 * (`services/story/telemetry.ts`); pulling the jsonb body each time would read TOAST.
 */
export async function hasPlaybackEntitlement(
	input: PlaybackAccessInput,
): Promise<boolean> {
	const [row] = await db
		.select({ x: sql<number>`1` })
		.from(story)
		.where(playbackWhere(input))
		.limit(1);
	return row !== undefined;
}
