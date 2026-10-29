import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useTranslation } from "react-i18next";
import {
	STORY_COVER_COLUMN_CLASS,
	STORY_DETAIL_LAYOUT_CLASS,
} from "./story-detail-shell.tsx";

/**
 * Detail placeholder with the same geometry as the hero, so the top of the screen does not move
 * when the work arrives. A centered spinner is avoided because the whole screen would change height
 * at once.
 *
 * Only always-present elements are drawn: cover ratio, title block, primary action, and body lines.
 * Adult and private badges, type labels, tags, and the prompt-protection line vary per work, so
 * drawing them in advance would claim facts the placeholder does not know yet. A gray pill could
 * signal adult content. Screen readers get one status line instead of the blocks.
 */
export function StoryDetailSkeleton() {
	const { t } = useTranslation("story");
	return (
		<div>
			{/*
			 * An `<output>` element already has an implicit role="status", so updates are
			 * announced once, politely.
			 */}
			<output className="sr-only">{t("loading")}</output>

			<div aria-hidden="true" className={STORY_DETAIL_LAYOUT_CLASS}>
				<div className={STORY_COVER_COLUMN_CLASS}>
					<Skeleton className="aspect-3/4 w-full rounded-lg" />
				</div>

				{/*
				 * Same gap as the hero's body column (gap-6), so the layout stays put when the
				 * layers arrive.
				 */}
				<div className="flex min-w-0 flex-1 flex-col gap-6">
					<div className="flex flex-col gap-2">
						<Skeleton className="h-8 w-3/4 md:h-9" />
						<Skeleton className="h-5 w-40" />
					</div>

					{/*
					 * The action row mirrors the real layout: on narrow screens the primary action takes
					 * the full width and the secondary controls drop to a second line (size lg is 40px).
					 *
					 * The favorite slot is reserved for guests too, but the report control is not drawn,
					 * since guests and owners never see it. A placeholder must not promise an action that
					 * does not exist for this viewer.
					 */}
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
						<Skeleton className="h-10 w-full rounded-md sm:w-36" />
						<div className="flex items-center gap-1.5">
							<Skeleton className="size-9 rounded-md" />
							<Skeleton className="h-4 w-5" />
						</div>
					</div>

					<div className="flex max-w-2xl flex-col gap-2.5">
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-2/3" />
					</div>

					{/*
					 * The divider is drawn here as well. If it appeared later, everything below it
					 * would shift down by 1px.
					 */}
					<div className="mt-2 flex flex-col gap-3 border-t pt-6">
						<Skeleton className="h-3.5 w-16" />
						<Skeleton className="h-4 w-52" />
						<Skeleton className="h-4 w-44" />
					</div>
				</div>
			</div>
		</div>
	);
}
