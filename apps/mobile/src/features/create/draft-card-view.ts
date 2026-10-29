import type { StoryDraft } from "@rowcat/authoring";
import { prepareStoryMetadata } from "@rowcat/authoring";
import { storyVisibilityBadgeLabel } from "@rowcat/domain";
import type { StoryCardView } from "../discover/story-card-view.ts";

/**
 * Draft to the value the discover card draws. It passes through `prepareStoryMetadata`, the same
 * normalization publication uses, so the card shows how the work will look once published; a second
 * normalization would drift.
 *
 * Deliberately not invented:
 * - Story id: drafts have none, and `StoryCardView` has no slot for it.
 * - Empty-title fallback: an empty-looking card is the right signal while publishing is blocked.
 * - Favorite count: the card does not draw it.
 *
 * The badge word follows the domain predicate (`storyVisibilityBadgeLabel`); a hand-written
 * `visibility === "private"` would go blank for `Link only` (unlisted) drafts.
 */
export function draftCardView(
	draft: StoryDraft,
	context: { coverUrl: string | null },
): StoryCardView {
	const metadata = prepareStoryMetadata(draft);
	return {
		title: metadata.title,
		coverUrl: context.coverUrl,
		adult: metadata.adult,
		visibilityLabel: storyVisibilityBadgeLabel(metadata.visibility),
	};
}
