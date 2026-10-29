import {
	CreatorStoriesQuery,
	PinnedStoriesResponse,
	PublicProfileDto,
	StoriesPage,
	toCreatorStoriesSearchParams,
} from "@rowcat/contracts";
import type { PublicProfile, Story, StoryPage } from "@rowcat/domain";
import type { RequestOptions, RowCatTransport } from "./client.ts";
import { invalidResponse } from "./errors.ts";

/**
 * Public profile: `/v2/creators/*`.
 *
 * The point of this file is that it is separate from `me`. The two resources handle the same member
 * on opposite axes. `me` is "the requester's own," so there is no place to name a target. Here the
 * data is "public to anyone," so the target arrives as an argument. Merging them would erase that
 * distinction and make it expressible in types to read private values through a public lookup.
 *
 * Profile and stories are split into two functions to follow the contract. A second page of stories
 * would not need the name and bio again, and the two values have different cache lifetimes
 * (@rowcat/query).
 */
export interface CreatorsApi {
	/**
	 * One profile. A nonexistent member and a withdrawn member return the same 404. Telling them apart
	 * would reveal that the id once existed, so a deleted identity could be confirmed from its id
	 * alone.
	 */
	get(creatorId: string, options?: RequestOptions): Promise<PublicProfile>;
	/**
	 * One page of the creator's **published** stories. Returns the same `StoryPage` as discovery, so
	 * cards and previews are reused unchanged. Only one exposure boundary differs, and the server
	 * decides it. The owner's private works are not included.
	 */
	stories(
		creatorId: string,
		input?: CreatorStoriesInput,
		options?: RequestOptions,
	): Promise<StoryPage>;
	/**
	 * The creator's **pinned** stories, in pinned order, filtered to what this viewer can see now.
	 *
	 * They pass through the same exposure boundary as the grid, so they are the same `Story` and
	 * render with the same card. A pin that is hidden or not visible to the viewer comes back as a
	 * missing row, not as a blank slot.
	 */
	pinnedStories(creatorId: string, options?: RequestOptions): Promise<Story[]>;
}

/** List input. Any axis left out is filled by the contract's defaults. */
export type CreatorStoriesInput = Partial<CreatorStoriesQuery>;

/** If the id contains `/` or `?`, the path breaks. Encode it before appending. */
const creatorPath = (creatorId: string) =>
	`/creators/${encodeURIComponent(creatorId)}`;

export function createCreatorsApi({
	requestJson,
}: RowCatTransport): CreatorsApi {
	return {
		async get(creatorId, options) {
			const json = await requestJson({
				method: "GET",
				path: creatorPath(creatorId),
				signal: options?.signal,
			});
			/**
			 * Validation matters most here. If the server accidentally leaked a whole member row (email,
			 * adult gate, membership status), the schema drops fields outside the contract. Skipping
			 * validation would leave those values in the cache and devtools, where they would need tracing
			 * rather than wiping. The server's allowlist and this validation guard the same boundary from
			 * both sides.
			 */
			const parsed = PublicProfileDto.safeParse(json);
			if (!parsed.success) throw invalidResponse("/creators/:id");
			// The contract and the domain `PublicProfile` have 1:1 fields today, so no pass-through mapper
			// is kept. If they diverge, the compile error appears at this return.
			return parsed.data;
		},

		async pinnedStories(creatorId, options) {
			const json = await requestJson({
				method: "GET",
				path: `${creatorPath(creatorId)}/pinned-stories`,
				signal: options?.signal,
			});
			const parsed = PinnedStoriesResponse.safeParse(json);
			if (!parsed.success)
				throw invalidResponse("/creators/:id/pinned-stories");
			return parsed.data.items;
		},

		async stories(creatorId, input = {}, options) {
			// Validates the input through the contract as well. The serialization rule (omitting defaults)
			// assumes normalized values; without this, the same query could go out under two different URLs.
			const query = CreatorStoriesQuery.parse(input);
			const json = await requestJson({
				method: "GET",
				path: `${creatorPath(creatorId)}/stories`,
				search: toCreatorStoriesSearchParams(query),
				signal: options?.signal,
			});
			const parsed = StoriesPage.safeParse(json);
			if (!parsed.success) throw invalidResponse("/creators/:id/stories");
			return parsed.data;
		},
	};
}
