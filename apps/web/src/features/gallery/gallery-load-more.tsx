import { Button } from "@rowcat/ui-web/components/button";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { GALLERY_GRID_CLASS } from "./gallery-grid.ts";
import { GalleryCardSkeleton } from "./gallery-skeleton.tsx";

/**
 * Distance in px from the list end at which the next page is requested. The request has to leave
 * before the user reaches the bottom, or the list stalls.
 */
const PREFETCH_MARGIN_PX = 600;

/**
 * Number of placeholder cards shown while the next page loads. Drawing a full page (24 items) would
 * make the screen jump.
 */
const PENDING_COUNT = 4;

/**
 * End of the list, where the next page is requested.
 *
 * Uses an IntersectionObserver rather than a scroll listener. A scroll handler wakes every frame
 * and forces layout via getBoundingClientRect(), and that cost grows with the card count. The
 * browser judges observer intersections during compositing, independent of list length.
 *
 * The button beside it is essential. Auto-load alone leaves keyboard and screen reader users with
 * nowhere to go (focus does not create scrolling), and where no observer exists the list silently
 * stops at 24 items. On the normal path the prefetch margin fires the request before the button
 * scrolls into view, so users only see the placeholders.
 */
export function GalleryLoadMore({
	hasNext,
	pending,
	failed = false,
	onLoadMore,
}: {
	hasNext: boolean;
	/**
	 * Whether the next page is loading. The placeholder and the button state both read this one value.
	 */
	pending: boolean;
	/**
	 * Whether the last `Show more` (fetch next page) failed (isFetchNextPageError).
	 *
	 * Without this axis, next-page failures were completely silent: the button came back with no
	 * message, and users could not tell why pressing it did nothing. A failure does not replace the
	 * list: cards already loaded stay, and a single line beside the boundary says what happened.
	 */
	failed?: boolean;
	onLoadMore: () => void;
}) {
	const { t } = useTranslation(["gallery", "common"]);
	const sentinel = useRef<HTMLDivElement>(null);
	/**
	 * Callbacks are new every render. The caller's fetchNextPage is stable, but this component does
	 * not rely on that. Tying the observer to callback identity would re-attach it on every list
	 * growth and drop intersections that happen in between. The observer reacts only to whether a next
	 * page exists; the callback is read through a ref.
	 */
	const latest = useRef(onLoadMore);
	useEffect(() => {
		latest.current = onLoadMore;
	});

	useEffect(() => {
		const target = sentinel.current;
		// No observer is needed once the end is reached; left attached, it keeps waking below the screen.
		//
		// After a failure it is not observed either. If the observer kept retrying the failed request
		// from the boundary still on screen, it would hammer a dead connection. The next request after a
		// failure is chosen by a person via the button.
		if (!target || !hasNext || failed) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) latest.current();
			},
			{ rootMargin: `${PREFETCH_MARGIN_PX}px 0px` },
		);
		observer.observe(target);
		return () => observer.disconnect();
	}, [hasNext, failed]);

	/**
	 * Shows the end state. Without a marker, 'more exists but not loaded' cannot be told apart from
	 * 'done'; in infinite scroll that uncertainty is the anxiety users feel most often.
	 */
	if (!hasNext)
		return (
			<p className="pt-8 text-center text-sm text-muted-foreground">
				{t("end")}
			</p>
		);

	return (
		<>
			{/*
			 * The placeholder sits behind the grid, not inside it, with the same geometry. Inside the grid it
			 * would
			 * fill the empty cells of an unfinished last row, so when the real cards arrive they would not land
			 * there and the whole list would shift by one cell.
			 */}
			{pending && (
				<div className={`mt-4 ${GALLERY_GRID_CLASS}`} aria-hidden="true">
					{Array.from({ length: PENDING_COUNT }, (_, index) => index).map(
						(index) => (
							<GalleryCardSkeleton key={index} />
						),
					)}
				</div>
			)}

			<div ref={sentinel} className="flex flex-col items-center gap-2 pt-8">
				{/*
				 * On failure, speak beside the button just pressed. A large error box above the cards already
				 * loaded
				 * would hide the fact that only the next page failed.
				 */}
				{failed && !pending && (
					<p role="alert" className="text-sm text-destructive">
						{t("loadMoreFailed")}
					</p>
				)}
				{/*
				 * The button stays after it is pressed (it is only disabled). Removing it would drop focus to the
				 * document, and keyboard users would be sent back to the top of the list.
				 */}
				<Button
					variant="outline"
					size="sm"
					disabled={pending}
					onClick={onLoadMore}
				>
					{pending
						? t("loading")
						: failed
							? t("common:actions.retry")
							: t("showMore")}
				</Button>
			</div>

			{/* Auto-loaded growth is only visible; screen reader users are told in words. */}
			<output className="sr-only">{pending ? t("loadingMore") : ""}</output>
		</>
	);
}
