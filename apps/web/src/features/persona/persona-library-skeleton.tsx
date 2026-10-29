import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useTranslation } from "react-i18next";

/**
 * Placeholder for the library, the only body the server draws for this category.
 * - The server cannot know whether this visitor has any roles (they live only in IndexedDB), so
 *   only the geometry is here. No name, description or count reaches the server HTML; invented
 *   values would make the placeholder claim facts.
 * - The empty state must not be drawn here. Not knowing yet and truly having zero are different
 *   states; merging them would flash 'no personas saved' for a user with a full library.
 * - Same geometry as the destination: rows use the same border and padding classes, and the
 *   create row matches too, so the list does not shift on arrival. Placeholder and list share a
 *   parent (below the category title, mt-6) for the same reason.
 * - The category title and description are not here; the server draws them as real text
 *   (persona-settings-page.tsx).
 */

function PersonaRowSkeleton() {
	return (
		<li className="flex items-start gap-3 rounded-lg border p-4">
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<Skeleton className="h-6 w-40 max-w-full" />
				<Skeleton className="h-5 w-full max-w-sm" />
			</div>
			{/*
			 * Placeholder for the overflow trigger. Its dimensions must match the real row's button; that value
			 * is owned by the real row, and this is the only other place it is copied.
			 */}
			<Skeleton className="size-8 shrink-0 rounded-md" />
		</li>
	);
}

export function PersonaLibrarySkeleton() {
	const { t } = useTranslation("persona");
	return (
		<div>
			{/* An output element is implicitly role=status, so updates are announced once, politely. */}
			<output className="sr-only">{t("library.loading")}</output>

			{/*
			 * The illustration is removed from assistive technology entirely. Reading each skeleton element
			 * would make a screen with nothing yet sound like a list.
			 */}
			<div aria-hidden="true" className="flex flex-col gap-4">
				<div className="flex justify-end">
					<Skeleton className="h-8 w-28" />
				</div>
				{/*
				 * Three rows. This is a minimum that says 'this is a list' without claiming a real count. Drawing
				 * more
				 * would make the screen shrink on arrival for people with short libraries.
				 */}
				<ul className="flex flex-col gap-2">
					<PersonaRowSkeleton />
					<PersonaRowSkeleton />
					<PersonaRowSkeleton />
				</ul>
			</div>
		</div>
	);
}
