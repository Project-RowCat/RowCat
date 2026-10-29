import { useLiveQuery } from "dexie-react-hooks";
import type { DomainScope } from "#/lib/local-data/domain-scope.ts";
import { useDomainScope } from "#/lib/local-data/domain-scope.ts";
import type { StagedDraftCover } from "./draft-cover.ts";

/**
 * Subscribes to the pre-publish cover: a second window on the same database as the draft store.
 *
 * The adapter-only approach, without setting up a new scope, follows this repo's convention
 * (local-authoring/scope.ts, local-generation/scope.ts). Lifecycle and account isolation belong to
 * local-data. What remains here is the boundary that the cover slot reads only the cover store.
 *
 * liveQuery is used for the same reason. If another tab changes the cover of the same draft or
 * deletes the draft, this subscription updates itself, with no separate code announcing the change.
 * It also means the screen sees immediately when publishing uploads the cover to the server and
 * deletes this row.
 */
export type DraftCoverScope = DomainScope<"draftCover">;

export const useDraftCoverScope = (): DraftCoverScope =>
	useDomainScope("draftCover");

export interface StagedCoverState {
	cover: StagedDraftCover | null;
	/**
	 * The first result has not arrived yet. This is different from 'no cover'. Merging the two would
	 * flash `No cover yet` each time the editor opens, and a user who had picked a cover would read it
	 * as their selection having disappeared.
	 */
	loading: boolean;
}

export function useStagedDraftCover(draftId: string): StagedCoverState {
	const { store, status } = useDraftCoverScope();
	const cover = useLiveQuery(
		() => (store ? store.get(draftId) : Promise.resolve(undefined)),
		[store, draftId],
	);
	return {
		cover: cover ?? null,
		loading: status !== "ready" || cover === undefined,
	};
}
