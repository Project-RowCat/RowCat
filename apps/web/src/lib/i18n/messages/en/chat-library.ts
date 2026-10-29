/**
 * The conversation library and its runtime rows (features/chat-library, features/conversation-library).
 */
export const chatLibrary = {
	title: "Conversations",
	sort: { recent: "Recent activity", oldest: "Oldest activity", title: "Name" },
	unavailableTitle: "Can't open conversations",
	unavailableBody:
		"Conversations are saved on this device per account. They'll be there when you sign in again.",
	signIn: "Sign in",
	noResultsTitle: "No results",
	noResultsBody: "Search matches conversation names only, not message content.",
	clearSearch: "Clear search",
	showMore: "Show more",
	emptyTitle: "No conversations yet",
	emptyBody:
		"Discover a story and start a conversation. Conversations you start are saved on this device.",
	discover: "Discover stories",
	searchLabel: "Search conversations",
	searchPlaceholder: "Search conversation names",
	sortLabel: "Sort by",
	count_one: "{{formatted}} conversation",
	count_other: "{{formatted}} conversations",
	loading: "Loading conversations",
	runtime: {
		remove: "Remove from list",
		manage: "Manage {{title}} in the list",
		untitled: "Untitled story",
		kind: "Runtime story",
		removeFailed: "Couldn't remove it from the list. Please try again.",
	},
};
