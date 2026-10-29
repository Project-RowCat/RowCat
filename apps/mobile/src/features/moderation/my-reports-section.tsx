import {
	MY_REPORT_STATE_LABEL,
	type MyReportDto,
	REPORT_REASON_LABEL,
	REPORT_TARGET_LABEL,
} from "@rowcat/contracts";
import { space } from "@rowcat/design";
import {
	MY_REPORTS_QUERY_KEY,
	myReportsInfiniteQueryOptions,
} from "@rowcat/query";
import { Badge, Button, Notice, Separator, Text } from "@rowcat/ui-native";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { formatDate } from "../../lib/format.ts";
import { AnimatedLabel } from "../../lib/motion/animated-label.tsx";
import { AccountSection } from "../account/account-section.tsx";
import {
	MY_REPORTS_DESCRIPTION,
	MY_REPORTS_EMPTY,
	MY_REPORTS_FAILED,
	MY_REPORTS_LOADING_LABEL,
	MY_REPORTS_MORE_LABEL,
	MY_REPORTS_OFFLINE,
	MY_REPORTS_RETRY_LABEL,
	MY_REPORTS_STALE,
	MY_REPORTS_TITLE,
	reportReviewedNote,
	reportSubmittedNote,
} from "./moderation-copy.ts";
import { myReportsPanelView, myReportTitle } from "./my-reports-state.ts";

/**
 * The **`My reports` section** on the account screen: "filed / still under review / reviewed".
 *
 * After filing, the report window says "filed" once and closes. Without anything after that, the
 * user has no question left to ask days later. This list is that **persistent receipt**. It has the
 * same meaning as the web `my-reports-section.tsx`, with a different rendering.
 *
 * ## Why it is kept apart from the `Restrictions` section
 *
 * The section right above is about **what happened to me** (restrictions, actions, appeals), and
 * this one is about **what I requested**. The axes are opposite. Mixing them in one section means
 * someone checking a sanction also reads the list of reports they filed, and those two lists are
 * not each other's context.
 *
 * ## Rows have no actions
 *
 * There is no withdraw, edit, reopen, open-target or overflow menu, and no disabled placeholders. A
 * report leaves the reporter's hands once filed, and the target id is not carried in the response
 * (a link would turn this list into a tool for asking "is that work still there?"). There is no
 * processing deadline either, because no promised deadline exists in this product.
 *
 * ## The order of the five states lives in a pure function (`my-reports-state.ts`)
 *
 * Nothing is drawn during the first query. Most people have never filed a report, and a skeleton
 * that vanishes soon makes the account screen flicker and tells nothing. Conversely **failure is
 * not hidden**: removing the whole section would make a person who filed a report unable to tell it
 * from "my reports disappeared". Failure stays inside this section (profile and security keep
 * working), and it is said.
 *
 * ## Retry on a stalled query
 *
 * With no held value, retry restarts **only this query** from scratch (`resetQueries` with `exact:
 * true`, the same wiring as the three cells of the security section; on a stalled query `refetch()`
 * creates no request). Do not discard the whole moderation prefix, or a sibling section's (`Restrictions`)
 * value would go with it. With a held value, leave it and refetch normally.
 */
