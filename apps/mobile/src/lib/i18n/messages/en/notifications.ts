/**
 * The notification inbox (features/notifications) and the device push section (features/push). The
 * update-note history beside the inbox has its own namespace (`updates`). The Korean uses the web's
 * words (`apps/web` `notifications`), so one event reads the same in both apps.
 *
 * Three groups name shared vocabulary rather than invent it: `bell` and `unseenUpdate` are the
 * domain's `notificationBellLabel` and `UPDATE_UNSEEN_LABEL_SUFFIX`. Their English is held equal to
 * those values by a test.
 */
export const notifications = {
	screen: {
		title: "Notifications",
		empty: "No notifications yet.",
		/**
		 * The first tab is not named `Notifications`: the bar already says that, and repeating the word
		 * would stack the same text twice and blur the relationship between the tabs.
		 */
		tabsLabel: "Notification types",
		offline:
			"Not connected right now. Notifications load again once connected.",
		error: "Couldn't load notifications.",
		/** Says "state", not "notifications": an inbox the server reported as empty can show this band too. */
		stale: "The last refresh failed, so the previous state is shown.",
		retry: "Try again",
		more: "Show more",
		moreBusy: "Loading…",
		markAll: "Mark all read",
		markAllFailed:
			"Couldn't mark all notifications as read. Please try again in a moment.",
		guest: {
			title: "Sign in to see notifications",
			description:
				"Follows, comments and account notices arrive in this inbox.",
			action: "Sign in",
		},
		/** **Not a sign-out.** The stored session is intact; we simply could not ask the server. */
		unavailable: "Couldn't check your session. Please try again in a moment.",
	},
	tab: {
		general: "General",
		updates: "Updates",
	},
	unseenUpdate: ", new update available",
	bell: {
		label: "Notifications",
		unread: "Notifications, {{badge}} unread",
	},
	/** A departed actor and a blank name are different facts and keep different words. */
	deletedActor: "Deleted user",
	unnamed: "No name",
	message: {
		follow: "{{who}} followed you.",
		commentReply: '{{who}} replied to your comment on "{{title}}".',
		commentReplyUntitled: "{{who}} replied to your comment.",
		storyComment: '{{who}} commented on "{{title}}".',
		storyCommentUntitled: "{{who}} commented on your story.",
		published: "{{who}} published a new story.",
		reportReviewed: "We reviewed your report.",
		moderationAction: "A moderation action was applied to your account.",
		moderationReversed: "A moderation action on your account was lifted.",
		appUpdate: "An app update is required.",
		appealAccepted: "Your appeal was accepted.",
		appealRejected: "Your appeal was not accepted.",
		appealResolved: "Your appeal has a result.",
	},
	appUpdateDetail:
		"{{platform}} app versions below {{version}} are no longer supported.",
	unreadSummary: "{{total}} unread",
	unreadRow: "Unread, {{message}}",
	push: {
		sectionTitle: "Push notifications",
		sectionDescription:
			"Applies only to this device. Notification history stays on your account and shows on other devices as is.",
		fieldLabel: "Device push notifications",
		offer:
			"Turn on push notifications to get comments, follows and account notices on this device.",
		enable: "Turn on push notifications",
		enabling: "Turning on…",
		enabled: "This device is receiving push notifications.",
		disable: "Turn off on this device",
		disabling: "Turning off…",
		blocked:
			"RowCat notifications are off in system settings. Allow notifications in settings to receive them on this device.",
		openSettings: "Open system settings",
		/** Must not say "turned on": the device is not receiving. */
		incomplete:
			"Notification permission was granted, but this device couldn't be registered. Please try again.",
		retry: "Try again",
		failure: {
			permission: "Notification permission wasn't granted.",
			token:
				"Couldn't get this device's notification address. Check your network and try again.",
			server: "Couldn't register this device. Please try again in a moment.",
		},
		disableNote:
			"Turning it off stops sending notifications to this device. The system's notification permission stays as is.",
	},
};
