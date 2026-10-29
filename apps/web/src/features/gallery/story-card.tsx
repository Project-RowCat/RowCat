import type { Story, Viewer } from "@rowcat/domain";
import { Card, CardContent } from "@rowcat/ui-web/components/card";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { FavoriteControl } from "#/features/social/favorite-control.tsx";
import { enterTransition } from "#/lib/motion/transitions.ts";
import { StoryCardBody } from "./story-card-body.tsx";
import { storyCardView } from "./story-card-view.ts";

/**
 * The 6px move and opacity-only fade are deliberate. The motion should say 'just arrived', not
 * 'look here'. A larger upward move makes the whole grid jump on every filter change, which hurts
 * reading the results.
 *
 * Cards on first render never reach this state: the gallery's `AnimatePresence initial={false}`
 * gives them `animate` (the final values) directly. This keeps opacity 0 out of the server HTML;
 * otherwise the page would be blank until JavaScript loads.
 */
const CARD_ENTER = {
	initial: { opacity: 0, y: 6 },
	animate: { opacity: 1, y: 0 },
};

/**
 * Shows only what a reader needs to choose a work. The detail screen is not condensed here: adding
 * descriptions or view counts would fit fewer works on screen and make discovery harder. The
 * favorite toggle is the one exception, because it is an action taken while browsing.
 *
 * The card opens a preview instead of navigating, so it is a button, not a link. An `<a>` would
 * promise new-tab and copy-address behavior the element cannot keep. The real link to the detail
 * page lives inside the preview.
 *
 * The heart sits outside the button to avoid nesting interactive elements. A button inside a button
 * is invalid markup, and browsers disagree on which one receives the click. A `<div onClick>`
 * imitation is worse: it drops keyboard movement and focus.
 */
export function StoryCard({
	story,
	favorited,
	viewer,
	onPreview,
}: {
	story: Story;
	/**
	 * Membership ('favorited') comes from `/me/state`, not from the story object. It is
	 * viewer-specific state.
	 */
	favorited: boolean;
	viewer: Viewer | null;
	onPreview: () => void;
}) {
	const { t } = useTranslation("gallery");
	return (
		/*
		 * The element stays a semantic `<article>`; Motion does not change the rendered tag. For the same
		 * reason no wrapper div is added around the card: a div used only for motion adds no meaning to
		 * the markup and just nests the grid child one level deeper.
		 */
		<m.article
			initial={CARD_ENTER.initial}
			animate={CARD_ENTER.animate}
			transition={enterTransition}
		>
			{/*
			 * Hover and keyboard focus answer with one shadow step (`shadow-xs` to `shadow-sm`).
			 * Geometry does not move at all. If cards grew or lifted, the other cards in the grid would
			 * recalculate their positions, and with 24 cards reacting together the list would jitter.
			 *
			 * Focus is read with `has-[:focus-visible]` because two elements inside the card take
			 * focus: the preview button and the heart. Attaching the rule only to the inner button
			 * would leave the card silent for someone who tabbed to the heart.
			 *
			 * This styling belongs to the gallery card, not the shared `Card` primitive. Changing the
			 * primitive would make every card in settings and account react to hover too.
			 */}
			<Card
				size="sm"
				className="h-full gap-0 py-0 transition-shadow hover:shadow-sm has-[:focus-visible]:shadow-sm"
			>
				{/*
				 * `group` is a hover signal scoped to this button only. Pressing the card does not change
				 * the URL (the preview opens), so it has fewer affordances than a link. The cover darkens
				 * slightly and the title underlines to show that the card is pressable.
				 *
				 * The card itself is not scaled. If 24 cards grew and shrank independently, the grid would
				 * shift while being scanned. Hover and focus therefore change only the shadow (see the
				 * `Card` styling comment).
				 */}
				<button
					type="button"
					onClick={onPreview}
					className="group block w-full cursor-pointer rounded-t-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					{/*
					 * The card body is shared by the gallery and the editor preview (`story-card-body.tsx`).
					 * What remains here is specific to this screen: that the card is pressable and what
					 * pressing it does.
					 */}
					<StoryCardBody view={storyCardView(story)} />
					{/*
					 * What pressing does is visible on screen but missing from the accessible name, so it is
					 * appended only for screen readers.
					 */}
					<span className="sr-only">{t("openPreview")}</span>
				</button>

				{/*
				 * The heart row is always pinned to the bottom of the card (`mt-auto`). If cards with a
				 * one-line tag row and cards with a two-line tag row share a grid row, the hearts would sit
				 * at different heights and the grid would look ragged.
				 */}
				<CardContent className="mt-auto pt-2 pb-2.5">
					<FavoriteControl
						story={story}
						favorited={favorited}
						viewer={viewer}
						className="justify-end"
					/>
				</CardContent>
			</Card>
		</m.article>
	);
}