export function MyReportsSection() {
	const queryClient = useQueryClient();
	const query = useInfiniteQuery(
		myReportsInfiniteQueryOptions(getRowCatClient()),
	);

	const reports = query.data?.pages.flatMap((page) => page.items) ?? [];
	const view = myReportsPanelView({
		isPaused: query.isPaused,
		isError: query.isError,
		isPending: query.isPending,
		hasData: query.data !== undefined,
		reportCount: reports.length,
	});

	const retry = useCallback(() => {
		if (query.data === undefined) {
			void queryClient.resetQueries({
				queryKey: MY_REPORTS_QUERY_KEY,
				exact: true,
			});
			return;
		}
		void query.refetch();
	}, [query.data, query.refetch, queryClient]);

	/** Takes no space during the first query, for the reason in the header above. */
	if (view.state === "loading") return null;

	return (
		<AccountSection
			title={MY_REPORTS_TITLE}
			description={MY_REPORTS_DESCRIPTION}
		>
			{view.state === "offline" ? (
				/** Stall and failure are said differently: the first needs waiting, the second needs pressing again. */
				<Notice
					message={MY_REPORTS_OFFLINE}
					actionLabel={MY_REPORTS_RETRY_LABEL}
					onAction={retry}
					busy={query.isFetching}
				/>
			) : view.state === "error" ? (
				/**
				 * **Do not draw this as an empty list.** "You haven't filed any reports" is a fact we cannot know, and for
				 * someone who filed a report that sentence means their report is gone.
				 */
				<Notice
					tone="destructive"
					message={MY_REPORTS_FAILED}
					actionLabel={MY_REPORTS_RETRY_LABEL}
					onAction={retry}
					busy={query.isFetching}
				/>
			) : view.state === "empty" ? (
				<Text variant="label" tone="muted-foreground">
					{MY_REPORTS_EMPTY}
				</Text>
			) : (
				<View>
					{reports.map((report, index) => (
						<Fragment key={report.id}>
							{index === 0 ? null : <Separator />}
							<MyReportRow report={report} />
						</Fragment>
					))}
				</View>
			)}

			{/**
			 * Shown only when a background refresh failed or stalled. The rows stay and only the retry path
			 * is attached: covering the held list with an error box loses data and gains nothing. **Also shown
			 * on an empty list**: a 0 the server confirmed is also a held value, and if the later refresh
			 * failed, the staleness of that axis is the same as when rows exist.
			 */}
			{(view.state === "ready" || view.state === "empty") && view.retryable ? (
				<View style={panel.stale}>
					<Text variant="caption" tone="muted-foreground">
						{MY_REPORTS_STALE}
					</Text>
					<Button
						label={
							query.isFetching
								? MY_REPORTS_LOADING_LABEL
								: MY_REPORTS_RETRY_LABEL
						}
						variant="outline"
						size="sm"
						disabled={query.isFetching}
						onPress={retry}
					/>
				</View>
			) : null}

			{/**
			 * `Show more` exists and infinite scroll does not: account history is not discovery. With no next page,
			 * there is no dead button.
			 */}
			{query.hasNextPage ? (
				<View style={panel.more}>
					<Button
						label={
							query.isFetchingNextPage
								? MY_REPORTS_LOADING_LABEL
								: MY_REPORTS_MORE_LABEL
						}
						variant="outline"
						size="sm"
						busy={query.isFetchingNextPage}
						disabled={query.isFetchingNextPage}
						onPress={() => void query.fetchNextPage()}
					/>
				</View>
			) : null}
		</AccountSection>
	);
}

/**
 * One row, and **there is nothing to press.**
 *
 * There is no link and no menu. A destination would need a target id, which is not in the response,
 * and an action would need withdrawal or editing, which do not exist. The list answers one question
 * (what state is it in now), and the answer ends with reading the row.
 *
 * The status is not conveyed by colour alone: the **text** inside the badge is the status
 * (`MY_REPORT_STATE_LABEL`). `variant` is only emphasis, and the two never differ in value.
 */
function MyReportRow({ report }: { report: MyReportDto }) {
	const submitted = formatDate(report.createdAt);
	const reviewed = report.reviewedAt ? formatDate(report.reviewedAt) : null;

	return (
		<View style={line.root}>
			<View style={line.body}>
				<Text variant="body">
					{myReportTitle(report, {
						target: REPORT_TARGET_LABEL,
						reason: REPORT_REASON_LABEL,
					})}
				</Text>
				{/**
				 * Time has two axes: when it was filed, and (if finished) when it finished. An in-review row does
				 * not leave an empty slot such as `Reviewed: —`.
				 */}
				<Text variant="caption" tone="muted-foreground">
					{[
						submitted ? reportSubmittedNote(submitted) : null,
						reviewed ? reportReviewedNote(reviewed) : null,
					]
						.filter(Boolean)
						.join(" · ")}
				</Text>
			</View>
			{/**
			 * The status word **changes in place.** When the operator closes a report, this row changes from
			 * `Under review` to `Reviewed`. If that change happened silently during the re-query, the fact that the
			 * list was refreshed would be invisible (the web's same row uses the same rhythm).
			 *
			 * The row does **not move on first draw**: that is not a value changing, it is the list arriving
			 * (`lib/motion/animated-label.tsx`).
			 */}
			<AnimatedLabel value={report.state}>
				<Badge
					label={MY_REPORT_STATE_LABEL[report.state]}
					variant={report.state === "reviewed" ? "secondary" : "outline"}
				/>
			</AnimatedLabel>
		</View>
	);
}

const panel = StyleSheet.create({
	stale: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
	},
	more: { alignItems: "flex-start" },
});

const line = StyleSheet.create({
	root: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: space.sm,
		paddingVertical: space.md,
	},
	body: { flex: 1, gap: space.px, minWidth: 0 },
});
