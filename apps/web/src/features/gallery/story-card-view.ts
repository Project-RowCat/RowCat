import type { Orientation, Story } from "@rowcat/domain";
import { deletedCreatorLabel, visibilityBadgeLabel } from "#/lib/i18n/vocab.ts";

/**
 * The shape holding only the values the gallery card actually draws. It narrows the type previously
 * taken as `Story`.
 *
 * The card reads none of id, description, view count, favorite count, play payload, or timestamps,
 * but requiring `Story` would mean an item that is not yet a published work could not be drawn. The
 * editor's preview is exactly that case: a draft has no work id, and inventing one would corrupt
 * the meaning of `Story.id` (the published identity).
 *
 * So the card asks only what to draw. The callers decide where the values come from: the gallery
 * from the server's work, the editor from the saved draft.
 */
export interface StoryCardView {
	title: string;
	/** `null` makes the card draw a placeholder. */
	coverUrl: string | null;
	adult: boolean;
	/**
	 * The word printed on the visibility badge. `null` means no badge (public).
	 *
	 * `visibility` is not carried as-is, because this type only says what to draw. Which state earns a
	 * badge is decided by the domain predicate (storyVisibilityBadgeLabel). If the state were carried,
	 * the card would redo that judgment, and its copy would diverge from the editor's preview.
	 */
	visibilityLabel: string | null;
	/**
	 * Name shown after `by`. The caller decides the display, including the notation for a withdrawn
	 * creator.
	 */
	byline: string;
	orientation: Orientation | null;
	tags: string[];
}

/**
 * Number of tags shown on the card. If all were shown, card height would vary by work and the grid
 * would jitter.
 *
 * The preview must use the same value too. If it differed, a creator would believe a third tag was
 * visible on the card and place an important word there.
 */
export const STORY_CARD_VISIBLE_TAGS = 2;

export const storyCardView = (story: Story): StoryCardView => ({
	title: story.title,
	coverUrl: story.coverUrl,
	adult: story.adult,
	visibilityLabel: visibilityBadgeLabel(story.visibility),
	byline: story.creator?.nickname ?? deletedCreatorLabel(),
	orientation: story.orientation,
	tags: story.tags,
});
