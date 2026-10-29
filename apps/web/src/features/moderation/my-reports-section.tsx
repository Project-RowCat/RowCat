import { type MyReportDto, ReportReason } from "@rowcat/contracts";
import {
	MY_REPORTS_QUERY_KEY,
	myReportsInfiniteQueryOptions,
} from "@rowcat/query";
import { Badge } from "@rowcat/ui-web/components/badge";
import { Button } from "@rowcat/ui-web/components/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { AccountSection } from "#/features/account/account-shell.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { formatDate } from "#/lib/format/date-time.ts";
import { labelSwapIn, labelSwapOut } from "#/lib/motion/label-swap.ts";
import { usePanelRetry } from "#/lib/query/panel-retry.ts";
import {
	type MyReportLabels,
	myReportsPanelView,
	myReportTitle,
} from "./my-reports-state.ts";

/**
 * The `My reports` section of the account screen.
 * - Acts as a persistent receipt. The report dialog says "received" once and disappears; this
 *   list lets the user check later whether a report is in review or finished. Reporters are not
 *   notified on submission.
 * - Kept apart from the sanctions section above. That one covers what happened to the user; this
 *   one covers what the user requested.
 * - Deliberately absent: withdrawal, editing, reason changes, dispositions (dismissed, actioned),
 *   links to the reported target (the response has no target id, and a link would reveal whether
 *   the work still exists), promised handling deadlines (none exist in the product), and operator
 *   messages.
 * - Five states, ordered by myReportsPanelView: loading, offline, error, empty, ready. Empty must
 *   stay distinct from error.
 */
export function MyReportsSection() {
	const { t } = useTranslation(["moderation", "common"]);
	const query = useInfiniteQuery(
		myReportsInfiniteQueryOptions(getRowCatClient()),
	);
	const retry = usePanelRetry(MY_REPORTS_QUERY_KEY, query);

	const reports = query.data?.pages.flatMap((page) => page.items) ?? [];
	const view = myReportsPanelView({
		isPaused: query.isPaused,
		isError: query.isError,
		isPending: query.isPending,
		hasData: query.data !== undefined,
		reportCount: reports.length,
	});

	/**
	 * Draws nothing during the first fetch, as the header explains. A placeholder that appears and
	 * vanishes on every visit would only signal instability.
	 */
	if (view.state === "loading") return null;

	return (
		<AccountSection
			title={t("myReports.title")}
			description={t("myReports.description")}
		>
			{view.state === "offline" ? (
				/*
				 * Pause and failure are reported separately. Pause waits (the list resumes when the connection
				 * returns); failure needs a manual retry. One message would make an offline user think
				 * something broke. The wording follows the other sections' pause notices.
				 */
				<PanelNotice
					message={t("myReports.offline")}
					onRetry={retry}
					retrying={query.isFetching}
				/>
			) : view.state === "error" ? (
				/*
				 * Never render an empty list here. "No reports submitted" is a fact the screen cannot know, and
				 * to someone who filed a report it would read as the report having been lost.
				 */
				<PanelNotice
					message={t("myReports.loadFailed")}
					onRetry={retry}
					retrying={query.isFetching}
					alert
				/>
			) : view.state === "empty" ? (
				<p className="text-sm text-muted-foreground">{t("myReports.empty")}</p>
			) : (
				<ul className="flex flex-col divide-y rounded-lg border">
					{reports.map((report) => (
						<MyReportRow key={report.id} report={report} />
					))}
				</ul>
			)}

			{/*
			 * Shown only when a background refresh fails or is interrupted. Rows stay and only the retry is
			 * added,
			 * because covering held data with an error box loses information for nothing.
			 * This also applies to an empty list: the server-confirmed zero is data too, and after a failed
			 * refresh its
			 * freshness is unknown just as it is for rows (the notification surface makes the same call).
			 */}
			{(view.state === "ready" || view.state === "empty") && view.retryable && (
				<div className="mt-3 flex items-center gap-3">
					<p className="text-xs text-muted-foreground">
						{t("myReports.refreshFailed")}
					</p>
					<Button
						variant="outline"
						size="sm"
						disabled={query.isFetching}
						onClick={retry}
					>
						{query.isFetching
							? t("myReports.loading")
							: t("common:actions.retry")}
					</Button>
				</div>
			)}

			{/*
			 * "Load more" rather than infinite scroll: account history is for reference, not discovery, as in
			 * the
			 * notification list. For the same reason, appended rows get no entrance animation.
			 */}
			{query.hasNextPage && (
				<div className="mt-3">
					<Button
						variant="outline"
						size="sm"
						disabled={query.isFetchingNextPage}
						onClick={() => void query.fetchNextPage()}
					>
						{query.isFetchingNextPage
							? t("myReports.loading")
							: t("myReports.showMore")}
					</Button>
				</div>
			)}
		</AccountSection>
	);
}

