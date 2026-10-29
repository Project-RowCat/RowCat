/**
 * Copy for the studio preview and its console, state and AI panels.
 */
export const runtimePreview = {
	preview: {
		run: "Run preview",
		restart: "Restart",
		stop: "Stop",
		resetPlaythrough: "Reset play",
		resetPlaythroughHint:
			"Clears saved progress and starts over. Long progress (definePersistentState) stays, and Restart carries both over.",
		resetPersistent: "Reset long progress",
		resetPersistentHint:
			"Clears the values declared with definePersistentState. It clears only preview memory and is a different operation from Reset play.",
		restartAfterFailure: "Restart preview",
		idleTitle: "Not run yet",
		idleBody:
			"Press Run and the code is compiled and runs in an isolated VM; its screen is drawn here.",
		notEligible: "Fix the problems first to run.",
		compiling: "Compiling…",
		starting: "Starting the runtime…",
		stopping: "Cleaning up…",
		stale: "Changes pending",
		staleBody:
			"The screen is running the previous code. Restart runs the new code and keeps the saved progress.",
		renderError: "An error occurred while rendering.",
		effectError: "An error occurred while running an effect.",
		eventError: "An error occurred while handling an event.",
		previousKept: "The last drawn screen is still shown.",
		failedCompile: "Compilation failed.",
		failedStart: "Couldn't start the runtime.",
		failedRuntime: "The runtime stopped.",
		failedRenderer: "Couldn't draw the preview.",
		failedWorker: "The preview worker isn't responding.",
		failedRuntimeBody:
			"The VM can't continue. Restart runs it from the beginning.",
		failedRendererBody:
			"The host and the screen disagree about the tree. Restart runs it from an empty screen.",
		consoleEmpty:
			"Console output and runtime diagnostics during the run collect here.",
		consoleClear: "Clear console",
		diagnosticLabel: "Diagnostic",
		stateEmpty:
			"Values declared with defineStoryState and definePersistentState collect here. No saved state is declared yet.",
		statePlaythroughHint: "Values Reset play clears.",
		statePersistentHint: "Values that survive Reset play.",
		stateScope:
			"This progress lasts only while the studio is open. Refreshing starts over.",
		generationToggle: "Use AI",
		generationHint:
			"When on, useGeneration() calls a real model from the next run. It is charged like a real conversation.",
		generationPending: "Restart to turn AI on.",
		generationActive: "AI on",
		consoleDropped_one: "Removed {{count}} old line.",
		consoleDropped_other: "Removed {{count}} old lines.",
	},
	debug: {
		runWithReset: "Ran with Reset play",
		runWithPersistentReset: "Ran with Reset long progress",
		runStarted: "Started a run",
		sessionStarted: "Session started",
		commit_one: "Commit #{{revision}} ({{count}} patch)",
		commit_other: "Commit #{{revision}} ({{count}} patches)",
		commands_one: "{{count}} control command",
		commands_other: "{{count}} control commands",
		saveStory_one: "Playthrough save ({{count}} change)",
		saveStory_other: "Playthrough save ({{count}} changes)",
		savePersistent_one: "Long progress save ({{count}} change)",
		savePersistent_other: "Long progress save ({{count}} changes)",
		migration: "Migration: {{key}} v{{from}} → v{{to}}",
		exception: "Exception in {{work}}: {{name}}",
		generationRequested: "Creator code requested generation",
		sessionFailed: "Session failed to start ({{stage}})",
		compileFailed: "Compilation did not pass",
		sessionStopped_one: "Session stopped ({{count}} cleanup)",
		sessionStopped_other: "Session stopped ({{count}} cleanups)",
		generationReturned: "Generation result returned",
		generationRefused: "Generation refused ({{reason}})",
	},
	format: {
		more: "… {{count}} more",
		moreShort: "… {{count}} more",
		truncated: "(truncated)",
	},
};
