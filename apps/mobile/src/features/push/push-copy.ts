/**
 * Copy for the push settings section.
 *
 * The lock-screen banner text is not here. The server picks it
 * (`apps/api/src/services/push/copy.ts`), on a surface read by non-owners, and the app is not
 * running when that sentence is chosen.
 *
 * `Turn off on this device` reverts RowCat server delivery, not the OS permission. The copy must say so;
 * otherwise a user who sees notifications still allowed in system settings reads the button as a
 * no-op.
 */

export const PUSH_SECTION_TITLE = "Push notifications";

export const PUSH_SECTION_DESCRIPTION =
	"Applies only to this device. Notification history stays on your account and shows on other devices as is.";

export const PUSH_FIELD_LABEL = "Device push notifications";

/** Not asked yet. Says what the user would receive first. */
export const PUSH_OFFER_DESCRIPTION =
	"Turn on push notifications to get comments, follows and account notices on this device.";

export const PUSH_ENABLE_LABEL = "Turn on push notifications";
export const PUSH_ENABLING_LABEL = "Turning on…";

export const PUSH_ENABLED_DESCRIPTION =
	"This device is receiving push notifications.";
export const PUSH_DISABLE_LABEL = "Turn off on this device";
export const PUSH_DISABLING_LABEL = "Turning off…";

/**
 * Blocked by the system. The copy does not only say "allow permission": the one thing the user can
 * do is open system settings, so that path is offered too.
 */
export const PUSH_BLOCKED_DESCRIPTION =
	"RowCat notifications are off in system settings. Allow notifications in settings to receive them on this device.";
export const PUSH_OPEN_SETTINGS_LABEL = "Open system settings";

/**
 * Permission granted but no server registration. Must not say "turned on": the device is not
 * receiving, and showing it as on makes the user wait for notifications that never arrive.
 */
export const PUSH_INCOMPLETE_DESCRIPTION =
	"Notification permission was granted, but this device couldn't be registered. Please try again.";
export const PUSH_RETRY_LABEL = "Try again";

/** One line per failure reason, without technical detail. */
export const PUSH_FAILURE_MESSAGE = {
	permission: "Notification permission wasn't granted.",
	token:
		"Couldn't get this device's notification address. Check your network and try again.",
	server: "Couldn't register this device. Please try again in a moment.",
} as const;

/**
 * What turning off does not do. The app cannot revert the OS permission; it stays allowed in system
 * settings after turning off, which is the correct state.
 */
export const PUSH_DISABLE_NOTE =
	"Turning it off stops sending notifications to this device. The system's notification permission stays as is.";
