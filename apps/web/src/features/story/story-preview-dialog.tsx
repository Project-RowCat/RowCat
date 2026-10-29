import type { Story, Viewer } from "@rowcat/domain";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button, buttonVariants } from "@rowcat/ui-web/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rowcat/ui-web/components/dialog";
import { Link } from "@tanstack/react-router";
import { ImageOff, X } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { StoryByline } from "#/features/profile/story-byline.tsx";
import { FavoriteControl } from "#/features/social/favorite-control.tsx";
import { DIALOG_VIEWPORT_BOUND } from "#/lib/dialog-geometry.ts";
import {
	adultBadge,
	orientationLabel,
	visibilityBadgeLabel,
	startLabel as vocabStartLabel,
} from "#/lib/i18n/vocab.ts";
import { GALLERY_ORIGIN_STATE } from "./story-return.tsx";
import { StartGlyph, storyStartLabel } from "./story-start-control.tsx";
import { startFailureMessage, useStoryStart } from "./use-story-start.tsx";

/**
 * Number of tags shown in the preview. Showing all of them would make the box height vary per work.
 */
const VISIBLE_TAGS = 4;

/**
 * Preview of a work. Pressing a discovery card opens this dialog as a stop before the detail
 * screen, so the user can judge whether this is the work they want without breaking the browsing
 * flow.
 *
 * It does not fetch: the list already provides the Story with everything needed (description, tags,
 * totals). The detail's queries are preloaded by the router on link hover (`defaultPreload:
 * intent`).
 *
 * It does not record views. Mis-presses while browsing would be counted as real views, and the
 * metric would stop meaning anything. Recording happens only after the detail renders in the
 * browser.
 */
