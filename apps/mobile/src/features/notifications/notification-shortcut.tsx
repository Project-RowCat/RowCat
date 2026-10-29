import { radiusScale, space } from "@rowcat/design";
import { notificationAttention } from "@rowcat/domain";
import { notificationUnreadCountQueryOptions } from "@rowcat/query";
import { controlHeight, Icon, targetSlop, useTheme } from "@rowcat/ui-native";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { getRowCatClient } from "../../lib/api.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";
import { AnimatedCount } from "../../lib/motion/animated-count.tsx";
import { mobileShellRouteFor } from "../shell/shell-route.ts";
import { useUpdateNotesUnseen } from "../updates/update-notes-unseen-dot.tsx";

/**
 * The notification bell: the one global utility in the shell. Same position and rules as the web
 * header bell.
 *
 * ## Screens only compose it
 *
 * The unread-count query, the badge, the active state and navigation all live in this file. Screens
 * mount `<NotificationShortcut />` on one line. Per-screen copies would mean five badge
 * implementations, with one of them going stale. The generic `AppBar` (@rowcat/ui-native) knows
 * nothing about notifications: it holds only geometry, and notifications are a product concept that
 * cannot cross that boundary.
 *
 * ## Not in the drawer
 *
 * The left side is a fixed product IA (discovery and conversations; see the header of
 * `app-sidebar.tsx`). Once notifications enter it, that side becomes leftover space, and settings,
 * theme, account and sign-out follow one by one. The web keeps notifications in the header
 * utilities for the same reason. A static scan guards the absence (`lib/boundaries.test.ts`).
 *
 * ## Absent for guests and while identity is unknown
 *
 * Notifications are a member's inbox, and guests have no concept of one. A disabled bell that
 * routes to login on press is not drawn. It is also not drawn while `booting` or `unavailable`: the
 * server answers an unknown account's count with 401, and that failure would turn into a silent
 * retry loop.
 *
 * ## It represents two facts and does not add them
 *
 * The destination screen has two tabs (`General` and `Updates`), each with its own pending items. Folding
 * them into one number is the shortest answer. But that line would be a `1` that `Mark all read` cannot
 * clear, since the server never created it. So the answer has two axes, and the count wins over the
 * dot:
 *
 * ```text
 * 3 unread · new update note   →  3
 * 0 unread · new update note   →  ●
 * neither                       →  nothing
 * ```
 *
 * The priority and the label assembly live in the same pure function as the web bell
 * (`notificationAttention`). If each app wrote them, the same state would be a number on one
 * platform and a dot on the other.
 *
 * ## No popover
 *
 * The web bell opens a box, but this shortcut is a single navigation. There is no sheet to match:
 * this app has no container for that interaction (the presentation capability boundary), and the
 * destination opens in one press, so a preview in front of it has no reason to exist.
 *
 * ## The count is not derived from the list
 *
 * The badge comes from a dedicated query (`notificationUnreadCountQueryOptions`; its interval and
 * freshness are shared policy). A count taken from the first 20 cached rows is always lower than
 * the truth.
 *
 * The update dot does not call the server. It is a static fact of this device (the release history
 * the repository shipped, plus the device's read record), so it still holds on the day the query
 * fails.
 *
 * ## Count failures are silent
 *
 * Only the badge disappears; the bell still works. The notification screen is the one place a
 * failure is stated. If this refresh announced its failure every time, the same message would
 * repeat every minute while offline.
 */
export function NotificationShortcut() {
	const { session } = useMobileIdentity();
	/**
	 * The gate sits outside the query. While the viewer is not a member, this component is not mounted
	 * at all, so no query object exists. That is a stronger form than turning the query off with
	 * `enabled: false`.
	 */
	if (session.phase !== "authenticated") return null;
	return <NotificationBell />;
}

