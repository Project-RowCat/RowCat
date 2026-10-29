/**
 * Copy for the playtest screen. Kept in one place because each sentence here is a checkable claim.
 *
 * The screen says only three things, and all three must be true:
 *
 * ```text
 * what leaves        the draft's settings and the AI provider this conversation selected
 * what stays         nothing (it is not saved to the conversation list)
 * what it is not     a publication
 * ```
 *
 * The first line is the one most at risk. Choosing a managed model (RowCat-provided) sends the
 * prompt through our server, so "no server sees this" would be false. The copy therefore stops at
 * "sent to the AI provider" and promises nothing further.
 *
 * Some words must not appear. Publish, review, approval and submission do nothing on this screen
 * (the test uploads nothing), and a creator who reads them walks away believing the work went
 * somewhere. `playtest-copy.test.ts` pins that by value.
 *
 * ## The lifetime sentence differs from web because the facts differ
 *
 * Web says "disappears on reload". Native has no reload, but the OS can kill the process, and we
 * cannot promise survival through that (this conversation is never written anywhere). So the
 * sentence states only what is observable: kept on this screen, gone once the screen is closed or
 * the test restarted.
 */

/** The label of the action that enters this screen from the editor. The static scan pins this word by value. */
export const PLAYTEST_ENTRY_LABEL = "Story test";

export const PLAYTEST_ENTRY_PENDING_LABEL = "Opening…";

/**
 * Shown when the editor could not open this screen.
 *
 * `autosave` and `storage` are split because the user's next step differs. The first means the text
 * just typed is not saved yet, so pressing again later works. The second means this account's
 * storage could not be opened, and pressing again gives the same result.
 */
export const PLAYTEST_START_FAILURE = {
	autosave:
		"Couldn't save the edits you just made. Please try again in a moment.",
	storage: "Couldn't read the draft. Please try again in a moment.",
	unknown: "Couldn't start the test. Please try again in a moment.",
} as const;

/**
 * A line that is always visible, not a notice shown once.
 *
 * It is not a confirm dialog on every message, since such dialogs go unread. It is also not shown
 * once and then dismissed: this screen is a point where personal content leaves the device, and
 * unpublished manuscripts go to an external provider.
 */
export const PLAYTEST_DISCLOSURE =
	"Running a test sends the current draft's settings and this conversation to the AI provider you chose. Test conversations aren't saved and don't appear in your conversation list.";

/** Gone once you leave this screen. Shared by the reset and reload confirmations. */
export const PLAYTEST_EPHEMERAL_NOTE =
	"This test conversation lasts only on the current test screen. It disappears when you close the screen or start a new test.";

/**
 * The middle line of a conversation with no messages yet.
 *
 * A single line, not a card: this spot becomes the conversation, and a large box would shrink away
 * when the first response arrives, redrawing the whole screen. No example prompts either; this
 * product has no such list.
 */
export const PLAYTEST_EMPTY_CONVERSATION_HINT =
	"Send a message to see how this draft responds.";

/** Draft with an empty prompt: not blocked, but the note says why the output may be odd. */
export const PLAYTEST_EMPTY_PROMPT_NOTE =
	"The story setup is empty. You can still test, but the model has nothing to go on.";

/** This account has no such draft on this device. **Not an error.** */
export const PLAYTEST_MISSING = {
	title: "This draft isn't on this account",
	description:
		"If the draft was made on another account, sign in with that account. Drafts are stored per account on the device.",
	action: "Back to Create",
} as const;

export const PLAYTEST_GUEST = {
	title: "Sign-in required",
	description: "Drafts are stored on the signed-in member's device.",
	action: "Sign in",
} as const;

export const PLAYTEST_UNAVAILABLE =
	"Couldn't check your session. It continues automatically once connected.";

export const PLAYTEST_STORAGE_ERROR = {
	message: "Couldn't open this device's draft storage.",
	action: "Try again",
} as const;

export const PLAYTEST_BACK_LABEL = "To the editor";

export const PLAYTEST_SETTINGS_TRIGGER_LABEL = "Test settings";

export const PLAYTEST_SETTINGS = {
	title: "Test settings",
	description:
		"Applies only to this test. The draft and your defaults don't change.",
} as const;

export const PLAYTEST_START_SCENE_FIELD = {
	label: "Opening scenes",
	description:
		"An opening used only in this test. The draft's default opening doesn't change.",
} as const;

export const PLAYTEST_MODEL_FIELD_DESCRIPTION =
	"A model used only in this test. Your defaults don't change.";

export const PLAYTEST_RESPONSE_LENGTH_FIELD_DESCRIPTION =
	"Applies only in this test.";

/**
 * Description for reasoning effort, the **same sentence** as response length.
 *
 * Both axes say the same fact on this screen: the value chosen here lives only in this test. The
 * label already says what it decides, and its meaning matches conversation settings.
 */
export const PLAYTEST_REASONING_FIELD_DESCRIPTION =
	"Applies only in this test.";

/**
 * Session actions — **not generation conditions.**
 *
 * The three above decide how the next response is generated. These decide how this test is run now.
 * Without separating them, `Reset test` reads like a value you choose.
 */
export const PLAYTEST_SESSION_GROUP_LABEL = "Session";
export const PLAYTEST_RESET_LABEL = "Reset test";
export const PLAYTEST_RELOAD_LABEL = "New test with the latest draft";
export const PLAYTEST_RELOAD_PENDING_LABEL = "Loading…";

