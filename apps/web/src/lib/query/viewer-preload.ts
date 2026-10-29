import type { Viewer } from "@rowcat/domain";
import { personalizationQueryOptions, viewerQueryOptions } from "@rowcat/query";
import type { RowCatClient } from "@rowcat/sdk";
import type { QueryClient } from "@tanstack/react-query";

/**
 * - Best-effort viewer preload for route loaders. The viewer only adds personalization and auth
 *   UI, so a viewer failure must never fail a public page.
 * - Failures are swallowed and return null, but null is never written to the cache. That would
 *   mean 'definitely a guest', and a failure is not that verdict. The query stays in error and
 *   retries in the browser while the screen falls back to guest UI.
 * - Lives in the web app because it is loader wiring; server-state definitions live in
 * @rowcat/query.
 * - No generic safe-query wrapper on purpose: gallery and story queries must keep throwing.
 *   Without main content there is nothing to show, and a story 404 is the server's verdict, which
 *   swallowing would leak.
 */

function reportDegraded(what: string, error: unknown): null {
	console.warn(
		`[viewer-preload] ${what} lookup failed; continuing as guest`,
		error,
	);
	return null;
}

/**
 * Pre-fills the viewer. The return value decides whether personalization may be requested: a
 * guest's personalization request returns an empty list, but the round trip still delays the first
 * screen.
 */
export async function preloadViewer(
	queryClient: QueryClient,
	client: RowCatClient,
): Promise<Viewer | null> {
	try {
		return await queryClient.ensureQueryData(viewerQueryOptions(client));
	} catch (error) {
		return reportDegraded("viewer", error);
	}
}

/**
 * Pre-fills personalization (favorites, follows, blocked ids), and only after the viewer is known.
 * It is best-effort for the same reason as the viewer: missing hearts are a loss the screen can
 * tolerate, so they must not turn the whole list into an error.
 */
export async function preloadPersonalization(
	queryClient: QueryClient,
	client: RowCatClient,
): Promise<void> {
	try {
		await queryClient.ensureQueryData(personalizationQueryOptions(client));
	} catch (error) {
		reportDegraded("personalization", error);
	}
}
