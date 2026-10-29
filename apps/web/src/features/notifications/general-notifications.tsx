import { Button } from "@rowcat/ui-web/components/button";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { translator } from "#/lib/i18n/current.ts";
import { enterTransition, exitTransition } from "#/lib/motion/transitions.ts";
import { type RetrySurface, StaleNotice } from "#/lib/query/stale-notice.tsx";
import { MarkAllReadSlot } from "./mark-all-read-slot.tsx";
import { notificationUnreadSummary } from "./notification-copy.ts";
import {
	NotificationRow,
	NotificationRowSkeleton,
} from "./notification-row.tsx";
import { notificationPanelView } from "./notifications-state.ts";
import { useNotifications } from "./use-notifications.ts";

/**
 * Values are shown, but the last refresh failed, with or without rows. The copy says `state`,
 * not `notifications`, for this reason. The banner also appears when the server answered 0.
 * Then `showing previously received notifications` would contradict an
 * empty list. Likewise `no latest notifications` cannot be used, because whether the
 * data is current is exactly what is unknown.
 */
const notificationsStaleMessage = (): string =>
	translator("notifications")("stale");

/**
 * The `General` tab: the server-owned inbox, with query and cache policy unchanged from before the tabs
 * were added. It reads the same cache as the popover (`useNotifications`), so marking items read
 * here would drop the header badge in the same frame.
 *
 * No second sidebar: no type tabs, read/unread filter or search. Inside the inbox it stays one
 * time-ordered list. `Mark all read` and the unread summary live in this tab, not beside the page title, so
 * they do not describe another tab's list.
 *
 * Rows form one continuous divided surface rather than separate cards, so the marker, text and time
 * align down a column. The list uses a `Show more` button instead of infinite scroll, because
 * notifications are account history and users need to know how far they have read.
 */
export function GeneralNotifications() {
	const { t } = useTranslation(["notifications", "common"]);
	const { items, list, retry, unreadCount, markAllRead, activate } =
		useNotifications();

	/**
	 * What to draw is chosen by a pure function (`notifications-state.ts`). The component used to
	 * check `isPending`, then `isError`, then the empty list, and both checks were wrong. A paused
	 * query (offline) read as loading and became a placeholder that never ended. One failed background
	 * refresh replaced a list with rows by an error box.
	 */
	const panel = notificationPanelView({
		isPaused: list.isPaused,
		isError: list.isError,
		isPending: list.isPending,
		hasData: list.data !== undefined,
		itemCount: items.length,
	});

	const unreadSummary = notificationUnreadSummary(unreadCount);

	return (
		<section aria-label={t("listLabel")} className="flex flex-col gap-4">
			<div className="flex min-h-8 items-start gap-3">
				{/*
				 * A quiet single line, not a metric (§13). No box and no large number.
				 * An unknown count draws nothing. The rule lives in `notificationUnreadSummary` alone.
				 * It sits in a presence wrapper, like `Mark all read`, so its disappearance reads as the result
				 * of the action. The wrapper keeps a minimum height so the list does not jump when both
				 * pieces vanish together.
				 */}
				<AnimatePresence initial={false}>
					{unreadSummary && (
						<m.p
							className="text-sm text-muted-foreground"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0, transition: exitTransition }}
							transition={enterTransition}
						>
							{unreadSummary}
						</m.p>
					)}
				</AnimatePresence>
				{/*
				 * The timing of the disappearance and the press protection during exit belong to the slot
				 * (`mark-all-read-slot.tsx`).
				 */}
				<MarkAllReadSlot visible={!!unreadCount} className="ml-auto shrink-0">
					<Button
						variant="outline"
						size="sm"
						disabled={markAllRead.isPending}
						onClick={() => markAllRead.mutate()}
					>
						{t("markAllRead")}
					</Button>
				</MarkAllReadSlot>
			</div>

			{panel.state === "offline" && (
				<NotificationsNotice
					tone="offline"
					title={t("offlineTitle")}
					/*
					 * Does not render as an empty inbox. No connection does not mean there are no notifications.
					 * That zero is a fact this screen cannot know.
					 */
					detail={t("offlineDetail")}
					isRetrying={list.isFetching}
					onRetry={retry}
				/>
			)}

			{panel.state === "error" && (
				<NotificationsNotice
					tone="error"
					title={t("loadFailedTitle")}
					/*
					 * Says nothing about notifications already held. This state appears only when no values are
					 * held, so the screen cannot know whether the inbox has 0 or 300 items. The earlier copy
					 * `your received notifications are still there` asserted an unverified fact. It
					 * is true only in the stale-banner case, where values are held.
					 */
					detail={t("loadFailedDetail")}
					isRetrying={list.isFetching}
					onRetry={retry}
				/>
			)}

			{panel.state === "loading" && <NotificationsSkeleton />}

			{/* No large illustration for an empty list. A single line is enough (§117). */}
			{panel.state === "empty" && (
				<>
					{/*
					 * An empty list is also a held value. If a refresh fails or is interrupted after the server
					 * answered 0, that 0 is still server-confirmed but may not be current. That is exactly the
					 * same fact as a failure with rows, so it uses the same banner.
					 */}
					{panel.retryable && (
						<StaleNotice
							message={notificationsStaleMessage()}
							isRetrying={list.isFetching}
							onRetry={retry}
						/>
					)}

					<p className="py-10 text-sm text-muted-foreground">{t("empty")}</p>
				</>
			)}

			{panel.state === "ready" && (
				<>
					{/*
					 * Rows are still drawn, but the last refresh failed or was interrupted.
					 * Instead of clearing the list, only a retry path is added.
					 * The rows are still server-confirmed; the only changed fact is that they may not be current.
					 */}
					{panel.retryable && (
						<StaleNotice
							message={notificationsStaleMessage()}
							isRetrying={list.isFetching}
							onRetry={retry}
						/>
					)}

					<ul className="divide-y border-y">
						{items.map((notification) => (
							<NotificationRow
								key={notification.id}
								notification={notification}
								surface="page"
								onActivate={() => activate(notification)}
							/>
						))}
					</ul>
				</>
			)}

			{list.hasNextPage && (
				<div className="flex justify-center">
					<Button
						variant="outline"
						size="sm"
						disabled={list.isFetchingNextPage}
						onClick={() => void list.fetchNextPage()}
					>
						{list.isFetchingNextPage ? t("loading") : t("showMore")}
					</Button>
				</div>
			)}
		</section>
	);
}

