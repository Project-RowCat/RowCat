import { FavoriteStateDto, SetFavoriteRequest } from "@rowcat/contracts";
import type { FavoriteState } from "@rowcat/domain";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

export interface FavoritesApi {
	/**
	 * Sets the favorite flag to the desired final state. There is no toggle() because flipping depends
	 * on the state at call time, so a retry would change the result. The screen already knows the
	 * current state, so sending the target value converges to the same place however many times it is
	 * sent.
	 */
	set(
		storyId: string,
		favorited: boolean,
		options?: RequestOptions,
	): Promise<FavoriteState>;
}

export function createFavoritesApi({
	requestJson,
}: RowCatTransport): FavoritesApi {
	return {
		async set(storyId, favorited, options) {
			const json = await requestJson({
				method: "PUT",
				// Encode the id before building the path. A `/` or `?` in the id would otherwise break the
				// whole path.
				path: `/favorites/${encodeURIComponent(storyId)}`,
				// Builds the body with the schema the server reads, so both sides share one contract.
				body: SetFavoriteRequest.parse({ favorited }),
				signal: options?.signal,
			});
			/**
			 * Does not trust a 200 blindly. This response corrects the optimistic update, so a malformed
			 * body would silently lock the heart and total count on screen to wrong values.
			 */
			const parsed = FavoriteStateDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/favorites/:storyId");
			return parsed.data;
		},
	};
}
