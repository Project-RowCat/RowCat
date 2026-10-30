/**
 * The app shell (sidebar, header, theme toggle), route fallbacks, page titles and update-note surfaces.
 */
export const shell = {
	nav: {
		label: "Main navigation",
		open: "Open main navigation",
		discover: "Discover",
		chat: "Conversations",
		create: "Create",
		recent: "Recent conversations",
		allChats: "All conversations",
	},
	header: {
		signIn: "Sign in",
		settings: "Settings",
		accountMenu: "{{name}}'s account menu",
		account: "Account",
		signOut: "Sign out",
		chat: "Conversation",
		draft: "Draft",
	},
	theme: {
		toggle: "Toggle theme",
		light: "Light",
		dark: "Dark",
		system: "System",
	},
	language: {
		toggle: "Change language",
		firstVisitTitle: "Choose your language",
		firstVisitDescription:
			"You can change it any time from the language menu or Settings.",
	},
	bell: {
		label: "Notifications",
		unread: "Notifications, {{count}} unread",
		unseenUpdate: ", new update available",
	},
	fallback: {
		notFoundTitle: "Page not found",
		notFoundBody: "The address changed or the page doesn't exist.",
		backToDiscover: "Back to Discover",
		errorTitle: "Couldn't load this screen",
		retryLater: "Please try again in a moment.",
		requestId: "Request ID: {{id}}",
	},
	updates: {
		empty: "No update notes yet.",
		title: "Update notes for {{date}}",
		ok: "OK",
		section: {
			additions: "New features",
			improvements: "Improvements",
			fixes: "Fixes",
			notices: "Notes",
		},
	},
	loadingDraft: "Loading the draft…",
	loadingProject: "Loading the project…",
	titles: {
		discover: "Discover · {{app}}",
		discoverDescription:
			"Browse stories posted on {{app}} by orientation, popularity and rating.",
		login: "Sign in · {{app}}",
		resetPassword: "Reset password · {{app}}",
		guardian: "Guardian consent · {{app}}",
		notifications: "Notifications · {{app}}",
		creator: "{{name}}'s public stories · {{app}}",
		account: "Account · {{app}}",
		playtest: "Story test · {{app}}",
		runtimeStudio: "Runtime studio · {{app}}",
		create: "Create · {{app}}",
		play: "Play · {{app}}",
		aiSettings: "AI settings · {{app}}",
		chats: "Conversations | {{app}}",
		story: "{{name}}'s story · {{app}}",
		personaSettings: "Persona settings · {{app}}",
		settings: "Settings · {{app}}",
		accountDeletion: "Account deletion guide · {{app}}",
		accountDeletionDescription:
			"How to delete your {{app}} account, and which data is deleted or may remain.",
	},
};
