/**
 * Follow, block and favorite controls (features/social).
 */
export const social = {
	follow: { follow: "Follow", following: "Following" },
	favorite: {
		add: "Add to favorites",
		remove: "Remove from favorites",
		saveFailed: "Couldn't save",
	},
	menu: {
		manage: "Manage creator {{name}}",
		report: "Report",
		block: "Block",
		unblock: "Unblock",
		reportTarget: "Profile",
	},
	blockDialog: {
		title: "Block this creator?",
		description:
			"<name>{{name}}</name>'s works and comments won't appear on your screen, and if you follow them, the follow ends. Unblocking doesn't restore the follow.",
		submit: "Block",
		submitting: "Blocking…",
	},
	error: {
		followFailed: "Couldn't follow. Please try again in a moment.",
		blockFailed: "Couldn't block. Please try again in a moment.",
		blockedTarget: "You've blocked this creator. Unblock them to follow.",
		selfFollow: "You can't follow yourself.",
		selfBlock: "You can't block yourself.",
		followRestricted:
			"A restricted account can't follow. Check the restriction on your account screen.",
		blockRestricted:
			"A restricted account can't block. Check the restriction on your account screen.",
		loginRequired: "You need to sign in.",
		notFound: "Creator not found.",
	},
};
