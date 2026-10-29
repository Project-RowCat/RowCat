import { STORY_PLAY_ERROR_CODE, StoryChatSeedDto } from "@rowcat/contracts";
import type { Context } from "hono";
import type { AppEnv } from "../../app.ts";
import { ApiError, notFound } from "../../lib/errors.ts";
import { requireViewer } from "../../lib/gates.ts";
import { getPlayableStoryPayload } from "../../services/story/playback.ts";
import { lookupSelector } from "./access.ts";

/**
 * The playback entitlement gate shared by `/play`, `/playback` and the server-assembled generation
 * of protected stories (`routes/chat.ts`). A second hand-written copy could loosen on one side and
 * send a prompt assembled for a story the viewer cannot see.
 *
 * ```text
 * guest refusal    before the lookup — a missing story and someone else's private one are the same 401
 * entitlement      the creator, or a directly openable story (`services/story/playback.ts`)
 * refusal          the same 404 as a missing story; no reason is given
 * missing payload  awaiting migration — no empty snapshot is invented
 * ```
 *
 * The refusal states no reason: lacking entitlement now means the story is not viewable in the
 * detail either, and any answer other than 404 would detect private, blocked or adult gating.
 */
export async function requirePlayableStory(
	c: Context<AppEnv>,
	storyId: string,
): Promise<{
	storyId: string;
	payload: unknown;
}> {
	const { viewer, selector } = await lookupSelector(c);
	// Before the lookup: reversed, a guest would receive 401 and 404 apart, which detects existence.
	const player = requireViewer(viewer);

	const found = await getPlayableStoryPayload({
		storyId,
		viewerId: player.id,
		adultAllowed: selector.adultAllowed,
		ownAdultAllowed: selector.ownAdultAllowed,
		blocked: selector.blocked,
	});
	if (!found) throw notFound("Story not found.");

	if (found.payload === null)
		throw new ApiError(
			409,
			STORY_PLAY_ERROR_CODE.unavailable,
			"This story can't start a conversation yet.",
		);
	return { storyId, payload: found.payload };
}

/**
 * The stored value is not trusted either: the column is jsonb so the DB enforces no shape, and a
 * bad payload sent as-is would lodge on devices and keep that room from ever opening.
 */
export function parseChatSeed(
	storyId: string,
	payload: unknown,
): StoryChatSeedDto {
	const parsed = StoryChatSeedDto.safeParse(payload);
	if (!parsed.success) {
		// The body stays out of the log (it is a creator prompt); the story id suffices to reproduce.
		console.error(`[stories] play payload contract violation story=${storyId}`);
		throw new ApiError(
			500,
			STORY_PLAY_ERROR_CODE.invalid,
			"Couldn't read the story details.",
		);
	}
	return parsed.data;
}
