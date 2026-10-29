import { iconSize, radiusScale, space } from "@rowcat/design";
import { isUnread, type Notification } from "@rowcat/domain";
import { Icon, Text, touchTarget, useTheme } from "@rowcat/ui-native";
import { Pressable, StyleSheet, View } from "react-native";
import { relativeTime } from "../../lib/format.ts";
import {
	notificationActorInitial,
	notificationDetail,
	notificationMessage,
	notificationRowLabel,
} from "./notification-copy.ts";
import { notificationIconName } from "./notification-icon.ts";

/**
 * One notification row. Same meaning as the web `notification-row.tsx`, different rendering.
 *
 * ```text
 * [dot] [icon] sentence
 *              (optional) second line: public reason, release version, minimum supported version
 *              relative time
 * ```
 *
 * ## The whole row is one action
 *
 * Each row is one event, and pressing it goes to where that event happened. The Pressable therefore
 * covers the row, with no second press target inside it. Nested press targets behave differently
 * per platform, and screen readers hear them as a button inside a button (the discovery card makes
 * its three controls siblings for the same reason).
 *
 * A row without a destination is the same action: pressing it only marks it read. It is not drawn
 * disabled. The event did happen, and clearing the "new" marker is still a valid action.
 *
 * ## Unread is not conveyed by colour alone
 *
 * The dot and the faint background are decoration. The accessibility label carries the state in
 * text, with the `Unread,` prefix from `notificationRowLabel`. A user who cannot see the tint must
 * still get the state.
 *
 * ## Marking read does not move layout
 *
 * The dot's slot always exists; only its opacity changes. A conditional render would shift the text
 * beside it on read. Weight is not used either: a bold unread line changes the sentence's width on
 * read, which re-wraps its line breaks (the web makes the same call).
 *
 * ## Icons, with initials only for social events
 *
 * No avatar: moderation notifications have no actor to draw, and varying row heads across a list of
 * mixed kinds adds reading cost. Icon choice is a pure table (`notification-icon.ts`).
 */
export function NotificationRow({
	notification,
	onActivate,
}: {
	notification: Notification;
	/**
	 * Called when the row is pressed. Marking read and navigation are the caller's job, so the screen
	 * owns the ordering in one place. The row itself never issues a mutation.
	 */
	onActivate: () => void;
}) {
	const { colors, alpha } = useTheme();
	const unread = isUnread(notification);
	const detail = notificationDetail(notification);
	const initial =
		notification.kind === "follow" || notification.kind === "story_comment"
			? notificationActorInitial(notification.actor)
			: "";

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={notificationRowLabel(notification)}
			onPress={onActivate}
			style={({ pressed }) => [
				row.root,
				/**
				 * The unread background is very faint. A strong tint would make the row read as "selected"
				 * rather than "new", and ten selected rows would mean nothing. The pressed state is always
				 * stronger than this.
				 */
				unread && { backgroundColor: alpha("accent", 0.45) },
				pressed && { backgroundColor: colors.muted },
			]}
		>
			{/* Dot slot. It keeps its place when read (see header), aligned near the middle of the first text line. */}
			<View style={row.dotSlot}>
				<View
					style={[
						row.dot,
						{ backgroundColor: colors.primary, opacity: unread ? 1 : 0 },
					]}
				/>
			</View>

			<View style={[row.marker, { backgroundColor: colors.muted }]}>
				{initial ? (
					<Text variant="label" tone="muted-foreground">
						{initial}
					</Text>
				) : (
					<Icon
						name={notificationIconName(notification)}
						size="md"
						tone="muted-foreground"
					/>
				)}
			</View>

			<View style={row.body}>
				{/* The sentence comes first. Neither the icon, the time nor the dot may be stronger than it. */}
				<Text variant="label" weight="regular">
					{notificationMessage(notification)}
				</Text>
				{detail ? (
					<Text variant="caption" tone="muted-foreground">
						{detail}
					</Text>
				) : null}
				{/*
				 * Relative time, worded the same on web and app (`relativeTime` in `lib/format.ts`).
				 * An unparseable value is an empty string, and then the line is not drawn.
				 */}
				{relativeTime(notification.createdAt) ? (
					<Text variant="caption" tone="muted-foreground">
						{relativeTime(notification.createdAt)}
					</Text>
				) : null}
			</View>
		</Pressable>
	);
}

const row = StyleSheet.create({
	root: {
		flexDirection: "row",
		gap: space.sm,
		/** The touch target floor is 44pt, so a one-line row never gets thinner than that. */
		minHeight: touchTarget,
		/**
		 * Matches the web's `py-3.5 px-3` (see `notification-row.tsx`). This row used to be 12/8, and a
		 * one-line notification measured 59pt here against the web's 66pt. Seven points is invisible in a
		 * single row, but the rows stack, so seven of them drift by about 50pt. The mismatch only shows
		 * when the two screens sit side by side.
		 *
		 * 14 is off the spacing scale on purpose. The value comes from the web's chosen row height, and
		 * rounding to the nearest token (12 or 16) would break that match.
		 */
		paddingHorizontal: space.md,
		paddingVertical: 14,
	},
	/**
	 * The dot is a fixed left column. At the right end its x position would shift with each row's text
	 * length, and the eye could not scan down the list for new items (the web makes the same call).
	 */
	dotSlot: { alignItems: "center", paddingTop: 7, width: space.sm },
	dot: { borderRadius: radiusScale.full, height: 6, width: 6 },
	marker: {
		alignItems: "center",
		borderRadius: radiusScale.full,
		height: iconSize["2xl"],
		justifyContent: "center",
		width: iconSize["2xl"],
	},
	body: { flex: 1, gap: space.px, minWidth: 0 },
});
