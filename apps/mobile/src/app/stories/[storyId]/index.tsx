import { Redirect, useLocalSearchParams } from "expo-router";
import { StoryDetailScreen } from "../../../features/story/story-detail-screen.tsx";

/**
 * Story detail: the address carries identity. No shadow state like `selectedStoryId`; with the
 * route parameter as the source, deep links, back and stack restoration follow for free. The story
 * object is not a parameter either (direct entry has none, and a copy goes stale as the cache
 * changes).
 */
export default function StoryRoute() {
	const { storyId } = useLocalSearchParams<{ storyId?: string | string[] }>();
	/** A repeated key arrives as an array (hand-edited deep link); use the first value. */
	const id = Array.isArray(storyId) ? storyId[0] : storyId;

	/**
	 * An address with no id should not reach this route; if it does it is not a story. Go back to
	 * discovery instead of sending a query that returns 404, since "not found" is the server's verdict
	 * and here we cannot even build the request.
	 */
	if (!id) return <Redirect href="/" />;

	return <StoryDetailScreen storyId={id} />;
}
