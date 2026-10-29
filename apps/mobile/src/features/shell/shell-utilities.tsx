import { space } from "@rowcat/design";
import { StyleSheet, View } from "react-native";
import { AccountShortcut } from "../account/account-shortcut.tsx";
import { NotificationShortcut } from "../notifications/notification-shortcut.tsx";
import { AppearanceShortcut } from "../settings/appearance-shortcut.tsx";

/**
 * The global utility group on the right of the header — **notification bell + account menu, in this
 * order.**
 *
 * One composition, so that each screen does not wire its own shortcuts. Several screens need them
 * (work detail, profile, chat list, notifications, account, create, settings). If each wired them
 * by hand, one screen would eventually swap the order or drop one, and that mismatch only shows
 * when moving between screens. **Account is the rightmost end** (the anchor of this row).
 *
 * ## Four became two
 *
 * ```text
 * before   🐟 balance · 🔔 notifications · ⚙ settings · [account]   four targets on every member screen
 * now      🔔 notifications · [account]                             two
 * ```
 *
 * There was one test: **does this target call me while I am looking at this screen?** Notifications
 * does (the unread count changes here). Account is the anchor of this row. The other two failed the
 * test: the balance was **read-only** (not an operation; the row's width changed as the value
 * arrived), and settings is a place you visit briefly and leave. Settings folded into the account
 * menu (which is already on this row — `features/account/account-shortcut.tsx`), and the balance
 * went away with payments in the public release (`docs/oss/PLAN.md` §3).
 *
 * **Nothing is lost.** The path to settings is in the account menu. What grew is one tap; what
 * shrank is **the two targets that stood on every screen all the time.**
 *
 * ## A third appears for guests only
 *
 * `AppearanceShortcut` has the **opposite** condition to the two above (only when not a member).
 * The settings screen is entered only by signed-in people, so without this trigger a guest could
 * not change the brightness inside the app at all. Web left a theme switch in the guest header for
 * the same reason. So this group draws at most **two icons** at once.
 *
 * ## Member checks belong to each shortcut
 *
 * Both member shortcuts remove themselves for guests or unconfirmed state, so this group does not
 * read identity. Starting to read it here would turn this file into a copy of the identity state
 * machine.
 *
 * ## No utilities on an open chat room — an intended exception
 *
 * That header is the tightest line in the app (at 320pt, four 44pt targets leave 88pt for the title
 * — `app-bar.tsx`). Instead of shrinking the targets to make room, that screen's global navigation
 * is already in the drawer. The exception is locked by value in `notification-boundaries.test.ts`
 * and `account-boundaries.test.ts`.
 *
 * The discover header (`app-header.tsx`) does not use this group either: that row shows four
 * identity states (guest, unconfirmed, checking, member) together, and inserting the group would
 * make those states unrepresentable. The same two components are set up directly, in the same
 * order, there.
 */
export function ShellUtilities() {
	return (
		<View style={utilities.row}>
			<NotificationShortcut />
			<AccountShortcut />
			{/**
			 * Stands only while not a member — the exact opposite condition of the two above. So the number of
			 * icons drawn on this row at once does not grow.
			 */}
			<AppearanceShortcut />
		</View>
	);
}

const utilities = StyleSheet.create({
	row: { alignItems: "center", flexDirection: "row", gap: space.xs },
});
