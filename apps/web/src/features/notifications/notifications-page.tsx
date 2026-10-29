import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@rowcat/ui-web/components/tabs";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Canvas } from "#/components/app-shell/canvas.tsx";
import { UpdateNotesList } from "#/features/updates/update-notes-list.tsx";
import { UpdateNotesUnseenDot } from "#/features/updates/update-notes-unseen-dot.tsx";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { GeneralNotifications } from "./general-notifications.tsx";
import {
	NOTIFICATIONS_TABS,
	type NotificationsTab,
	notificationsSearchForTab,
	notificationsTabFromSearch,
} from "./notifications-search.ts";

/**
 * The notifications page (`/notifications`) is a container with two tabs. It composes two surfaces
 * and owns no domain logic.
 * - `General`: server-owned notifications, including read state and the unread count.
 * - `Updates`: release notes from the repo, with read state kept in this browser's localStorage.
 *
 * The two sides stay independent. The updates slice knows nothing of `useNotifications`, and static
 * scans enforce this (`features/updates/updates-boundaries.test.ts`).
 *
 * Read state belongs to the single `UpdateNotesProvider` in the app shell
 * (`routes/(app)/route.tsx`), not to this page.
 *
 * The announcements tab must not sit behind the server query. It has to render when the inbox is
 * empty, offline, or failing. The query therefore runs inside the general tab
 * (`GeneralNotifications`).
 *
 * The tab lives in the address (`?tab=updates`), so the bell popover's `See all updates` link can land
 * on it. There is no `/notifications/updates` route, since both tabs are surfaces of one screen,
 * not separate pages.
 *
 * A new announcement never changes the default tab. Switching automatically would turn the dot into
 * an interception, which is why the startup popup was removed. The user chooses to open the tab.
 *
 * The tab label is not `Notifications`, because the page title already says that.
 */
export function NotificationsPage() {
	const { t } = useTranslation("notifications");
	const search = useSearch({ from: "/(app)/notifications/" });
	const navigate = useNavigate();
	const tab = notificationsTabFromSearch(search);

	return (
		<Canvas>
			{/*
			 * The header does not name this page; it only turns on the `utility: "notifications"` option. A
			 * canvas that renders its own h1 does not repeat the title, per the shell's rule.
			 *
			 * The reading width is bound to the title as well. Previously only the list had `max-w-3xl`, so the
			 * `Mark all read` control sat at the far right of the wide canvas without making clear what it applied to.
			 */}
			<PageEnter className="flex max-w-3xl flex-col gap-4">
				<h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>

				<Tabs
					value={tab}
					/*
					 * Tab switches are deliberate navigation, so they are recorded in history (no `replace`), and
					 * back can return to the previous tab. Serialization is done by the shared function, so
					 * `?tab=general` never leaks out from here.
					 */
					onValueChange={(next) =>
						void navigate({
							to: "/notifications",
							search: notificationsSearchForTab(next as NotificationsTab),
						})
					}
				>
					<TabsList variant="line" aria-label={t("tabsLabel")}>
						{/*
						 * The dot is decoration. The fact that there are new announcements is spoken by this button's
						 * accessible name, via the `sr-only` text in `UpdateNotesUnseenDot`. No count is shown. A count
						 * like `Updates (3)` is the inbox's vocabulary, not the release notes'.
						 */}
						<TabsTrigger value={NOTIFICATIONS_TABS[0]}>
							{t("general")}
						</TabsTrigger>
						<TabsTrigger value={NOTIFICATIONS_TABS[1]}>
							{t("updates")}
							<UpdateNotesUnseenDot />
						</TabsTrigger>
					</TabsList>

					{/*
					 * The `General` tab stays mounted. Re-querying on each switch would drop the accumulated pages and the
					 * scroll position, and a round trip longer than 30 seconds would fetch again. Switching tabs must
					 * not cause a server request.
					 */}
					<TabsContent value={NOTIFICATIONS_TABS[0]} keepMounted>
						<GeneralNotifications />
					</TabsContent>

					{/*
					 * The updates tab is the opposite. It draws repo values only, so mounting requests nothing, and
					 * there is no reason to pre-render history for users who never open it.
					 */}
					<TabsContent value={NOTIFICATIONS_TABS[1]}>
						<UpdateNotesList />
					</TabsContent>
				</Tabs>
			</PageEnter>
		</Canvas>
	);
}
