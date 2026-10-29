import { type AdminStorySummaryDto, StoryVisibility } from "@rowcat/contracts";
import { adminStoriesQueryOptions } from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { DataTable } from "#/components/data-table.tsx";
import {
	FilterBar,
	FilterSearch,
	FilterSelect,
} from "#/components/filter-bar.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { QueryState } from "#/components/states.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import {
	formatCount,
	formatDateTime,
	formatRelative,
	shortId,
} from "#/lib/format.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { useAdminQuery } from "#/lib/query/use-admin-query.ts";

/**
 * The whole catalogue. It does not pass through `galleryWhere`, so private, archived,
 * operator-hidden and adult works are all included — which is why no authored content appears here,
 * only title, visibility axes and metrics.
 *
 * There is no hide toggle: hiding is an enforcement that leaves a `moderation_action`. Flipping a
 * column from the list would be a second enforcement path with no audit and nothing to appeal. The
 * detail links to the open case instead.
 */

const VISIBILITY_OPTIONS = [
	{ value: "", label: "All visibility" },
	...StoryVisibility.options.map((value) => ({ value, label: value })),
];

const TRISTATE = (labels: [string, string, string]) => [
	{ value: "", label: labels[0] },
	{ value: "1", label: labels[1] },
	{ value: "0", label: labels[2] },
];

/** Anything else folds to "all", so a hand-edited URL does not break the screen. */
const triValue = (raw: string | undefined): "" | "0" | "1" =>
	raw === "0" || raw === "1" ? raw : "";

export function StoriesPage() {
	const navigate = useNavigate();
	const search = useSearch({ from: "/stories" });

	const visibility = StoryVisibility.safeParse(search.visibility);
	const input = {
		q: search.q ?? "",
		ownerId: search.ownerId ?? "",
		visibility: visibility.success ? visibility.data : ("" as const),
		hidden: triValue(search.hidden),
		adult: triValue(search.adult),
	};

	const query = useAdminQuery(
		adminStoriesQueryOptions(getRowCatClient(), input),
	);

	const setFilter = (patch: Record<string, string | undefined>) =>
		navigate({
			to: "/stories",
			search: (previous) => ({ ...previous, ...patch }),
			replace: true,
		});

	return (
		<PageEnter className="space-y-4">
			<PageHeader
				title="Stories"
				description="The whole catalogue including private, archived and hidden. Authored content does not appear here."
			/>

			<FilterBar>
				<FilterSearch
					label="Search"
					value={input.q}
					placeholder="Story ID · title"
					onSubmit={(value) => setFilter({ q: value || undefined })}
				/>
				<FilterSelect
					label="Visibility"
					value={input.visibility}
					options={VISIBILITY_OPTIONS}
					onChange={(value) => setFilter({ visibility: value || undefined })}
				/>
				<FilterSelect
					label="Operator hiding"
					value={input.hidden}
					options={TRISTATE(["All", "Hidden only", "Not hidden"])}
					onChange={(value) => setFilter({ hidden: value || undefined })}
				/>
				<FilterSelect
					label="Rating"
					value={input.adult}
					options={TRISTATE(["All", "Adult only", "All ages only"])}
					onChange={(value) => setFilter({ adult: value || undefined })}
				/>
			</FilterBar>

			{input.ownerId ? (
				<div className="flex items-center gap-2 text-sm">
					<span className="text-muted-foreground">Narrowed to creator:</span>
					<Link
						to="/members/$memberId"
						params={{ memberId: input.ownerId }}
						className="font-mono text-xs underline-offset-4 hover:underline"
					>
						{input.ownerId}
					</Link>
					<button
						type="button"
						className="text-muted-foreground text-xs underline-offset-4 hover:underline"
						onClick={() => setFilter({ ownerId: undefined })}
					>
						Clear
					</button>
				</div>
			) : null}

			<QueryState
				query={query}
				empty={{
					title: "No stories match",
					when: (data) => data.items.length === 0,
				}}
			>
				{(data) => (
					<DataTable<AdminStorySummaryDto>
						caption="Stories"
						rows={data.items}
						rowKey={(row) => row.id}
						onRowClick={(row) =>
							navigate({
								to: "/stories/$storyId",
								params: { storyId: row.id },
							})
						}
						columns={[
							{
								key: "title",
								header: "Title",
								truncate: true,
								render: (row) => (
									<div className="min-w-0">
										<p className="truncate font-medium">{row.title}</p>
										<p
											className="font-mono text-muted-foreground text-xs"
											title={row.id}
										>
											{shortId(row.id)}
										</p>
									</div>
								),
							},
							{
								key: "owner",
								header: "Creator",
								truncate: true,
								hideBelow: "sm",
								render: (row) =>
									row.ownerId ? (
										<span className="truncate">
											{row.ownerNickname ?? shortId(row.ownerId)}
										</span>
									) : (
										/** Identity erased by account deletion; say so rather than invent one. */
										<span className="text-muted-foreground text-xs">
											No identity
										</span>
									),
							},
							{
								key: "state",
								header: "Status",
								render: (row) => (
									<div className="flex flex-wrap gap-1">
										<Badge variant="outline">{row.visibility}</Badge>
										{row.hidden ? (
											<Badge variant="destructive">Hidden</Badge>
										) : null}
										{row.adult ? (
											<Badge variant="secondary">Adult</Badge>
										) : null}
									</div>
								),
							},
							{
								key: "views",
								header: "Views",
								numeric: true,
								hideBelow: "md",
								render: (row) => formatCount(row.views),
							},
							{
								key: "favorites",
								header: "Favorites",
								numeric: true,
								hideBelow: "lg",
								render: (row) => formatCount(row.favorites),
							},
							{
								key: "createdAt",
								header: "Created",
								hideBelow: "md",
								render: (row) => (
									<span title={formatDateTime(row.createdAt)}>
										{formatRelative(row.createdAt)}
									</span>
								),
							},
						]}
					/>
				)}
			</QueryState>
		</PageEnter>
	);
}