export const PLAYTEST_RESET_CONFIRM = {
	title: "Reset the test?",
	description:
		"The test conversation so far disappears. The draft and the chosen conditions (opening scene, model, response length) stay.",
	confirmLabel: "Reset",
} as const;

export const PLAYTEST_RELOAD_CONFIRM = {
	title: "Start a new test with the latest draft?",
	description:
		"The test conversation so far disappears, and it restarts with the latest saved draft. The draft doesn't change.",
	confirmLabel: "New test",
} as const;

export const PLAYTEST_SCENE_CONFIRM = {
	title: "Switch to another opening scene?",
	description:
		"The test conversation so far disappears, and it restarts with the chosen scene. The draft's default opening doesn't change.",
	confirmLabel: "Switch",
} as const;

/** The draft could not be re-read. The current test stays as is, and the copy says so. */
export const PLAYTEST_RELOAD_FAILURE =
	"Couldn't read the latest draft. The current test stays as it is.";

/**
 * Runtime-enabled draft — **there is nothing to test by conversation in this app.**
 *
 * Not written as a failure. It is the normal result of the creator enabling the runtime, and the
 * screen's job is to say that and where to test instead. Ending with "not possible in the app"
 * leaves the reader unable to tell whether their draft is broken or the app is lacking.
 *
 * Keeps the same promise as the locked-section copy: the values stay, and turning the runtime off
 * re-tests the conversation.
 */
export const PLAYTEST_RUNTIME = {
	title: "This story runs on code",
	description:
		"This draft has the runtime on, so there's nothing to test as a conversation. Code is written in the web's runtime studio and can be run right there. Turn the runtime off to test with the saved conversation settings again.",
	action: "Back to the editor",
} as const;

/**
 * Inspector copy. The difference from web is layout, not facts.
 *
 * Sentences the shared module already holds (`DEBUG_NO_PROMPT_COPY`, `DISCARD_REASON_LABEL`, ...)
 * are not repeated here: they live in one place because both apps must state the same fact. Only
 * the labels this app's container needs remain.
 */
export const PLAYTEST_DEBUGGER = {
	title: "Test debugger",
	description:
		"A record of the requests and responses made in this session. It lives only in memory and disappears when you leave the screen.",
	trigger: "Open debugger",
	tabLabel: "Tab",
	turnLabel: "Selected turn",
	noTurnValue: "None yet",
	fellBack:
		"The chosen turn was pushed past the cap, so the latest turn is shown.",
	expand: "Expand",
	collapse: "Collapse",
	systemPrompt: "System prompt",
	messages: "Message",
	blockNoun: "block",
	messageNoun: "Message",
	loreNoun: "Lore",
	scanNoun: "scan text",
	scanText: "Scanned text",
	emptyValue: "(empty)",
	noKeys: "No keys",
	matchedKey: "Matched key",
	loreActive: "Included",
	loreInactive: "Not included",
	noLoreTitle: "This story has no lore",
	noLoreBody:
		"Lore entries are injected into the prompt when a keyword matches or when always on. You can add them in the draft's Lore section.",
	turn: "Turn",
	status: "Status",
	duration: "Duration",
	end: "End reason",
	finishReason: "Provider finish reason",
	execution: "Run",
	noExecution: "This turn never reached a provider request.",
	model: "Model",
	provider: "Provider",
	reasoning: "Reasoning effort",
	responseLength: "Response length",
	rating: "Rating decision",
	allAges: "All ages",
	adult: "Adult",
	size: "Size",
	outputCharacters: "Reply characters",
	inputTokens: "Input tokens",
	outputTokens: "Output tokens",
	cacheRead: "Read from cache",
	cacheWrite: "Written to cache",
	/**
	 * These two must stay **separate**, and this is the most important value in the table. If the
	 * count the provider reported and our character-based estimate look the same, the creator tunes
	 * the output cap on an estimate.
	 */
	exact: "Provider-reported",
	estimated: "Estimated · from character count",
	failure: "failure",
	errorName: "Exception name",
	errorCode: "Code",
	notSaved: "Why it wasn't saved",
	dropped: "Old events dropped by the cap",
} as const;

/** Says that the cap cut some text. Cutting silently would make the screen lie. */
export const PLAYTEST_DEBUGGER_TRUNCATED =
	"Some text was cut because of the cap. What's shown below isn't everything.";

/**
 * Why the `State` tab is absent in this app, not merely that it is absent.
 *
 * "Not yet" alone makes the creator read it as a feature coming soon and wait. This app has no
 * studio, and a playtest of a runtime-enabled draft does not build a conversation at all
 * (`PLAYTEST_RUNTIME` says so and sends the user back to the editor).
 *
 * The copy does not name the creator hook it refers to. This app does not use that vocabulary
 * (pinned by value in `lib/runtime-native/runtime-native-boundaries.test.ts`), and naming it to
 * explain its absence would report the rule as broken.
 */
export const PLAYTEST_DEBUGGER_STATE_UNAVAILABLE = {
	title: "This app has no runtime state tab",
	body: "A draft with the runtime on runs on code, and that story is tested in the web's runtime studio. This app's story test runs only conversation stories, so there's no saved state to draw.",
} as const;
