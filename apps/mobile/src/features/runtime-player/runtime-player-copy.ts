/**
 * Trusted copy for the playback screen: sentences the creator cannot set.
 *
 * Same values as the web's equivalents. If the two apps drew different sentences for the same
 * failure, the same work would read as a different product on each platform, and only a
 * side-by-side look would show it.
 *
 * Keeping these as pure constants is a rule too. This app's tests do not render screens, so if the
 * copy lived inside a component, checking its values would mean trying it by hand.
 */
export const RUNTIME_PLAYER_COPY = {
	loading: "Loading the story…",
	syncing: "Checking saved progress…",
	starting: "Starting the story…",
	failed: "Couldn't run the story. Please restart it.",
	unavailable: "This story can't be played right now.",
	/**
	 * The bridge could not be stood up. **It does not silently fall back to another path** (§89).
	 *
	 * Falling back to `injectJavaScript` or the old Android bridge would make that deployment's
	 * measurements false, and nobody could say which path it is running on.
	 */
	bridgeUnavailable: "This story can't run on this device.",
	/**
	 * The version is mismatched. **Do not recommend restarting** (same value as the web).
	 *
	 * Do not draw sentences like `sandbox api 4 host expected 3`. That value belongs to the
	 * development tools; the only thing the user can do here is get the app again.
	 */
	incompatible: "Update the app to play this story.",
	/**
	 * Failure in the creator's code. **The screen stays as it is.**
	 *
	 * It does not say what went wrong: neither the component stack nor runtime code reaches this
	 * sentence, since those values belong to the studio. Same value as the web.
	 */
	creatorError:
		"Something went wrong while running this story. Restart it, or try again later.",
	retry: "Restart",
	/* `back` used to be here and **was used nowhere.** The back action is drawn by `AppBar` under its own name, and this screen does not choose that word. */
	/**
	 * First line of the header overflow menu: goes to the work's detail screen, where its introduction
	 * and information are read.
	 *
	 * A different place and a different sentence from `storyDetailLink` below. That one is the way out
	 * of a canvas that never received a playback response, so it must read as an action (`View …`). This
	 * one is a menu row, so it names the destination. The web splits the two words for the same
	 * reason.
	 */
	storyDetail: "Story info",
	/** The way to the work detail from a screen that never received a playback response. */
	storyDetailLink: "View story info",
	/**
	 * Save failure. **It is not a runtime failure.** Same two lines, same values as on the web.
	 *
	 * The second line states what is true now: the work keeps running, but progress so far has not yet
	 * been kept on this device. Without it, the warning reads as "play is broken".
	 */
	saveFailed: "Couldn't save your progress.",
	saveFailedBody:
		"You can keep playing. Your progress so far isn't saved on this device yet.",
	saveRetry: "Save again",
	resetPlaythrough: "Reset play",
	/**
	 * The header's second action, and the title of its dialog. **The same word as on the web.**
	 *
	 * It differs from the room's `Conversation settings` on purpose. That window opens the room's whole vocabulary
	 * (memory, persona, cast, search), while here only the two generation axes are chosen. With the
	 * same word, someone who opens it would read the missing items as removed.
	 */
	generationSettings: "Generation settings",
	resetTitle: "Start this play over?",
	resetDescription:
		"Only this playthrough's progress is erased. Records built up across runs stay.",
	resetConfirm: "Start over",
	cancel: "Cancel",
} as const;

/**
 * AI notice: **trusted RowCat sentences** (§69·§75).
 *
 * Whatever the creator writes on the button, `useGeneration()` builds requests with this person's
 * current AI settings. The text does not pin down where a request goes (managed means this server,
 * BYO means that provider; this device's settings decide which), and it does not name a provider.
 * Same value as the web.
 */
export const RUNTIME_PLAYER_AI_COPY = {
	title: "This story uses AI generation.",
	body: "When you interact in the story, generation requests run with your current AI settings. If you use this server's default AI, requests go to this server; if you use a provider you connected, they go there and that account may be charged.",
	allow: "Allow AI and play",
	deny: "Play without AI",
	note: "This choice applies only to this play.",
} as const;

/**
 * Accessible name of the header overflow trigger. The screen shows only `⋯`.
 *
 * It is not in `RUNTIME_PLAYER_COPY`, because of the parity check: every value in that table must
 * match the web, and **the web has no such trigger** (it lays the three actions out as pills).
 * Adding it there would require a copy the web never draws, and such an entry would appear on no
 * screen.
 *
 * The work's title is not in the name. The title sits right next to it and the trigger is the only
 * one, so including it would have a screen reader read the same words twice. The room's two
 * triggers reached the same decision.
 */
export const RUNTIME_PLAYBACK_ACTIONS_LABEL = "Playback controls";
