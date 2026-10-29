import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useTranslation } from "react-i18next";
import { GALLERY_GRID_CLASS } from "#/features/gallery/gallery-grid.ts";
import { GalleryCardSkeleton } from "#/features/gallery/gallery-skeleton.tsx";

/**
 * Number of placeholder cards. Rendering the full first page (24 works) would make the whole screen
 * jump when the data arrives.
 */
const PENDING_COUNT = 4;

/**
 * Placeholder for the public profile. It draws the same geometry as the final screen, so nothing
 * shifts on arrival. A centered spinner is not used, since it would change the whole screen's
 * height.
 * - The grid must match `profile-header.tsx` exactly: column definitions, gaps, the avatar's
 *   `sm:row-span-2`, and the action cell's position. A single mismatched class still renders fine,
 *   but the avatar and name slide sideways when the profile arrives. These are copied from the
 *   header for that reason.
 * - The name area stays empty. A placeholder such as `Creator` or `Followers 0` would be an invented
 *   profile, not a placeholder.
 * - The action area reserves size only, not a label. The label depends on the viewer (`Follow` or
 *   `Edit profile`), so only the size is reserved. The cell is always present, since one of the three
 *   always renders.
 * - Card placeholders are reused from the discover screen. They draw the same cards, so the
 *   column count must agree.
 */
export function ProfileSkeleton() {
	const { t } = useTranslation("profile");
	return (
		<div>
			{/* `<output>` has an implicit role of `status`, so the update is announced once, politely. */}
			<output className="sr-only">{t("loading")}</output>

			<div aria-hidden="true">
				<div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5">
					<Skeleton className="size-16 shrink-0 rounded-full sm:size-20 sm:row-span-2" />

					<div className="flex min-w-0 flex-col gap-1">
						<Skeleton className="h-8 w-48 md:h-9" />
						<Skeleton className="h-5 w-24" />
					</div>

					{/*
					 * The actions cell. On narrow screens it takes the full row, as the follow button does. From `sm`
					 * it
					 * returns to the right end at content width. Its height matches the real controls (`h-9 sm:h-8`),
					 * so the
					 * placeholder does not shift.
					 */}
					<div className="col-span-2 flex items-center sm:col-span-1 sm:col-start-3 sm:row-start-1">
						<Skeleton className="h-9 flex-1 sm:h-8 sm:w-24 sm:flex-none" />
					</div>

					{/*
					 * Bio. Only two lines are reserved, since the value may be absent. Reserving every line would push
					 * a
					 * profile with no bio upward, and reserving none would push a profile with a bio downward.
					 */}
					<div className="col-span-2 flex flex-col gap-2 sm:col-start-2 sm:row-start-2">
						<Skeleton className="h-4 w-full max-w-2xl" />
						<Skeleton className="h-4 w-2/3 max-w-md" />
					</div>
				</div>

				{/*
				 * The section heading and the line below it. A real line is drawn rather than a `Separator`. Unlike
				 * the
				 * earlier separator, this line is not a decorative divider between two pieces of content. It is the
				 * heading's own boundary, so it stays in place when the value arrives.
				 */}
				<div className="mt-8 border-b pb-2">
					<Skeleton className="h-5 w-16" />
				</div>

				<div className={`mt-4 ${GALLERY_GRID_CLASS}`}>
					{Array.from({ length: PENDING_COUNT }, (_, index) => index).map(
						(index) => (
							<GalleryCardSkeleton key={index} />
						),
					)}
				</div>
			</div>
		</div>
	);
}
