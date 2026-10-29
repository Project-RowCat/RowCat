import { Badge } from "@rowcat/ui-web/components/badge";
import { CardContent } from "@rowcat/ui-web/components/card";
import { ImageOff } from "lucide-react";
import { adultBadge, orientationLabel } from "#/lib/i18n/vocab.ts";
import {
	STORY_CARD_VISIBLE_TAGS,
	type StoryCardView,
} from "./story-card-view.ts";

/**
 * The card's content: cover, badge, title, byline, tags. This component has no outer box, and that
 * is its whole job.
 *
 * The gallery wraps it in a `<button>` (pressing opens the preview) and gets its hover signal from
 * there. The editor's preview wraps it in a plain `<div>`, because there is nothing to press: that
 * card is a picture, not a control.
 *
 * The two are not split by a condition inside one component, because what differs is the element
 * type. Folding that through an `as` or `interactive` boolean would eventually make the preview a
 * button that can be pressed and does nothing.
 *
 * They are also not drawn separately. If the preview drew its own card, then when the gallery added
 * tags or changed title lines the preview would lie, and a creator would learn only after
 * publishing that a word they believed visible was truncated.
 *
 * The hover classes (group-hover:*) stay in place. They do nothing without a `group` parent, so the
 * preview needs nothing removed.
 */
export function StoryCardBody({ view }: { view: StoryCardView }) {
	return (
		<>
			<div className="relative aspect-3/4 w-full overflow-hidden bg-muted">
				{view.coverUrl ? (
					/*
					 * The cover's alt text is empty. The title directly below fills the name within the same box,
					 * so repeating it on the cover would make screen readers read the same words twice. Decorative
					 * is correct here.
					 */
					<img
						src={view.coverUrl}
						alt=""
						referrerPolicy="no-referrer"
						loading="lazy"
						decoding="async"
						/*
						 * On hover only the cover moves. The box is overflow-hidden, so the 2% overflow is clipped
						 * and the card's geometry and the grid do not change by a pixel. This is the same axis as the
						 * rule that whole cards are not enlarged.
						 *
						 * Only scale and opacity change. Changing width, height, or margin recalculates layout every
						 * frame, and if 24 cards did that together the grid would be pressed during scrolling.
						 *
						 * The transition list is `scale` deliberately, not a typo: Tailwind v4's `scale-*` uses the
						 * standalone `scale` property, not `transform`. In the current version (4.3.3),
						 * `transition-transform` covers those standalone properties but still not opacity, so the
						 * explicit list of the two properties that actually move stays. Relying on the broad utility
						 * made the covered range differ between versions; that history is the point of this comment.
						 */
						className="size-full object-cover transition-[scale,opacity] group-hover:scale-[1.02] group-hover:opacity-90"
					/>
				) : (
					/*
					 * Without a cover, a plain `<img>` would show the browser's broken-image icon. The space is
					 * the same either way, so a deliberate placeholder is drawn (the title says what it is).
					 *
					 * This area stays still on hover too. Enlarging is the answer to 'show the picture bigger';
					 * with no picture, the same motion would make an icon grow for no reason.
					 */
					<div
						aria-hidden="true"
						className="flex size-full items-center justify-center bg-linear-to-br from-muted to-muted/30 text-muted-foreground/60"
					>
						<ImageOff className="size-7" />
					</div>
				)}

				<div className="absolute inset-x-2 top-2 flex flex-wrap gap-1">
					{view.adult && <Badge variant="destructive">{adultBadge()}</Badge>}
					{view.visibilityLabel && (
						<Badge variant="secondary">{view.visibilityLabel}</Badge>
					)}
				</div>
			</div>

			<CardContent className="gap-1 pt-3">
				{/*
				 * The strongest text at the bottom of the card. `tracking-tight` slightly raises the density of
				 * titles that clip at two lines;
				 * the line count (`line-clamp-2`) and the hover underline stay as they are.
				 */}
				<h3 className="line-clamp-2 text-sm leading-snug font-semibold tracking-tight decoration-1 underline-offset-2 group-hover:underline">
					{view.title}
				</h3>
				{/*
				 * Same byline as the detail page and the preview: if the name differed between the list and the
				 * opened work, the user might
				 * suspect they were different works. The author name as written on the work lives in the detail
				 * metadata.
				 */}
				<p className="truncate text-xs text-muted-foreground">
					by {view.byline}
				</p>
				{/*
				 * Two different kinds stand on this line. The orientation label is a classification, so it stays a
				 * badge (the same vocabulary
				 * as status badges). `#tags` are words the creator attached, so they drop to metadata text. With
				 * both as badges, the tags looked
				 * as heavy as the orientation, and the tag row, not the title, was the most eye-catching thing on
				 * the card.
				 *
				 * The height stays 20px (leading-5, the badge's h-5). If only cards without an orientation had a
				 * shorter line, the heart's
				 * position would differ from card to card and the grid would look uneven.
				 *
				 * Long tags are truncated (`max-w-28 truncate`). Without that, one word would take a whole line and
				 * push the second tag down.
				 */}
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
					{view.orientation && (
						<Badge variant="outline">
							{orientationLabel(view.orientation)}
						</Badge>
					)}
					{view.tags.slice(0, STORY_CARD_VISIBLE_TAGS).map((tag) => (
						<span
							key={tag}
							className="max-w-28 truncate text-xs leading-5 text-muted-foreground"
						>
							#{tag}
						</span>
					))}
				</div>
			</CardContent>
		</>
	);
}
