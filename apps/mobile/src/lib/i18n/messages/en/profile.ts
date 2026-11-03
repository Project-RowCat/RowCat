/**
 * The public creator profile (features/profile): header, follow, block and the work lists. The
 * Korean uses the web's words (`apps/web` `profile` and `social`).
 */
export const profile = {
	pinned: "Pinned works",
	publicWorks: "Public stories",
	end: "You've reached the end",
	followers: "Followers",
	mine: "My profile",
	follow: "Follow",
	following: "Following",
	followName: "Follow {{name}}",
	unfollowName: "Unfollow {{name}}",
	restricted: "This account is restricted.",
	checking: "Checking your session.",
	manage: "Manage creator {{name}}",
	reportTarget: "Profile",
	block: "Block",
	unblock: "Unblock",
	blockTitle: "Block this creator?",
	blockDescription:
		"{{name}}'s stories and comments won't show on your screen, and if you follow them, you'll unfollow. Unblocking doesn't restore the follow.",
	offline:
		"You're not connected to a network. It continues automatically once connected.",
	notFound: "Profile not found.",
	goDiscover: "Go to Discover",
	emptyWorks: "No public works yet",
	notFoundBody: "This profile doesn't exist or can't be viewed right now.",
	loadFailed: "Couldn't load the profile.",
	requestId: "Request ID: {{id}}",
	storiesOffline:
		"You're not connected to a network, so stories couldn't be loaded.",
	storiesFailed: "Couldn't load stories.",
	blockedTitle: "You've blocked this creator",
	blockedBody:
		"This creator's works and comments won't appear on your screen. You can unblock them from the menu above.",
	error: {
		followFailed: "Couldn't Follow. Please try again in a moment.",
		blockFailed: "Couldn't Block. Please try again in a moment.",
		blockedTarget: "You've blocked this creator. Unblock them to follow.",
		selfFollow: "You can't follow yourself.",
		selfBlock: "You can't block yourself.",
		followRestricted: "A restricted account can't Follow.",
		blockRestricted: "A restricted account can't Block.",
		loginRequired: "You need to sign in.",
		notFound: "Creator not found.",
	},
};
