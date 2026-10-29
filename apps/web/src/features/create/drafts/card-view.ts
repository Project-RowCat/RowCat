import type { StoryDraft } from "@rowcat/authoring";
import { prepareStoryMetadata } from "@rowcat/authoring";
import type { Viewer } from "@rowcat/domain";
import type { StoryCardView } from "#/features/gallery/story-card-view.ts";
import { visibilityBadgeLabel } from "#/lib/i18n/vocab.ts";

/**
 * Draft to the value the gallery card will draw. This function's whole job is passing through
 * `prepareStoryMetadata` (@rowcat/authoring). That is the exact normalization publishing uses, so
 * the card produced here can truthfully claim 'it will look like this when published'. Title
 * trimming and tag deduplication or empty-tag removal follow publishing's rules. Do not write a
 * second normalization. If `title.trim()` were written again here, one side would be fixed later
 * and the other not. The mismatch would show up as a preview card that differs from the card that
 * actually ships, which creators would only discover after publishing. Deliberately not invented
 * here:
 * - A work id. Drafts do not have one, and `StoryCardView` has no slot for it.
 * - Replacement copy for an empty title. `Untitled` is the draft list's vocabulary
 *   (`draftDisplayTitle`), and the gallery never draws that word. Filling it here would make the
 *   preview look fine, while a creator who tries to publish without a title is blocked only at the
 *   publish button. A blank card is the correct signal.
 * - Favorite or view counts. The card does not draw them, so they are not in this shape.
 */

/**
 * The name for the byline on the card. The gallery shows the **creator account's nickname**
 * (`creatorLabel`), not the author name written on the work, so the preview uses the logged-in
 * member's nickname too. If the viewer has not been read yet, no name is invented; the slot stays
 * blank. A brief blank is more honest than drawing a name that does not exist.
 */
const bylineFor = (viewer: Viewer | null): string => viewer?.nickname ?? "";

export function draftCardView(
	draft: StoryDraft,
	context: { coverUrl: string | null; viewer: Viewer | null },
): StoryCardView {
	const metadata = prepareStoryMetadata(draft);
	return {
		title: metadata.title,
		coverUrl: context.coverUrl,
		adult: metadata.adult,
		/**
		 * The badge rule **follows the domain predicate directly** (`storyVisibilityBadgeLabel`, which
		 * the gallery card calls too). The point is that the rule is not set here. The card claims 'it
		 * will look like this when published', and if the badge words diverged from the gallery, that
		 * claim would be false. For a while `metadata.visibility === "private"` was hand-written here.
		 * Once there were four states, that copy would have silently gone blank for `Link only` works, in the
		 * preview only.
		 */
		visibilityLabel: visibilityBadgeLabel(metadata.visibility),
		byline: bylineFor(context.viewer),
		orientation: metadata.orientation,
		tags: metadata.tags,
	};
}
