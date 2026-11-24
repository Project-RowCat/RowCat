import { Skeleton } from "@rowcat/ui-web/components/skeleton";
import { useTranslation } from "react-i18next";

/**
 * Placeholder for the tool library, the only body the server draws for this category. Geometry
 * only: the server cannot know whether this visitor has tools, and invented names would make the
 * placeholder claim facts. Rows match the real row's border and padding, and the action row
 * matches the real one, so nothing shifts when the list arrives.
 */

function ToolRowSkeleton() {
	return (
		<li className="flex items-start gap-3 rounded-lg border p-4">
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<Skeleton className="h-6 w-40 max-w-full" />
				<Skeleton className="h-5 w-full max-w-sm" />
			</div>
			<Skeleton className="size-8 shrink-0 rounded-md" />
		</li>
	);
}

export function ToolLibrarySkeleton() {
	const { t } = useTranslation("tools");
	return (
		<div>
			<output className="sr-only">{t("library.loading")}</output>
			<div aria-hidden="true" className="flex flex-col gap-4">
				<div className="flex justify-end gap-2">
					<Skeleton className="h-8 w-24" />
					<Skeleton className="h-8 w-24" />
					<Skeleton className="h-8 w-24" />
				</div>
				<ul className="flex flex-col gap-2">
					<ToolRowSkeleton />
					<ToolRowSkeleton />
					<ToolRowSkeleton />
				</ul>
			</div>
		</div>
	);
}