/**
 * A one-line notice with a `Try again` button, contained within the section. role="alert" is
 * only for failures: waiting for a connection is already known to the user, and announcing it would
 * interrupt screen reader flow. Overusing the role would make real failures sound like everything
 * else.
 */
function PanelNotice({
	message,
	onRetry,
	retrying,
	alert,
}: {
	message: string;
	onRetry: () => void;
	/** Locks the button while a refetch runs, so two presses cannot start overlapping refetches. */
	retrying?: boolean;
	alert?: boolean;
}) {
	const { t } = useTranslation(["moderation", "common"]);
	return (
		<div className="flex flex-wrap items-center gap-3">
			<p
				{...(alert ? { role: "alert" } : {})}
				className={`text-sm ${alert ? "text-destructive" : "text-muted-foreground"}`}
			>
				{message}
			</p>
			<Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
				{retrying ? t("myReports.loading") : t("common:actions.retry")}
			</Button>
		</div>
	);
}

/**
 * A row with nothing to press. A link needs a target id the response does not carry, and an action
 * needs withdraw or edit, which do not exist. The row answers one question: the current state.
 */
function MyReportRow({ report }: { report: MyReportDto }) {
	const { t } = useTranslation("moderation");
	const reviewed = report.state === "reviewed";
	return (
		<li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4">
			<div className="flex min-w-0 flex-col gap-1">
				<p className="text-sm font-medium break-words">
					{myReportTitle(report, {
						target: {
							story: t("target.story"),
							comment: t("target.comment"),
							member: t("target.member"),
							ai_response: t("target.ai_response"),
						},
						reason: Object.fromEntries(
							ReportReason.options.map((reason) => [
								reason,
								t(`reason.${reason}`),
							]),
						) as MyReportLabels["reason"],
					})}
				</p>
				{/*
				 * Two time values: when the report was filed, and when it finished, if it did. A row still under
				 * review
				 * shows no empty "reviewed: —" slot.
				 */}
				<p className="text-xs text-muted-foreground">
					<time dateTime={report.createdAt}>
						{t("myReports.filed", { date: formatDate(report.createdAt) })}
					</time>
					{report.reviewedAt && (
						<>
							{" · "}
							<time dateTime={report.reviewedAt}>
								{t("myReports.reviewed", {
									date: formatDate(report.reviewedAt),
								})}
							</time>
						</>
					)}
				</p>
			</div>
			{/*
			 * State is never conveyed by color alone: the badge text is the state (`myReports.state`).
			 * `variant`
			 * only adds emphasis and never distinguishes two states.
			 */}
			<AnimatePresence initial={false} mode="wait">
				<m.span
					key={report.state}
					initial={labelSwapIn.initial}
					animate={labelSwapIn.animate}
					exit={labelSwapOut}
					transition={labelSwapIn.transition}
					className="inline-flex"
				>
					<Badge variant={reviewed ? "secondary" : "outline"}>
						{t(`myReports.state.${report.state}`)}
					</Badge>
				</m.span>
			</AnimatePresence>
		</li>
	);
}
