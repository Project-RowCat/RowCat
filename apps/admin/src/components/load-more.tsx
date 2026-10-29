import { Button } from "@rowcat/ui-web/components/button";
import type { AdminNextPage } from "#/lib/query/use-admin-infinite-query.ts";

/**
 * The list tail: `Show more`, loading, failure, end.
 *
 * Not infinite scroll: operators scan, and a page appended on reaching the bottom makes them lose
 * track of how many rows they have seen. The next page comes only on press, with no entrance motion
 * (README §Motion). Failure is stated here rather than in the top band, where a user at the list
 * end would miss it and whose `Try again` reloads from the first page instead of the next.
 */
export function LoadMore({
	nextPage,
	noun,
}: {
	nextPage: AdminNextPage;
	/** What is being loaded (`reports`, `appeals`); the end and failure sentences use this word. */
	noun: string;
}) {
	if (nextPage.state === "end")
		return (
			<p className="py-3 text-center text-muted-foreground text-xs">
				Loaded every {noun}.
			</p>
		);

	if (nextPage.state === "failed")
		return (
			<div
				role="alert"
				className="flex flex-wrap items-center justify-center gap-3 py-3"
			>
				<p className="text-destructive text-sm">
					Couldn't load more {noun}. The list above is unchanged.
				</p>
				<Button size="sm" variant="outline" onClick={nextPage.load}>
					Try again
				</Button>
			</div>
		);

	const loading = nextPage.state === "loading";
	return (
		<div className="flex justify-center py-3">
			<Button
				size="sm"
				variant="outline"
				disabled={loading}
				onClick={nextPage.load}
			>
				{loading ? "Loading…" : "Show more"}
			</Button>
		</div>
	);
}
