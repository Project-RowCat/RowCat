/**
 * Trusted copy for runtime playback. apps/mobile's parity test reads this file's key: "value" pairs, so key names must stay unique across sections.
 */
export const runtimePlayer = {
	player: {
		loading: "Loading the story…",
		syncing: "Checking saved progress…",
		starting: "Starting the story…",
		creatorError:
			"Something went wrong while running this story. Restart it, or try again later.",
		failed: "Couldn't run the story. Please restart it.",
		transitionBlocked:
			"Progress couldn't be saved, so play can't continue. Try saving again.",
		incompatible: "Update the app to play this story.",
		unavailable: "This story can't be played right now.",
		retry: "Restart",
		storyDetail: "Story info",
		storyDetailLink: "View story info",
		viewportTitle: "Play",
		saveFailed: "Couldn't save your progress.",
		saveFailedBody:
			"You can keep playing. Your progress so far isn't saved on this device yet.",
		saveRetry: "Save again",
		resetPlaythrough: "Reset play",
		resetTitle: "Start this play over?",
		resetDescription:
			"Only this playthrough's progress is erased. Records built up across runs stay.",
		resetConfirm: "Start over",
		cancel: "Cancel",
		generationSettings: "Generation settings",
	},
	ai: {
		title: "This story uses AI generation.",
		body: "When you interact in the story, generation requests run with your current AI settings. If you use this server's default AI, requests go to this server; if you use a provider you connected, they go there and that account may be charged.",
		allow: "Allow AI and play",
		deny: "Play without AI",
		note: "This choice applies only to this play.",
	},
	audio: {
		activate: "Play sound",
	},
};
