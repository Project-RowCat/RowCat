import { type Story, storyVisibilityBadgeLabel } from "@rowcat/domain";

/**
 * Shape carrying **only the values the discover grid card actually draws.**
 *
 * It narrows the type that used to be taken whole as `Story`. The card reads none of the id,
 * description, view count, favorite count, playback payload or timestamps. Requiring that type
 * would make it impossible to draw a card for something that is **not yet a story**, which is
 * exactly the editor's preview case. A draft has no story id, and inventing one would pollute the
 * meaning of `Story.id` (the published identity).
 *
 * Same place and same reason as the web's `features/gallery/story-card-view.ts`.
 *
 * ## Narrower than the web's shape, because this app's card is narrower
 *
 * ```text
 * web    cover · badge · title · byline · orientation badge · two tags   ← has `byline`, `orientation`, `tags`
 * here   cover · badge · title · byline · heart                          ← does not draw orientation or tags
 * ```
 *
 * So this type has neither `orientation` nor `tags`. Not reserving them to match the web is the
 * point. This shape's contract is "what **this app's** card draws", and carrying an axis it does
 * not draw would let the preview read it as a value it may draw. When the card starts drawing tags,
 * this type and the preview grow **together**.
 *
 * The byline and the heart are absent for a different reason. They are not values but
 * **operations** (a button to the creator's profile, a favorite toggle), so they arrive as nodes.
 * They are arguments of `StoryCardBody`.
 */
export interface StoryCardView {
	title: string;
	/** Without it, the card draws a placeholder. */
	coverUrl: string | null;
	adult: boolean;
	/**
	 * Word printed on the visibility badge. `null` means no badge is drawn (public).
	 *
	 * `visibility` itself is not carried, by design. The card asks only "what should be drawn". Which
	 * state earns a badge is decided by a domain predicate (`storyVisibilityBadgeLabel`, which the web
	 * card also calls). Carrying the state would make the card redo that judgment, and that copy would
	 * drift from the editor's preview.
	 */
	visibilityLabel: string | null;
}

/** Server-provided story → the values the card reads. */
export const storyCardView = (story: Story): StoryCardView => ({
	title: story.title,
	coverUrl: story.coverUrl,
	adult: story.adult,
	visibilityLabel: storyVisibilityBadgeLabel(story.visibility),
});
