import { borderWidth, space } from "@rowcat/design";
import { Badge, Button, Notice, Text, useTheme } from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { useMobileLocalScope } from "../../lib/local-data/scope.tsx";
import { AccountShortcut } from "../account/account-shortcut.tsx";
import { NotificationShortcut } from "../notifications/notification-shortcut.tsx";
import { AppearanceShortcut } from "../settings/appearance-shortcut.tsx";

/**
 * Header of the discover screen. It is the identity slot: not a navigation slot, and not a balance
 * slot.
 *
 * ```text
 * before                                       now
 * [☰]        🔔 🐟 1,200 ⚙ [`Account`]            🔔 [`Account`]
 *  │             │        │                     │
 *  │             │        └ settings            └ only the two needed often on this screen remain
 *  │             └ balance
 *  └ global navigation
 * ```
 *
 * ## Three items were removed, each for a different reason
 *
 * ```text
 * ☰ drawer trigger   the bottom navigation row took the first-level moves. Only one global navigation
 *                    surface stands at a time (`primary-nav.tsx`). Opening a conversation from discover
 *                    was two presses before (trigger · row) and still is (`Conversations` · row), so nothing was lost.
 * 🐟 balance         a read-only value, not an action. It resized the right cluster each time the value
 *                    arrived. It went away with the payment features in the public build (`docs/oss/PLAN.md`).
 * ⚙ settings         answers "does it call me from any screen" only weakly: it is a place you visit briefly,
 *                    so it folded into the account menu (`features/account/account-shortcut.tsx`).
 * ```
 *
 * The test for the two that remain is the same: does it call me while I look at this screen?
 * Notifications do (the unread count changes here). Account is this row's anchor, and the place
 * where the guest and unconfirmed branches live.
 *
 * ## Identity stays here
 *
 * Login, the account menu, session checks, and device-data notices do not move. Navigation answers
 * "where can I go"; this row answers "who am I now". The existence of a bottom row is not grounds
 * to merge the two.
 *
 * ## This bar is not an `AppBar`, and that is intended
 *
 * Discover is a single virtualized list, so the header scrolls with the list inside
 * `ListHeaderComponent` (other screens' `AppBar` stays fixed above the list). It draws the same
 * kind of area but behaves differently, so its geometry differs: horizontal padding must match the
 * grid (`space.lg`), and the hint line below rides along with it.
 *
 * ## This is the only place identity is read
 *
 * The canvas below (gallery, works) draws regardless of identity. Only the header splits into four
 * states, and the split does not replace the canvas: an unverifiable session does not hide public
 * works.
 *
 * ```text
 * booting        neutral placeholder; no login button is drawn for a frame
 * guest          [`Sign in`]
 * authenticated  [account menu] — account · settings · sign out
 * unavailable    [`Check session`] — **not** a sign-out, and not a login
 * ```
 *
 * Not drawing login during `booting` is the least visible rule. For someone already signed in, that
 * flicker reads as their session vanishing. `unavailable` is on the same axis: the stored session
 * is still there, and we merely could not ask, so the only thing that state can do is ask again,
 * not sign in.
 */
