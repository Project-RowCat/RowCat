/**
 * The app shell: the discover header, the drawer and the bottom destination row. The section names
 * are the web sidebar's words (`apps/web` `shell.nav`); the same place saying different words in
 * the two apps reads as two features.
 */
export const shell = {
	section: {
		discover: "Discover",
		chat: "Conversations",
		create: "Create",
	},
	sidebar: {
		title: "Main navigation",
		trigger: "Open main navigation",
		brandHint: "Goes to Discover",
		recentHeading: "Recent conversations",
		allChats: "All conversations",
		recentEmpty: "No conversations yet",
		recentError: "Couldn't load conversations",
	},
	header: {
		checkSession: "Check session",
		checking: "Checking",
		localDataFailed:
			"Couldn't open this device's data. Viewing stories isn't affected.",
	},
};