/**
 * A single surface for the two states that cannot draw any rows: paused and error.
 *
 * The two carry different weight. An error uses role="alert" and destructive color, because it
 * replaces the placeholder and users not looking at the screen must learn that the wait has ended.
 * Paused (offline) is a wait, not a fault, so it gets a quiet box. The browser already knows there
 * is no connection; painting that red like a server fault would make real failures harder to read.
 * The analytics panel (`creator-analytics.tsx`) uses the same structure and shape.
 */
function NotificationsNotice({
	tone,
	title,
	detail,
	isRetrying,
	onRetry,
}: {
	tone: "offline" | "error";
	title: string;
	detail: string;
} & RetrySurface) {
	const { t } = useTranslation(["notifications", "common"]);
	const failed = tone === "error";
	return (
		<div
			{...(failed ? { role: "alert" } : {})}
			className={
				failed
					? "rounded-lg border border-destructive/40 bg-destructive/5 p-4"
					: "rounded-lg border p-4"
			}
		>
			<p
				className={
					failed
						? "text-sm font-medium text-destructive"
						: "text-sm font-medium"
				}
			>
				{title}
			</p>
			<p className="mt-1 text-sm text-muted-foreground">{detail}</p>
			<Button
				size="sm"
				variant="outline"
				className="mt-3"
				disabled={isRetrying}
				onClick={onRetry}
			>
				{isRetrying ? t("loading") : t("common:actions.retry")}
			</Button>
		</div>
	);
}

/**
 * Four placeholder rows. Drawing a full page of 20 would make the screen jump when data arrives.
 * Row geometry belongs to `NotificationRowSkeleton`, next to the real row, so both change together.
 * The dividers match the real list (`divide-y border-y`) for the same reason: without them the
 * screen would re-flow when the values arrive.
 */
function NotificationsSkeleton() {
	const { t } = useTranslation("notifications");
	return (
		<>
			{/*
			 * Follows the same pattern as placeholders in other sections: loading is announced by one
			 * sr-only status line.
			 */}
			<output className="sr-only">{t("loadingNotifications")}</output>
			<ul aria-hidden="true" className="divide-y border-y">
				{[0, 1, 2, 3].map((index) => (
					<NotificationRowSkeleton key={index} surface="page" />
				))}
			</ul>
		</>
	);
}