export function AppHeader({
	returnPath,
}: {
	/**
	 * The in-app path to return to after login. The screen builds it and passes it in; if the header
	 * asked the router for the current location, the discover screen would lose its search and filter
	 * parameters.
	 */
	returnPath: string;
}) {
	const identity = useMobileIdentity();
	const scope = useMobileLocalScope();
	const router = useRouter();
	const theme = useTheme();
	const { phase } = identity.session;

	return (
		<View style={header.root}>
			<View
				style={[header.bar, { borderBottomColor: theme.colors.border }]}
				/** The header is the head of the list, not part of it; screen readers announce it that way. */
				accessibilityRole="header"
			>
				<View style={header.actions}>
					{/**
					 * Notification bell: the global utility in the shell. Whether it draws for members is decided
					 * by the component itself (guests have no inbox concept at all).
					 *
					 * **The only icon that survives in this row.** The test was: does it call me while I look at
					 * this screen? The bell does (the unread count changes here). The balance and settings did not
					 * pass that test, and they folded into the account menu (see the table above).
					 */}
					<NotificationShortcut />

					{/**
					 * Appearance trigger: draws **only while the user is not a member**. The settings screen is
					 * reachable only by signed-in people, so without this a guest could not change the appearance
					 * inside the app at all. The value is one on-device store, so it persists across login.
					 */}
					<AppearanceShortcut />

					{phase === "guest" ? (
						<Button
							label="Sign in"
							size="sm"
							icon="sign-in"
							onPress={() => {
								identity.clearFailure();
								router.push({
									pathname: "/login",
									params: { redirect: returnPath },
								});
							}}
						/>
					) : phase === "authenticated" ? (
						/**
						 * Account menu: the global utility in the shell and this row's anchor. Account, settings, and
						 * sign-out all live in this one menu, and the nickname is carried by the menu's accessible
						 * name (`account-shortcut.tsx`).
						 */
						<AccountShortcut />
					) : phase === "unavailable" ? (
						/**
						 * **Not a sign-out.** This touches neither the cookie nor the local database, and it does not
						 * send the user to login. Failing to reach the server does not mean the user signed out.
						 */
						<Button
							label="Check session"
							variant="outline"
							size="sm"
							icon="retry"
							onPress={identity.retry}
						/>
					) : (
						/**
						 * `booting`: reserve the slot only. If it were left empty, the header height would change
						 * when identity resolves and the list would jump once.
						 */
						<Badge label="Checking" />
					)}
				</View>
			</View>

			{/**
			 * **The screen's name: the same place and weight as the web's `<h1>`.**
			 *
			 * ⚠️ For a while this slot was empty and the brand stood in the header instead. The web does the
			 * reverse: the brand sits inside the drawer (the first line of `app-sidebar.tsx`), the header has no
			 * title, and the screen name is the first line of the canvas, styled `text-2xl font-black
			 * tracking-tight`. Putting the brand in two places repeats the same word twice each time the drawer
			 * opens, and above all the app had no line saying which screen you were on.
			 *
			 * `weight="black"` is that weight: a destination screen's title is one step heavier than a utility
			 * screen's title (`bold`), and the web keeps that difference in its classes.
			 */}
			<Text variant="display" weight="black" style={header.title}>
				Discover
			</Text>

			{/**
			 * That device data did not open is stated as **a single bounded line**.
			 *
			 * The reason this whole screen is not turned into an error is the point of this slice: discover and
			 * works read only server state, so they work without SQLite. Conversations do live in that store,
			 * so this line says that conversations cannot be opened, not that works cannot be viewed.
			 */}
			{phase === "authenticated" && scope.status === "error" ? (
				<Notice
					message="Couldn't open this device's data. Viewing stories isn't affected."
					actionLabel="Try again"
					onAction={scope.retry}
					style={header.notice}
				/>
			) : null}
		</View>
	);
}

const header = StyleSheet.create({
	root: { gap: space.md },
	/** The title sits on the same horizontal margin as the grid, matching the web canvas margin. */
	title: { paddingHorizontal: space.lg },
	/**
	 * The bottom border separates header from canvas: the same signal as the web shell header. The
	 * list must be visible scrolling in beneath it.
	 *
	 * ⚠️ `justifyContent` was removed here. When the drawer trigger moved to the bottom row, this
	 * band's only child became one control group, and `space-between` only means something with two or
	 * more children. Right alignment is done by that group's `marginLeft: "auto"`; writing it in both
	 * places means one goes stale.
	 */
	bar: {
		alignItems: "center",
		borderBottomWidth: borderWidth,
		flexDirection: "row",
		gap: space.sm,
		paddingBottom: space.md,
		paddingHorizontal: space.lg,
		paddingTop: space.xs,
	},
	/**
	 * **This group can shrink.** React Native's default `flexShrink` is **0** (unlike web CSS), so
	 * this is a real rule, not documentation. A group that cannot shrink leaves the excess at
	 * accessibility font sizes with nowhere to go, and that excess **overflows as-is** (for a while
	 * `Sign out` was clipped at the right edge).
	 *
	 * Even with no sibling in this row now, the rule stays because of the children: the guest branch's
	 * `Sign in` and `Check session` are labeled buttons that do not shrink on their own.
	 */
	actions: {
		alignItems: "center",
		flexDirection: "row",
		flexShrink: 1,
		/**
		 * **It wraps when it can no longer shrink.** Buttons do not shrink (RN's default), which is how
		 * their labels stay intact: a clipped label is worse than a missing one. At default sizes nothing
		 * overflows, so nothing changes; only at overflowing sizes do the controls drop to a second line.
		 */
		flexWrap: "wrap",
		gap: space.sm,
		justifyContent: "flex-end",
		marginLeft: "auto",
		minWidth: 0,
	},
	notice: { marginHorizontal: space.lg },
});
