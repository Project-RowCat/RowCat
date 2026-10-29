import { space } from "@rowcat/design";
import {
	CREATOR_ANALYTICS_WINDOW_LABEL,
	CREATOR_ANALYTICS_WINDOWS,
	type CreatorAnalyticsWindow,
	type CreatorAnalyticsWork,
	PLAY_START_CONVERSION_NOTE,
	playStartConversion,
	uniqueCreatorAnalyticsWorks,
} from "@rowcat/domain";
import {
	creatorAnalyticsInfiniteQueryOptions,
	creatorAnalyticsSummary,
	creatorAnalyticsTotal,
	creatorAnalyticsWorks,
} from "@rowcat/query";
import {
	Badge,
	Button,
	DropdownMenu,
	EmptyState,
	ErrorState,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	Notice,
	Panel,
	Spinner,
	screenPadding,
	Text,
} from "@rowcat/ui-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FlatList, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { AnimatedCount } from "../../lib/motion/animated-count.tsx";
import { PageEnter } from "../../lib/motion/page-enter.tsx";
import {
	ANALYTICS_EMPTY,
	ANALYTICS_SUMMARY_HEADING,
	SERVER_PANEL,
	WORK_HIDDEN_BADGE,
} from "./create-copy.ts";
import {
	analyticsWindowParams,
	readAnalyticsWindowParam,
} from "./create-view.ts";
import { serverPanelView } from "./server-panel-state.ts";
import { WORK_VISIBILITY_LABEL } from "./work-lifecycle-copy.ts";

/**
 * Analytics tab: draws the server's aggregates as-is.
 *
 * Its query is separate from `Published` because the invalidation axis differs (analytics move with
 * other people's reads, favorites and comments). There is no polling or sync hookup; freshness
 * belongs to `@rowcat/query`.
 *
 * - Totals come from the server (`creatorAnalyticsSummary`), never a sum of loaded rows, which
 *   would grow with each `Show more`.
 * - A failure is never drawn as zero, which would claim nobody looked. The state order lives in
 *   `serverPanelView`.
 * - Numbers are not abbreviated, so the summary is label/value rows rather than columns
 *   (`1,247,017` does not fit a 3-column cell at 390pt).
 */
