/**
 * Decides what the bell shows and says. This is the one place where two domains meet:
 * - Server notifications: a count the server owns, including read state.
 * - Update notes: shipped by the repo. There is no count, and read state is a per-device value.
 *
 * The two are never summed into one number. Adding a pending update to the unread count would show
 * a number that 'mark all as read' can never clear, since the server never created that row.
 *
 * The badge (count) and the dot are separate axes. When both apply, the count wins. It is the more
 * specific fact, and clearing the count reveals the dot. Drawing both would leave two markers with
 * no relation the screen could explain.
 *
 * The accessible label carries both facts, because the badge and dot are visual only. A pending
 * update should not vanish for screen reader users.
 *
 * This module does not import UpdateNote. It receives one boolean. Importing would bring
 * release-note vocabulary into the notification domain, which the static scans of both apps block.
 * The screens do the merging (web bell, mobile shortcut). This module owns only the rule.
 *
 * Both apps call the same function. Priority and label assembly written per app would drift, and
 * the same state would be drawn as a count on one and a dot on the other.
 */

import {
	notificationBadgeLabel,
	notificationBellLabel,
} from "./notification.ts";

/**
 * The suffix appended to the bell's name when an update note is unseen. On web it is visually
 * hidden text. It is the same string as the mobile tab bar's `accessibilityLabel`, on purpose. The
 * same fact must have one name on every surface, or it becomes two facts.
 */
export const UPDATE_UNSEEN_LABEL_SUFFIX = ", new update available";

export interface NotificationAttentionInput {
	/**
	 * Unread server notification count. `null` means not yet known, not zero. Folding the two would
	 * announce '0 unread' before the query returns.
	 */
	readonly unread: number | null;
	/** Whether an unopened update note exists. A boolean, never a count. */
	readonly unseenUpdate: boolean;
}

export interface NotificationAttention {
	/**
	 * The number to draw on the badge, or null for none. The cap format (`99+`) is decided by the
	 * badge rule itself.
	 */
	readonly badge: string | null;
	/** The dot drawn instead of a count. Always false when there is a badge. */
	readonly dot: boolean;
	readonly label: string;
}

/**
 * Decides what the bell draws and says. `dot` is tied to `badge === null`, and that tie is the
 * whole function. If the two were computed separately and passed on, 'a badge of 3 with a dot'
 * would be representable, and that state raises no error.
 */
export function notificationAttention({
	unread,
	unseenUpdate,
}: NotificationAttentionInput): NotificationAttention {
	const badge = unread === null ? null : notificationBadgeLabel(unread);
	return {
		badge,
		dot: badge === null && unseenUpdate,
		/**
		 * Both facts go into the name. The dot losing to the count is a limit of drawing a single slot,
		 * but the name has no such slot. Folding here as well would mean screen reader users never hear
		 * that a new update exists while unread notifications are present.
		 */
		label: unseenUpdate
			? `${notificationBellLabel(unread)}${UPDATE_UNSEEN_LABEL_SUFFIX}`
			: notificationBellLabel(unread),
	};
}
