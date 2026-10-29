import { refreshNotifications } from "@rowcat/query";
import { AppBar, Screen } from "@rowcat/ui-native";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { AppSidebarTrigger } from "../shell/app-sidebar.tsx";
import { ShellUtilities } from "../shell/shell-utilities.tsx";
import { UpdateNotesList } from "../updates/update-notes-list.tsx";
import { GeneralNotifications } from "./general-notifications.tsx";
import {
	NOTIFICATIONS_TITLE,
	type NotificationsTab,
} from "./notification-copy.ts";
import { NotificationsTabs } from "./notifications-tabs.tsx";

/**
 * The notifications screen at `/notifications`. It is a container with two tabs.
 *
 * ```text
 * Notifications
 * [ General   Updates ● ]
 *
 * General    Notification[] owned by the server; read state and the unread count live there
 * Updates    UpdateNote[] shipped by the repository; the read record is a device key-value store
 * ```
 *
 * ## Composing two surfaces is not merging their domains
 *
 * This screen only composes. `NotificationKind` gained no value, the notification DTO carries no
 * release information, and the unread count still counts server notifications only. The reverse
 * holds too: the update slice knows neither `useNotifications` nor the read mutations (checked by
 * `features/updates/updates-boundaries.test.ts`).
 *
 * ## The update tab does not wait on identity or queries
 *
 * Putting both tabs inside the state branch is the natural mistake. One condition does it and the
 * screen still looks plausible, but that condition also hides release history for guests, during
 * booting, offline, after a failed lookup, and with an empty inbox. Nothing justifies that: release
 * notes are content the repository shipped, and the read record is a device value.
 *
 * ```text
 * guest · booting · offline · failed lookup · empty inbox  →  the update tab still opens
 * ```
 *
 * So identity and query state branch **inside** the general tab (`GeneralNotifications`).
 *
 * ## The default tab is `general`
 *
 * A new note does not switch tabs. Switching would turn the dot from an indicator into an
 * interruption, which is why the startup window was removed. The person chooses to open it.
 *
 * ## Tabs are not addressed by URL
 *
 * There is no `/notifications/updates` and no query parameter. The two are surfaces one screen
 * composes, not an axis inside the inbox, and an address would immediately demand its own route,
 * cache and empty state. The web has `?tab=updates` because its header popover has a "view all
 * updates" link that must land on that tab. This app's shortcut is a single navigation with no
 * popover, so that link does not exist. If it appears, this screen changes with it.
 *
 * ## Opening is not reading
 *
 * Focusing the screen refetches stale values but marks nothing as read. The effect belongs to the
 * screen, not the tab, so switching tabs does not re-trigger it. Otherwise every tab switch would
 * call the server.
 */
export function NotificationsScreen() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { session } = useMobileIdentity();
	const authenticated = session.phase === "authenticated";

	const [tab, setTab] = useState<NotificationsTab>("general");

	/**
	 * Refetch stale values on every focus, not just on mount. Native stacks do not remount a screen
	 * when the user returns to it, so a mount-only effect would show a snapshot from the second visit
	 * onward. This refreshes; it does not mark anything as read.
	 */
	useFocusEffect(
		useCallback(() => {
			if (authenticated) void refreshNotifications(queryClient);
		}, [authenticated, queryClient]),
	);

	return (
		<Screen>
			{/**
			 * The drawer and back appear together, since this screen both receives pushes and needs global navigation.
			 * The title is owned by this bar alone, so the canvas does not repeat it (the same rule as the chat list).
			 * The bell stays on, with its active state: a utility sits in the same place on every screen. Dropping it
			 * only here would make that meaning shift from screen to screen.
			 */}
			<AppBar
				navigation={<AppSidebarTrigger />}
				title={NOTIFICATIONS_TITLE}
				onBack={() => router.back()}
				actions={<ShellUtilities />}
			/>

			{/**
			 * Read-state storage is not on this screen. The app root owns it (`app/_layout.tsx`), and this screen only
			 * reads the value. The dot on the tabs and the dot in the history see the same value, so opening the latest
			 * note clears both together, and the header bell clears in the same frame (its shortcut lives outside this
			 * screen). If the store lived here, only the shortcut would go stale, and that mismatch would persist until
			 * the app restarted.
			 *
			 * The update tab's dot shows even when that tab was never opened, because the tab row reads a single
			 * boolean and does not render the history.
			 */}
			<NotificationsTabs tab={tab} onSelect={setTab} />
			{tab === "general" ? <GeneralNotifications /> : <UpdateNotesList />}
		</Screen>
	);
}