export function CreatorAnalyticsPanel() {
	const client = getRowCatClient();
	/** The window lives in the address, like the tab (see create-view.ts). */
	const params = useLocalSearchParams<{ window?: string | string[] }>();
	const router = useRouter();
	const window = readAnalyticsWindowParam(params.window);
	const query = useInfiniteQuery(
		creatorAnalyticsInfiniteQueryOptions(client, window),
	);

	const rows = query.data
		? uniqueCreatorAnalyticsWorks(creatorAnalyticsWorks(query.data))
		: EMPTY;
	const summary = query.data ? creatorAnalyticsSummary(query.data) : null;
	const total = query.data ? creatorAnalyticsTotal(query.data) : null;

	const view = serverPanelView({
		isPaused: query.isPaused,
		isError: query.isError,
		isPending: query.isPending,
		hasData: query.data !== undefined,
		rowCount: rows.length,
	});

	const windowMenu = (
		<AnalyticsWindowMenu
			window={window}
			onChange={(next) => router.setParams(analyticsWindowParams(next))}
		/>
	);

	/**
	 * The window picker stays mounted while loading. Replacing the screen with a spinner on a period
	 * change would remove the control just pressed, so the period could not be seen or changed again.
	 * Previous numbers are not kept, since they would sit under the new period's label.
	 */
	if (view.state === "loading")
		return (
			<View style={panel.pending}>
				<View style={panel.window}>{windowMenu}</View>
				<View style={panel.pendingBody}>
					<Spinner />
				</View>
			</View>
		);

	if (view.state === "offline" || view.state === "error")
		return (
			<View style={panel.center}>
				<ErrorState
					message={
						view.state === "offline" ? SERVER_PANEL.offline : SERVER_PANEL.error
					}
					actionLabel={SERVER_PANEL.retry}
					onAction={() => void query.refetch()}
				/>
			</View>
		);

	if (view.state === "empty")
		return (
			<View style={panel.center}>
				<EmptyState
					icon="library"
					title={ANALYTICS_EMPTY.title}
					description={ANALYTICS_EMPTY.description}
				/>
			</View>
		);

	/**
	 * Body arrived; the header and tab row stay outside. PageEnter marks content resolving rather than
	 * route arrival (see lib/motion/page-enter.tsx), so it is absent from the placeholder, guest and
	 * error branches.
	 */
	return (
		<PageEnter style={panel.fill}>
			<FlatList
				data={rows}
				keyExtractor={keyOf}
				renderItem={({ item }) => <AnalyticsRow work={item} window={window} />}
				contentContainerStyle={panel.content}
				ListHeaderComponent={
					<View style={panel.head}>
						{/** Period window: a radio menu like the sort menu; the value goes to the address. */}
						<View style={panel.window}>{windowMenu}</View>
						{summary ? (
							<Panel style={panel.summary}>
								<Text
									accessibilityRole="header"
									variant="caption"
									tone="muted-foreground"
								>
									{ANALYTICS_SUMMARY_HEADING}
								</Text>
								{/**
								 * Only the three totals animate, as on the web. They change when the user asks again, so swapping them
								 * silently would force comparing by eye. No roll on mount (see lib/motion/animated-count.tsx), or every open
								 * would read as growth from 0. The per-work rows stay static so a refresh does not move the whole list.
								 */}
								{METRIC_ORDER.map((metric) => (
									<View key={metric} style={panel.summaryRow}>
										<Text variant="label" tone="muted-foreground">
											{metricLabel(metric, window)}
										</Text>
										<AnimatedCount
											value={formatMetric(metricsOf(summary)[metric])}
											variant="body"
											weight="semibold"
										/>
									</View>
								))}
								{/**
								 * Play starts per view, from the same window's two numbers. Omitted without a denominator. It can exceed
								 * 100%, and a session means something different per playback mode, so the accessible name carries the
								 * shared note. Not called a conversion rate: it is not a unique-visitor rate.
								 */}
								{(() => {
									const rate = playStartConversion({
										views: summary.windowViews,
										playStarts: summary.windowPlayStarts,
									});
									return rate === null ? null : (
										<View
											accessible
											accessibilityLabel={`Play starts per view ${formatPercent(rate)}. ${PLAY_START_CONVERSION_NOTE}`}
											style={panel.summaryRow}
										>
											<Text variant="label" tone="muted-foreground">
												Play starts per view
											</Text>
											<Text variant="body" weight="semibold">
												{formatPercent(rate)}
											</Text>
										</View>
									);
								})()}
								<Text variant="caption" tone="muted-foreground">
									{window === "all"
										? "Cumulative views and play starts, and current favorites and comments."
										: `Views and play starts are counts over ${CREATOR_ANALYTICS_WINDOW_LABEL[window]}; favorites and comments are current counts. Cumulative views ${formatMetric(summary.views)} · cumulative play starts ${formatMetric(summary.playStarts)}.`}
								</Text>
							</Panel>
						) : null}
						{total !== null ? (
							<Text variant="caption" tone="muted-foreground">
								{`${total.toLocaleString("en-US")} stories`}
							</Text>
						) : null}
						{/** A failed `Show more` also sets isError; without this filter the stale line would sit over held data and its retry would restart from page one. The tail reports that failure. */}
						{view.retryable && !query.isFetchNextPageError ? (
							<Notice
								message={SERVER_PANEL.stale}
								actionLabel={SERVER_PANEL.retry}
								onAction={() => void query.refetch()}
							/>
						) : null}
					</View>
				}
				ListFooterComponent={
					query.hasNextPage ? (
						<View style={panel.more}>
							{query.isFetchNextPageError ? (
								<Notice message={SERVER_PANEL.moreFailed} tone="destructive" />
							) : null}
							<Button
								label={SERVER_PANEL.more}
								variant="outline"
								busy={query.isFetchingNextPage}
								onPress={() => void query.fetchNextPage()}
							/>
						</View>
					) : null
				}
			/>
		</PageEnter>
	);
}

/**
 * Period window: a radio menu like the sort menu; the value goes to the address. Shared by the
 * loading and loaded branches so the two copies cannot drift.
 */
function AnalyticsWindowMenu({
	window,
	onChange,
}: {
	window: CreatorAnalyticsWindow;
	onChange: (next: CreatorAnalyticsWindow) => void;
}) {
	return (
		<DropdownMenu
			icon="chevron-down"
			label={`Analytics period: ${CREATOR_ANALYTICS_WINDOW_LABEL[window]}`}
			triggerLabel={CREATOR_ANALYTICS_WINDOW_LABEL[window]}
		>
			<MenuLabel label="Analytics period" />
			<MenuRadioGroup
				value={window}
				onValueChange={(next) => onChange(next as CreatorAnalyticsWindow)}
			>
				{CREATOR_ANALYTICS_WINDOWS.map((candidate) => (
					<MenuRadioItem
						key={candidate}
						value={candidate}
						label={CREATOR_ANALYTICS_WINDOW_LABEL[candidate]}
					/>
				))}
			</MenuRadioGroup>
		</DropdownMenu>
	);
}

