import {
	BlockStateDto,
	FollowStateDto,
	SetBlockRequest,
	SetFollowRequest,
} from "@rowcat/contracts";
import type { BlockState, FollowState } from "@rowcat/domain";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/**
 * Relations between people: follow and block.
 *
 * Kept apart from favorites because the target differs. Favorites attach to a story (the path
 * carries the story id), while this attaches to a member (the target is in the body). Merging would
 * leave 'relation to what' only in the function names, and blur where the cache policy diverges
 * (@rowcat/query).
 *
 * No function takes a subject. The follower or blocker is always the requester, and that identity
 * comes only from the session cookie. The contract has no slot for it (`SetFollowRequest`), so
 * creating a relation under someone else's name is impossible at the type level.
 *
 * There is no toggle, for the same reason as favorites. A toggle depends on the state at call time,
 * so retries would change the result. The screen already knows the current state.
 */
export interface SocialApi {
	/**
	 * Sets follow to a target state: the caller sends the desired final state.
	 *
	 * The response carries the confirmed state and the creator's public follower total. That total is
	 * the basis for correcting an optimistic ±1. Without it the screen would keep its own added number
	 * as the truth.
	 *
	 * All rejections (self-follow, missing member, blocked counterpart) are decided by the server.
	 * They are not filtered here, because that decision depends on state this device may not know: the
	 * personalized cache may be stale. A client-side check is not authorization anyway.
	 */
	setFollow(
		creatorId: string,
		following: boolean,
		options?: RequestOptions,
	): Promise<FollowState>;

	/**
	 * Sets the block state. Blocking breaks existing follows in the same server transaction, so this
	 * response also carries the follower total.
	 *
	 * If the screen guessed whether it was following and applied ±1, the number would drift the moment
	 * the guess was wrong. Unblocking does not restore a follow. Following again is an explicit
	 * action.
	 */
	setBlock(
		creatorId: string,
		blocked: boolean,
		options?: RequestOptions,
	): Promise<BlockState>;
}

export function createSocialApi({ requestJson }: RowCatTransport): SocialApi {
	return {
		async setFollow(creatorId, following, options) {
			const json = await requestJson({
				method: "PUT",
				path: "/follows",
				// Builds the body with the same schema the server reads, so both sides share one contract.
				body: SetFollowRequest.parse({ creator: creatorId, following }),
				signal: options?.signal,
			});
			/**
			 * Does not trust a 200 blindly. This response corrects an optimistic update. If a mismatched
			 * shape passed, the screen's follow state and follower count would silently freeze at wrong
			 * values.
			 */
			const parsed = FollowStateDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/follows");
			return parsed.data;
		},

		async setBlock(creatorId, blocked, options) {
			const json = await requestJson({
				method: "PUT",
				path: "/blocks",
				body: SetBlockRequest.parse({ creator: creatorId, blocked }),
				signal: options?.signal,
			});
			const parsed = BlockStateDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/blocks");
			return parsed.data;
		},
	};
}
