import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Retired address: `/stories/[storyId]/play` now redirects to `/chat/runtime/[storyId]`. It was
 * where the Phase 7 player first stood and may remain in deep links, stack restoration and dev
 * bookmarks, so the route stays, but it is not a second playback surface: drawing here would run
 * the same work differently in two shells. The folder is still not a child of the detail.
 */
export default function RuntimePlayRoute() {
	const { storyId } = useLocalSearchParams<{ storyId?: string | string[] }>();
	const id = Array.isArray(storyId) ? storyId[0] : storyId;

	if (!id) return <Redirect href="/" />;

	return <Redirect href={`/chat/runtime/${encodeURIComponent(id)}`} />;
}