function NotificationBell() {
	const router = useRouter();
	const pathname = usePathname();
	const { colors } = useTheme();

	/**
	 * Whether the notification screen is current. The judgment comes from one pure shell function
	 * (`shell-route.ts`). Writing `pathname.startsWith` here would put the route-to-shell rules in two
	 * places.
	 */
	const active = mobileShellRouteFor(pathname).utility === "notifications";

	const unreadQuery = useQuery(
		notificationUnreadCountQueryOptions(getRowCatClient()),
	);
	/** `null` until known. It is not 0, so neither the badge nor a count in the label is drawn. */
	const unread = unreadQuery.data ?? null;

	/**
	 * Whether an unseen release note exists. This is a single boolean. The history and the read record
	 * do not pass through here. The app root owns the store (`app/_layout.tsx`), so this bell and the
	 * notification screen's tabs read the same value, and the dot here clears in the same frame as the
	 * one on the screen.
	 */
	const unseenUpdate = useUpdateNotesUnseen();

	/** What to draw and what to say. The same function as the web bell decides this (see header). */
	const attention = notificationAttention({ unread, unseenUpdate });

	return (
		<Pressable
			accessibilityRole="button"
			/**
			 * The name states both conditions. The badge and the dot speak only through colour and shape,
			 * which a screen reader cannot use. The rules are a domain function (`notificationAttention`):
			 * unknown counts are not spoken, the `99+` cap is decided there, and an update note hidden
			 * behind a count still appears in the name.
			 */
			accessibilityLabel={attention.label}
			accessibilityState={{ selected: active }}
			/**
			 * `navigate`, not `push`. A global utility's job is to return to its destination, and `push`
			 * would stack a new entry on every press (the same reasoning as the drawer destinations).
			 */
			onPress={() => router.navigate("/notifications")}
			hitSlop={targetSlop(controlHeight.lg)}
			style={shortcut.root}
		>
			<View>
				<Icon
					name="notifications"
					size="lg"
					tone={active ? "foreground" : "muted-foreground"}
				/>
				{attention.badge ? (
					<View style={[shortcut.badge, { backgroundColor: colors.primary }]}>
						{/**
						 * Whether the badge appears and the count inside it changes are different events. The condition above
						 * decides the first (no box when `badge` is null). Only the number animates here, so `0 → 3` is one
						 * appearance and `3 → 4` is one change in the number, and the two never overlap (the web makes the same
						 * call). `readable={false}` because the `Pressable` label already speaks the count (`attention.label`).
						 * The badge is decoration.
						 */}
						<AnimatedCount
							value={attention.badge}
							variant="caption"
							tone="primary-foreground"
							readable={false}
						/>
					</View>
				) : null}

				{/**
				 * The dot shows only when there is no count. `notificationAttention` already guarantees that the two are
				 * exclusive (`dot` is true only when the badge is absent), so re-deriving the condition here would let them
				 * drift apart.
				 *
				 * The dot shows no number. `1` would be a lie: three pending notes still produce one mark, and a read count
				 * belongs to the inbox's vocabulary. It is smaller than the badge and does not pulse. What it says is
				 * "something new is here", and nothing more.
				 *
				 * It is decorative, so it is absent from the accessibility tree. The label above states it in text.
				 */}
				{attention.dot ? (
					<View
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
						style={[shortcut.dot, { backgroundColor: colors.primary }]}
					/>
				) : null}
			</View>
		</Pressable>
	);
}

const shortcut = StyleSheet.create({
	/**
	 * The visible box is 40, the same as the web header button (`size-10`). `targetSlop` widens the
	 * touch area to 44. This value was 44 at one point, which made the controls here looser than on
	 * the web (`packages/ui-native/src/metrics.ts`).
	 */
	root: {
		alignItems: "center",
		justifyContent: "center",
		minHeight: controlHeight.lg,
		minWidth: controlHeight.lg,
	},
	badge: {
		alignItems: "center",
		borderRadius: radiusScale.full,
		justifyContent: "center",
		minWidth: 16,
		paddingHorizontal: 3,
		position: "absolute",
		right: -space.sm,
		top: -space.xs,
	},
	/**
	 * The dot sits on the same corner as the badge. They never draw together, so they do not compete
	 * for space. Sharing the position also means the icon does not jump sideways when the count drops
	 * to zero. With no count, the box is smaller, so the dot sits slightly further in.
	 */
	dot: {
		borderRadius: radiusScale.full,
		height: 8,
		position: "absolute",
		right: -space.xs,
		top: -2,
		width: 8,
	},
});