export function StoryPreviewDialog({
	story,
	favorites,
	viewer,
	onClose,
}: {
	/** The open work, or `null` when the dialog is closed. */
	story: Story | null;
	/**
	 * Favorite membership comes from the viewer side (`/me/state`), not from the work object.
	 */
	favorites: ReadonlySet<string>;
	viewer: Viewer | null;
	onClose: () => void;
}) {
	const { t } = useTranslation("story");
	/**
	 * The last work stays drawn while the dialog closes. Clearing the content as soon as the open
	 * state turns false would show an empty box during the 100 ms exit animation.
	 */
	const lastStory = useRef<Story | null>(null);
	if (story) lastStory.current = story;
	const shown = story ?? lastStory.current;
	if (!shown) return null;
	const visibilityLabel = visibilityBadgeLabel(shown.visibility);

	return (
		<Dialog open={story !== null} onOpenChange={(open) => !open && onClose()}>
			{/*
			 * The default close button's accessible name is in English, so it gets an explicit
			 * label. The icon alone conveys the meaning, but a screen reader user hears only the
			 * name.
			 */}
			{/*
			 * The box is kept inside the viewport. A long description or many tags could make it
			 * taller than the screen, pushing the `View details` link out of reach, and the box does
			 * not scroll with the page. This happens on common mobile sizes such as 640 x 700 px.
			 */}
			<DialogContent
				showCloseButton={false}
				className={`${DIALOG_VIEWPORT_BOUND} gap-4 sm:max-w-lg`}
			>
				<DialogClose
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							className="absolute top-4 right-4"
						/>
					}
				>
					<X />
					<span className="sr-only">{t("close")}</span>
				</DialogClose>

				{/*
				 * `min-w-0` keeps this row's geometry. `DialogContent` is a grid whose children
				 * default to `min-width: auto`, so one long unbroken description or a single
				 * 40-character tag would push the box off the right edge at 320px. The inner body
				 * column's `min-w-0` protects only that column.
				 */}
				<div className="flex min-w-0 gap-4">
					<StoryPreviewCover story={shown} />

					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<DialogHeader className="gap-1">
							{/*
							 * The preview title is also the dialog's name, which screen readers announce when it
							 * opens.
							 */}
							{/*
							 * `keep-all` keeps Korean words whole, and `wrap-anywhere` breaks only runs that have
							 * no break point. The column is 128px wide beside the cover; with the default
							 * `normal`, Korean would break between characters (`sm / all screen`). `break-words` is
							 * not the partner, since it does not change the minimum content width: with `keep-all`
							 * alone, a long unbroken Korean title would overflow.
							 */}
							<DialogTitle className="pr-8 text-base leading-snug font-bold [word-break:keep-all] wrap-anywhere">
								{shown.title}
							</DialogTitle>
							{/*
							 * The byline matches the detail screen, so the person shown is the same on every
							 * screen. The card is a button here, and a link cannot sit inside a button (invalid
							 * markup), so in discovery the creator is reachable only from this line or the
							 * detail. `render` swaps the element instead of nesting, since a `<p>` inside the
							 * `<p>` of `DialogDescription` would make the browser close the outer paragraph.
							 */}
							<DialogDescription
								render={<StoryByline story={shown} className="text-sm" />}
							/>
						</DialogHeader>

						<div className="flex flex-wrap items-center gap-1.5">
							{shown.orientation && (
								<Badge variant="outline">
									{orientationLabel(shown.orientation)}
								</Badge>
							)}
							{shown.adult && (
								<Badge variant="destructive">{adultBadge()}</Badge>
							)}
							{visibilityLabel && (
								<Badge variant="secondary">{visibilityLabel}</Badge>
							)}
						</div>

						{/*
						 * The description is truncated. The full text lives on the detail screen; showing it
						 * all here would turn the preview into a second detail screen.
						 */}
						<p className="line-clamp-3 text-sm leading-relaxed [word-break:keep-all] wrap-anywhere text-muted-foreground">
							{shown.description.trim() || t("noDescription")}
						</p>

						{shown.tags.length > 0 && (
							<div className="flex flex-wrap gap-1">
								{shown.tags.slice(0, VISIBLE_TAGS).map((tag) => (
									/*
									 * Each tag is capped at 40 characters (`STORY_PUBLISH_LIMITS.tag`). The badge does not
									 * shrink, so without a cap one long tag would push the box off-screen. The preview
									 * truncates here because the full text is on the detail screen; the gallery card makes the
									 * same choice (`max-w-28 truncate`).
									 */
									<Badge
										key={tag}
										variant="secondary"
										title={`#${tag}`}
										className="max-w-full font-normal text-muted-foreground"
									>
										{/* The badge is `inline-flex`, so the ellipsis has to live on the inner block. */}
										<span className="truncate">#{tag}</span>
									</Badge>
								))}
							</div>
						)}
					</div>
				</div>

				<StoryPreviewActions
					story={shown}
					favorited={favorites.has(shown.id)}
					viewer={viewer}
				/>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The preview's action row: favorite (stays here), detail (`View details`), and start (`Start`). It is a
 * separate component because `useStoryStart` is a hook, and the dialog renders nothing before it
 * has ever been opened. A hook above that early return would change order between renders.
 *
 * `Start` skips the detail screen but does not replace it: the detail shows things the preview does
 * not (full description, all tags, statistics). The order and the decisions live in the same hook
 * the detail's primary button uses. This row only knows that three actions of different weight
 * share a row.
 */
function StoryPreviewActions({
	story,
	favorited,
	viewer,
}: {
	story: Story;
	favorited: boolean;
	viewer: Viewer | null;
}) {
	const { t } = useTranslation("story");
	const { pending, failure, start, dialog } = useStoryStart({ story, viewer });

	return (
		/*
		 * The row stays on one line on purpose. The default narrow-screen vertical stack would move the
		 * next action to a different place at each width. Failure messages stack below the row. The left
		 * side holds the action that stays on this screen, and the right side holds the actions that
		 * leave it.
		 */
		<DialogFooter className="flex-col items-stretch gap-2 sm:flex-col">
			{/*
			 * The row is one line by default but may wrap. The heart count can reach seven digits
			 * (`1,247,017`), and the `shrink-0` buttons would overflow a 320px box if forced onto
			 * one line. Counts are not abbreviated to fit. When wrapped, the exit action keeps its
			 * place on the right: `View details` on the first line, `Start` right-aligned on the
			 * second.
			 */}
			<div className="flex flex-row flex-wrap items-center justify-end gap-x-2 gap-y-2">
				{/*
				 * Membership uses the id of the work currently drawn. While the dialog closes, `story`
				 * is null, and using it would turn the heart off during the exit animation.
				 */}
				<FavoriteControl
					story={story}
					favorited={favorited}
					viewer={viewer}
					className="mr-auto"
				/>
				{/*
				 * The detail link is a real anchor. Cards became buttons, which removed
				 * open-in-new-tab and copy-address from the list; a real link brings them back.
				 * Wrapping a `Button` with `render` would make the `<a>` lose them, so only the variant
				 * classes are used.
				 *
				 * It is secondary next to the start button, so two equal boxes would blur which is the
				 * next step. It is not reduced to an icon: the card opens the preview, so this link is
				 * the only route to the detail, and its name must say where it goes. Only the border
				 * is removed, to reduce weight.
				 */}
				<Link
					to="/stories/$storyId"
					params={{ storyId: story.id }}
					/*
					 * The navigation carries an origin marker (`GALLERY_ORIGIN_STATE`) in its history entry. The
					 * detail's `Back to Discover` link reads it and goes back in history instead of pushing a new entry, so
					 * the discovery's query axis, appended pages, and scroll position all return
					 * (`story-return.tsx`). The marker is not in the URL, so a copied link does not carry it.
					 */
					state={GALLERY_ORIGIN_STATE}
					className={buttonVariants({ variant: "ghost", size: "sm" })}
				>
					{t("details")}
				</Link>
				{/*
				 * The play snapshot is requested only on click. Opening the preview alone requests
				 * nothing, so browsing with previews stays cheap.
				 */}
				{/*
				 * The wording is not rebuilt here. A ternary ladder once sat in this spot: when a
				 * domain value was added, the detail was updated but the preview kept the old table,
				 * so the same hook made different promises. Only the one word differs, so only that is
				 * passed in.
				 */}
				<Button size="sm" disabled={pending} onClick={start}>
					{/*
					 * The glyph comes from the same component the detail screen uses, and the decision is
					 * the domain's `storyStartGlyph` alone. Re-deriving it from the play mode here would
					 * let the same work promise different things in the list and on the detail screen.
					 */}
					<StartGlyph playMode={story.playMode} />
					{storyStartLabel({
						pending,
						/**
						 * The word here stays this screen's (`Start`), since this is a small button that does not
						 * carry the detail's weight. Runtime works use the vocabulary's start label as-is:
						 * the word answers what opens, and that answer must match on both screens.
						 */
						startLabel:
							story.playMode === "runtime"
								? vocabStartLabel(story.playMode)
								: t("start"),
					})}
				</Button>
			</div>
			{failure && (
				<output className="text-right text-xs text-destructive">
					{startFailureMessage(failure)}
				</output>
			)}
			{/*
			 * The persona dialog renders as a sibling of this box through a portal, so its place
			 * in the tree does not matter. If each start location drew its own dialog, the two
			 * procedures would diverge.
			 */}
			{dialog}
		</DialogFooter>
	);
}

/** Preview cover, with the same 3:4 ratio and placeholder as the gallery card. */
function StoryPreviewCover({ story }: { story: Story }) {
	/*
	 * `self-start` is required. The outer container is `flex`, so the default `stretch` would grow
	 * this box to the height of the body beside it, and `aspect-3/4` would lose. The longer the
	 * description, the more `object-cover` would crop the cover.
	 */
	const shape = "aspect-3/4 w-24 shrink-0 self-start rounded-md sm:w-28";

	/*
	 * No shared layout animation. The cover was once tied to the card's cover with the same `layoutId`
	 * and then reverted. The dialog sits inside Base UI's portal, whose popup always applies
	 * `translate(-50%, -50%)` and scales to 0.95 while opening. Motion's projection cannot correct a
	 * transform inherited from an ancestor, even after the transform moved from CSS to Motion. In the
	 * browser, the card's cover vanished from its grid cell while the preview was open, leaving a
	 * visible hole beside the box on wide screens.
	 *
	 * The "same work" signal is already conveyed by the box opening over the card with the same title
	 * and cover, so the list is not sacrificed for an effect.
	 */
	if (!story.coverUrl)
		return (
			<div
				aria-hidden="true"
				className={`${shape} flex items-center justify-center border bg-linear-to-br from-muted to-muted/30 text-muted-foreground/60`}
			>
				<ImageOff className="size-6" />
			</div>
		);

	return (
		<img
			src={story.coverUrl}
			referrerPolicy="no-referrer"
			alt=""
			decoding="async"
			className={`${shape} border bg-muted object-cover`}
		/>
	);
}
