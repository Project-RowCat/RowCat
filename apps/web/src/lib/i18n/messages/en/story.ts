/**
 * The story detail and preview screens, starting a conversation, sharing (features/story).
 */
export const story = {
	starting: "Getting ready…",
	related: "Related stories",
	backToDiscover: "Back to Discover",
	startFailure: {
		play_unavailable: "A conversation can't be started for this story yet.",
		storage: "Couldn't start the conversation. Please try again in a moment.",
		unknown: "Couldn't start the conversation. Please try again in a moment.",
	},
	navigateFailure:
		"The conversation was created, but its screen couldn't open. You can continue it from the conversation list.",
	share: {
		label: "Share story",
		copied: "Link copied",
		failed: "Couldn't share",
	},
	error: {
		notFound: "Story not found",
		loadFailed: "Couldn't load the story",
		notFoundBody: "This story doesn't exist or can't be viewed right now.",
		retryLater: "Please try again in a moment.",
		requestId: "Request ID: {{id}}",
	},
	persona: {
		newTitle: "New persona",
		chooseTitle: "In this conversation, I am",
		newBody: "Once created, it's applied to this conversation right away.",
		chooseBody:
			"The chosen role's name becomes the speaker of your lines, and its description goes into the setting the model reads.",
		createAndChoose: "Create and choose",
		legend: "Persona for this conversation",
		create: "New persona",
		starting: "Starting…",
	},
	info: "Story info",
	coverAlt: "{{title}} cover",
	mine: "My story",
	reportTarget: "Story",
	reportMenu: "Story report menu",
	descriptionLabel: "Story description",
	noDescription: "No description.",
	tagsLabel: "Tags",
	findByTag: "Find stories tagged {{tag}}",
	close: "Close",
	details: "View details",
	start: "Start",
	loading: "Loading the story",
	properties: {
		created: "Posted",
		updated: "Updated",
		author: "Author credit",
		size: "Size",
		body: "Body",
		protected: "Protected prompt",
	},
};
