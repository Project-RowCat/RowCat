import {
	canUseByoProvider,
	canViewAdultContent,
	isChildViewer,
} from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { getRowCatClient } from "#/lib/api.ts";

/**
 * The rules are pure functions in @rowcat/domain (canUseByoProvider, canViewAdultContent); this
 * hook only attaches them to the viewer query so screens do not re-derive them. This is not
 * authorization: the server is the final authority (requireNonChild in apps/api/src/lib/gates.ts),
 * and this only hides actions it would obviously reject. BYO is the exception: generation with a
 * personal API key bypasses our server, so this layer and the storage layer are its only
 * enforcement, and routing it through our server would stop it being BYO. A failed viewer lookup
 * yields null, which the domain functions do not treat as a child, because stripping provider
 * access from every member is worse than a child's limit applying a few seconds late.
 */
export function useViewerCapability(): {
	/** Viewer not read yet. This is distinct from 'guest', so screens draw a placeholder instead. */
	loading: boolean;
	/** Under-14 account. Used only to choose copy, never for access decisions. */
	child: boolean;
	byo: boolean;
	/**
	 * Whether adult content can be viewed, checking both authentication and the display setting. It
	 * lives here for the same reason as the hooks above, since per-screen checks drift and can miss an
	 * axis. While loading it is false, meaning 'not known yet' rather than 'not eligible', so callers
	 * must not fold the two together.
	 */
	adult: boolean;
} {
	const query = useQuery(viewerQueryOptions(getRowCatClient()));
	const viewer = query.data ?? null;
	return {
		loading: query.isPending,
		child: isChildViewer(viewer),
		byo: canUseByoProvider(viewer),
		adult: canViewAdultContent(viewer),
	};
}
