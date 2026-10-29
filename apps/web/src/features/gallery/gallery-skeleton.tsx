import { Card, CardContent } from "@rowcat/ui-web/components/card";
import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useTranslation } from "react-i18next";
import { GALLERY_GRID_CLASS } from "./gallery-grid.ts";

/**
 * Fills only the first screen. Drawing a full page (24 items) would draw cells that are never
 * visible.
 */
const PLACEHOLDER_COUNT = 8;

/**
 * Single-card placeholder. The first-screen skeleton (this file) and the wait slot for the next
 * page (`GalleryLoadMore`) must draw the same geometry. Hand-written in two places, changing only
 * one shows nothing until the cards arrive and reveal which side jumps.
 */
export function GalleryCardSkeleton() {
	return (
		<Card size="sm" className="h-full gap-0 py-0">
			<Skeleton className="aspect-3/4 w-full rounded-none" />
			<div className="flex flex-col gap-2 px-4 py-3">
				<Skeleton className="h-4 w-4/5" />
				<Skeleton className="h-3 w-1/2" />
				<Skeleton className="h-5 w-16 rounded-4xl" />
			</div>
			{/*
			 * The heart row always sits at the bottom of the card (`mt-auto` in story-card.tsx). It was once
			 * missing, so the
			 * placeholder card sat 50px lower than the real one; the gallery is the first screen the server
			 * renders, which
			 * made that offset the most visible shift in the app.
			 *
			 * The bowl (`CardContent`) and margins (`mt-auto pt-2 pb-2.5`) are copied from the real row; only
			 * the trigger's
			 * dimension is matched here (`icon-sm` = `size-8`).
			 *
			 * The count is not drawn. The favorite count is unknown until the server answers, and a gray bar
			 * would read
			 * heavier than the value that arrives; the trigger's height alone sets the space.
			 */}
			<CardContent className="mt-auto flex justify-end pt-2 pb-2.5">
				<Skeleton className="size-8 rounded-md" />
			</CardContent>
		</Card>
	);
}

/**
 * Placeholder for the gallery, drawing the same geometry as the final screen.
 *
 * No center spinner: the screen would switch to a different height when data arrives. Reserving the
 * toolbar too keeps the list from pushing the top down when it arrives.
 *
 * The model is the default toolbar only: search, filter trigger, sort trigger, results summary. The
 * applied conditions token row is not drawn: the default filter creates no tokens
 * (appliedGalleryFilters), so a placeholder drawing that row would see it vanish when the value
 * arrives and the grid jump up, the opposite of reserving space. For the same reason the old four
 * Selects are absent; those controls now sit behind the two triggers (gallery-toolbar.tsx).
 *
 * Screen readers get one status line instead of reading the card skeleton eight times.
 */
export function GallerySkeleton() {
	const { t } = useTranslation("gallery");
	return (
		<div>
			{/* `<output>` implicitly has role="status", so updates are announced once, politely. */}
			<output className="sr-only">{t("loadingList")}</output>

			<div aria-hidden="true">
				{/*
				 * Same skeleton as the toolbar (`GalleryToolbar`): the outer gap (`gap-3`), the stacked narrow
				 * layout that becomes
				 * one row from `sm`, and the two triggers spreading to both ends on narrow screens all use the same
				 * classes.
				 * One differing line here would shift the top by that amount when values arrive.
				 */}
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
						<Skeleton className="h-11 min-w-0 flex-1 sm:h-10" />
						<div className="flex items-center justify-between gap-2 sm:justify-start">
							<Skeleton className="h-10 w-20 sm:h-9" />
							<Skeleton className="h-10 w-24 sm:h-9" />
						</div>
					</div>
					{/*
					 * Results summary. `min-h-8` matches the toolbar's value. That height is also where the `Reset filters`
					 * (reset filters)
					 * button appears when conditions are set; if the placeholder matched only text height, a filtered
					 * list would make
					 * the row grow when it arrives.
					 */}
					<div className="flex min-h-8 items-center">
						<Skeleton className="h-4 w-16" />
					</div>
				</div>

				<div className={`mt-4 ${GALLERY_GRID_CLASS}`}>
					{Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => index).map(
						(index) => (
							<GalleryCardSkeleton key={index} />
						),
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * Grid-only placeholder, used when the toolbar is already alive.
 *
 * The difference from the one above is what remains on screen. A first-time visitor has nothing, so
 * the toolbar must be drawn too. Someone who changed a condition still has the toolbar they just
 * touched; drawing another copy would turn the search field they are typing in into a gray bar and
 * drop the caret (see the boundary comment in gallery-page.tsx).
 *
 * No status line here is the counterpart: the toolbar total's slot already says 'not yet known',
 * and repeating it would read the same fact twice on each condition change. One card's geometry
 * still lives only in GalleryCardSkeleton.
 */
export function GalleryGridSkeleton() {
	return (
		<div aria-hidden="true" className={`mt-4 ${GALLERY_GRID_CLASS}`}>
			{Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => index).map(
				(index) => (
					<GalleryCardSkeleton key={index} />
				),
			)}
		</div>
	);
}
