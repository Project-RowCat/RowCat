/**
 * The conversation generation lifecycle shared by rooms and the story test (features/conversation).
 */
export const conversation = {
	failure: {
		opaque: "No response was received.",
		managedUnavailable: "This model can't generate conversations right now.",
		rateLimited: "Too many generation requests. Please try again in a moment.",
		managedNotAllowed:
			"This server's default AI is only for allowed accounts. Connect a personal API key in AI settings.",
		persistenceFailed: "Couldn't save the response on this device.",
		emptyAnswer: "The response had no body, so it wasn't saved.",
	},
	actions: {
		continue: "Continue generating",
		retry: "Regenerate",
		providerSettings: "Open AI settings",
	},
	copy: {
		idle: "Copy {{noun}}",
		copied: "Copied",
		failed: "Couldn't copy",
		announceCopied: "Copied the {{noun}}",
		announceFailed: "Couldn't copy the {{noun}}",
		nouns: {
			message: "message",
			block: "block",
			request: "request",
			lore: "lore",
			scanText: "scan text",
			value: "value",
			previousValue: "previous value",
		},
	},
};