function AnalyticsRow({
	work,
	window,
}: {
	work: CreatorAnalyticsWork;
	window: CreatorAnalyticsWindow;
}) {
	const at = formatDateTime(work.updatedAt);
	const metrics = metricsOf(work);
	return (
		<Panel style={row.root}>
			<Text variant="body" weight="semibold" numberOfLines={2}>
				{work.title}
			</Text>
			<View style={row.meta}>
				<Text variant="caption" tone="muted-foreground">
					{[WORK_VISIBILITY_LABEL[work.visibility], at ? `Updated ${at}` : null]
						.filter((part): part is string => part !== null)
						.join(" · ")}
				</Text>
				{/** Operator hiding gets its own badge, apart from the creator's visibility, so 0 views can be told apart from a hidden work. */}
				{work.hidden ? (
					<Badge label={WORK_HIDDEN_BADGE} variant="destructive" />
				) : null}
			</View>
			<View style={row.metrics}>
				{METRIC_ORDER.map((metric) => (
					<View key={metric} style={row.metric}>
						<Text variant="caption" tone="muted-foreground">
							{metricLabel(metric, window)}
						</Text>
						<Text variant="body" weight="semibold">
							{formatMetric(metrics[metric])}
						</Text>
					</View>
				))}
			</View>
		</Panel>
	);
}

/**
 * Metric labels and order in one table, shared by the summary card and the rows so they cannot
 * drift apart. No synonyms; what each metric means (views cumulative, the others current state) is
 * defined in `@rowcat/domain`.
 */
const METRIC_LABEL = {
	views: "Views",
	playStarts: "Play starts",
	favorites: "Favorites",
	comments: "Comments",
} as const;

type Metric = keyof typeof METRIC_LABEL;

const METRIC_ORDER: readonly Metric[] = [
	"views",
	"playStarts",
	"favorites",
	"comments",
];

/** Windowed metrics read the window value; for `all` the server sets it equal to the cumulative one, so no per-window branch is needed. */
const WINDOWED: ReadonlySet<Metric> = new Set(["views", "playStarts"]);

const metricsOf = (source: {
	windowViews: number;
	windowPlayStarts: number;
	favorites: number;
	comments: number;
}): Record<Metric, number> => ({
	views: source.windowViews,
	playStarts: source.windowPlayStarts,
	favorites: source.favorites,
	comments: source.comments,
});

/** Only windowed metrics take the window suffix; a window on favorites would name a value we do not measure. */
const metricLabel = (metric: Metric, window: CreatorAnalyticsWindow): string =>
	window === "all" || !WINDOWED.has(metric)
		? METRIC_LABEL[metric]
		: `${METRIC_LABEL[metric]} · ${CREATOR_ANALYTICS_WINDOW_LABEL[window]}`;

const formatPercent = (rate: number): string =>
	`${(rate * 100).toLocaleString("en-US", {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	})}%`;

/** Exact, unabbreviated count. The guard only stops NaN from reaching the screen, where it would read as a calculation failure. */
function formatMetric(value: number): string {
	if (!Number.isFinite(value)) return "0";
	return Math.max(0, Math.trunc(value)).toLocaleString("en-US");
}

const keyOf = (work: CreatorAnalyticsWork) => work.id;
const EMPTY: CreatorAnalyticsWork[] = [];

const panel = StyleSheet.create({
	/** Must take part in layout: a list only gets the remaining height from a parent that passes it on (PageEnter has no default style). */
	fill: { flex: 1 },
	content: { gap: space.sm, padding: screenPadding },
	head: { gap: space.sm, paddingBottom: space.xs },
	/** One trigger on the row's left, same place as the discover sort trigger. */
	window: { alignItems: "flex-start", flexDirection: "row" },
	summary: { gap: space.xs, padding: space.md },
	summaryRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.md,
		justifyContent: "space-between",
	},
	/** Loading screen: picker on top, spinner below. Horizontal padding is set here because this branch has no list; `content` supplies it once a value arrives. */
	pending: {
		gap: space.sm,
		paddingHorizontal: screenPadding,
		paddingTop: space.sm,
	},
	pendingBody: { paddingTop: space.xl },
	center: { paddingHorizontal: screenPadding, paddingTop: space.xl },
	more: { alignItems: "center", gap: space.sm, paddingTop: space.md },
});

const row = StyleSheet.create({
	root: { gap: space.sm, padding: space.md },
	meta: { alignItems: "center", flexDirection: "row", gap: space.xs },
	metrics: { flexDirection: "row", gap: space.lg },
	metric: { gap: space.px },
});
