import type { StoryPlayKind } from "@rowcat/contracts";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { story, story_play_log, story_play_starter } from "../../db/schema.ts";
import { hasPlaybackEntitlement } from "./playback.ts";

/**
 * Play-start recording: the first and currently only product telemetry event.
 *
 * Not an event bus, queue or analytics SaaS: one event is one row (`story_play_log`) and one
 * derived value is the work's counter (`story.play_starts`), the same shape views already use
 * (`recordView` in `services/social.ts`). Building an "event model" before a second event exists
 * would pile up rows nobody reads.
 *
 * One request pushes two ledgers because their units differ:
 *
 * ```text
 * story_play_log      (story, session key)   event    creator analytics' `playStarts`
 * story_play_starter  (story, member)        person   popular ranking's engagement signal
 * ```
 *
 * The session key means different things per playback mode (a local room id for chat, the library
 * row identity for runtime). Each is right for its mode; the mistake was adding them in one ranking
 * formula, so people are counted separately and the telemetry meaning is unchanged.
 *
 * The server does not trust the report in three places:
 * - Entitlement uses the same predicate as playback (`services/story/playback.ts`). No
 *   entitlement returns `null`, which the route folds into the same 404 as a missing work; telling
 *   them apart would make this endpoint an existence probe.
 * - The owner's own play is not counted, the same rule as views.
 * - Replays hit the `(story, session key)` primary key: no second row and no counter increment.
 *
 * Counters rise only when a row was actually inserted (`rowCount` of `onConflictDoNothing`), and
 * row and counter share a transaction because a drift between them never heals.
 */

export interface RecordPlayStartInput {
	storyId: string;
	/** Only the member resolved from the session; there is no slot for this in the body, query or headers. */
	viewerId: string;
	/** `canViewAdult(viewer)`: the axis for viewing. */
	adultAllowed: boolean;
	/** `isAdultVerified(viewer)`: the axis for a creator's own work. */
	ownAdultAllowed: boolean;
	/** Members this viewer blocked; no entitlement exists for a blocked creator's work. */
	blocked: string[];
	sessionKey: string;
	kind: StoryPlayKind;
}

export type RecordPlayStartOutcome =
	/** No entitlement or no such work; the route folds it into a 404. */
	null | { recorded: boolean };

export async function recordStoryPlayStart(
	input: RecordPlayStartInput,
): Promise<RecordPlayStartOutcome> {
	const { storyId, viewerId } = input;

	const entitled = await hasPlaybackEntitlement({
		storyId,
		viewerId,
		adultAllowed: input.adultAllowed,
		ownAdultAllowed: input.ownAdultAllowed,
		blocked: input.blocked,
	});
	if (!entitled) return null;

	return db.transaction(async (tx) => {
		const [target] = await tx
			.select({ owner: story.owner })
			.from(story)
			.where(eq(story.id, storyId))
			.limit(1);
		/** A work deleted between the entitlement check and this read counts as missing. */
		if (!target) return null;
		/**
		 * The owner's own play is not counted. They are entitled, so this is `recorded: false` rather
		 * than a 404; opening your own work is a normal path, not an error.
		 */
		if (target.owner === viewerId) return { recorded: false };

		const inserted = await tx
			.insert(story_play_log)
			.values({
				story_id: storyId,
				member_id: viewerId,
				session_key: input.sessionKey,
				kind: input.kind,
			})
			.onConflictDoNothing();
		if (!inserted.rowCount) return { recorded: false };

		/**
		 * Touch the people ledger only after the event row really landed. Replays ended above, so this is
		 * a new session, and only this person's first one makes the INSERT below 1 row. The decision is
		 * not a SELECT because two concurrent requests from one person would both read empty; the unique
		 * index is the final authority.
		 */
		const starter = await tx
			.insert(story_play_starter)
			.values({ story_id: storyId, member_id: viewerId })
			.onConflictDoNothing({
				target: [story_play_starter.story_id, story_play_starter.member_id],
				/**
				 * The index is partial, so Postgres picks it as arbiter only if the predicate matches (`where`
				 * of `onConflictDoNothing` goes here, not in `SET`).
				 */
				where: sql`${story_play_starter.member_id} is not null`,
			});

		/**
		 * Push both counters in one statement; split, "event rose but person did not" becomes
		 * representable and never heals.
		 */
		await tx
			.update(story)
			.set(
				starter.rowCount
					? {
							play_starts: sql`${story.play_starts} + 1`,
							unique_play_starters: sql`${story.unique_play_starters} + 1`,
						}
					: { play_starts: sql`${story.play_starts} + 1` },
			)
			.where(eq(story.id, storyId));
		return { recorded: true };
	});
}
