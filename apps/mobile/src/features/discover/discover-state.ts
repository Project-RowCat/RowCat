import { type GalleryFilters, hasActiveFilters } from "@rowcat/domain";
import { formatCount } from "../../lib/format.ts";
import type { MobileLocalScopeStatus } from "../../lib/local-data/activation.ts";
import type { SessionPhase } from "../../lib/session-state.ts";

/**
 * What the discover screen draws now, and which inputs the decision does not read.
 *
 * Reading public stories must not hang on Better Auth or SQLite. An unanswered or unreachable `/me`
 * (not a sign-out), and an opening or failed SQLite, all leave the public gallery as is. That
 * independence exists in no code path, so the two axes are accepted as inputs but never read.
 * `discover-state.test.ts` walks the full 4x4 matrix and breaks first if someone starts reading
 * them. `lib/boundaries.test.ts` backs it by stopping the screen from splitting the public surface
 * on `useMobileAppPhase`.
 */

/** Current `/me` and SQLite state. Not used by the decision below. */
export interface PublicSurfaceContext {
	session: SessionPhase;
	localScope: MobileLocalScopeStatus;
}

/**
 * Only the gallery-query axes this decision looks at. `UseInfiniteQueryResult` is not taken
 * directly, as in `session-state.ts`: the signature pins purity and the decision's inputs.
 */
export interface GallerySnapshot {
	status: "pending" | "success" | "error";
	/**
	 * Retries are paused because the network is judged absent (`fetchStatus === "paused"`). `status`
	 * stays `pending` then, so without this flag offline users see an endless placeholder. The web's
	 * `Published` section hit the same defect first.
	 */
	paused: boolean;
	/** Story count after flattening the accumulated pages. */
	storyCount: number;
}

export interface DiscoverStateInputs {
	/** Identity and device storage. Not read; accepted so the test can verify that. */
	context: PublicSurfaceContext;
	gallery: GallerySnapshot;
	filters: GalleryFilters;
	/**
	 * Personalization confirmed that the member follows nobody. Unknown is `false`. Drawing unknown as
	 * "none" would tell someone who follows many `You don't follow any creators`, then flip.
	 */
	followsNobody: boolean;
}

/**
 * ```text
 * loading   first fetch still running
 * offline   retries paused for lack of network (no endless placeholder)
 * failed    fetch ended in error; not a sign-out
 * empty     server answered zero (filtered says why)
 * stories   draw the list
 * ```
 */
export type DiscoverState =
	| { kind: "loading" }
	| { kind: "offline" }
	| { kind: "failed" }
	| { kind: "empty"; filtered: boolean; followsNobody: boolean }
	| { kind: "stories" };

export function resolveDiscoverState(
	inputs: DiscoverStateInputs,
): DiscoverState {
	const { gallery, filters } = inputs;

	// Success first: if a background refresh fails but a list is held, draw it (Query keeps
	// `success`).
	if (gallery.status === "success")
		return gallery.storyCount > 0
			? { kind: "stories" }
			: {
					kind: "empty",
					// "Nothing matches" and "nothing yet" call for different next actions. The domain decides
					// (`hasActiveFilters`); counting axes here would go stale when axes are added.
					filtered: hasActiveFilters(filters),
					// An empty following feed with nobody followed is a third branch: the fix is following
					// creators, not loosening filters.
					followsNobody: filters.followingOnly && inputs.followsNobody,
				};

	if (gallery.status === "error") return { kind: "failed" };
	return gallery.paused ? { kind: "offline" } : { kind: "loading" };
}

/**
 * The toolbar total line. No text while the value is unknown.
 *
 * The screen once passed `0` before the server answered, which drew `0 stories` as fact. `0` means only
 * "the server answered and nothing matched". Unknown is not 0, and drawing both alike makes someone
 * who just changed a filter read it as everything filtered out. `null` is the unknown (a sentinel
 * like `-1` or `0` would eventually enter arithmetic). Counts are never abbreviated
 * (`formatCount`).
 */
export const discoverTotalLabel = (total: number | null): string | null =>
	total === null
		? null
		: `${formatCount(total)} ${total === 1 ? "story" : "stories"}`;
