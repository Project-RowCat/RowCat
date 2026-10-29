/**
 * Copy for the story test (/create/:draftId/test) and its debugger.
 */
export const playtest = {
	copy: {
		disclosure:
			"Running a test sends the current draft's settings and this conversation to the AI provider you chose. Test conversations aren't saved and don't appear in your conversation list.",
		ephemeral:
			"This conversation lasts only on this screen. It disappears if you refresh or leave.",
		emptyConversation: "Send a message to see how this draft responds.",
		emptyPrompt:
			"The story setup is empty. You can still test, but the model has nothing to go on.",
		reloadFailure:
			"Couldn't read the latest draft. The current test stays as it is.",
		runtimeNote:
			"Runs this draft's runtime code in an isolated VM. Progress made here lasts only on this screen and disappears if you refresh or leave.",
		runtimeEmpty:
			"No runtime files yet. Once you write code, you can run it here.",
		runtimeStudioLink: "Open runtime studio",
		runtimeRun: "Run",
		runtimeRestart: "Restart test",
		resetConfirm: {
			title: "Reset the test?",
			description:
				"The test conversation so far disappears. The draft and the chosen conditions (opening scene, model, response length) stay.",
			confirmLabel: "Reset",
		},
		reloadConfirm: {
			title: "Start a new test with the latest draft?",
			description:
				"The test conversation so far disappears, and it restarts with the latest saved draft. The draft doesn't change.",
			confirmLabel: "New test",
		},
		sceneConfirm: {
			title: "Switch to another opening scene?",
			description:
				"The test conversation so far disappears, and it restarts with the chosen scene. The draft's default opening doesn't change.",
			confirmLabel: "Switch",
		},
	},
	unavailable: {
		conversation: {
			state: {
				title: "This test has no runtime state",
				body: "useStoryState and usePersistentState exist only in drafts with runtime on. A conversation story's state is the conversation itself, and its content is in the Prompt pane's history.",
			},
		},
		runtime: {
			prompt: {
				title: "Runtime stories don't assemble a conversation prompt",
				body: "Playback opens no room, so there is no place for the prompt, lore or opening scenes. Requests the code makes with useGeneration() stay as events in the Timeline pane.",
			},
			lore: {
				title: "Runtime stories carry no lore",
				body: "Lore is injected into the prompt when a keyword matches, so a story with no assembled prompt has nowhere to put it.",
			},
			generation: {
				title: "Generation here is called by the code",
				body: "The model, target and response length come from the playback surface's generation settings, and each request stays in the Timeline pane. The conversation turns this pane draws aren't here.",
			},
		},
	},
	debug: {
		block: {
			"absolute-guard": "Absolute prohibitions",
			"rating-guard": "Rating guard",
			"minor-guard": "Minor character guard",
			"house-rules": "House rules",
			"lore-system-top": "Lore (top)",
			"roleplay-rules": "Roleplay rules",
			"narration-pack": "Narration pack",
			"gm-preamble": "Narrator preamble",
			scenario: "World / situation",
			characters: "Characters",
			persona: "User (counterpart)",
			"play-guide": "Play guide",
			"lore-system-bottom": "Lore (bottom)",
			"lore-before-history": "Lore (before generation)",
			summary: "Summary",
			memory: "Memory",
			"user-note": "User note",
			intensity: "Intensity",
			"tail-guard": "Tail guard",
		},
		status: {
			running: "Running",
			committed: "Saved",
			discarded: "Not saved",
			failed: "Failed",
			stopped: "Stopped",
		},
		discard: {
			ownership:
				"This conversation was no longer active (reset, scene switch, latest draft, or account switch).",
			empty:
				"There was no body to save (an empty reply, or only tracking blocks were left).",
			precondition:
				"The continuation's premise broke (the conversation moved on in the meantime).",
		},
		noPrompt: {
			title: "This turn assembled no prompt",
			body: "The input wasn't saved, or the target was blocked and the turn ended before the request. The Timeline pane records where it stopped.",
		},
		noTurn: {
			title: "No turns generated yet",
			body: "Send a message and that turn's prompt, lore decisions and execution details appear here. This record is in memory only and disappears when you leave the screen.",
		},
		noEvent: {
			title: "No events recorded yet",
			body: "Once the test starts, input, assembly, request, response and commit are recorded here in order.",
		},
		source: {
			creator: "Story",
			viewer: "This conversation",
			narration: "Narration pack",
		},
		reason: {
			constant: "Always",
			"key-match": "Key matched",
			"no-key-match": "No key matched",
			"no-keys": "No keys (never matches)",
			"empty-content": "Empty body",
		},
		position: {
			system_top: "Top",
			system_bottom: "Bottom",
			before_history: "Before generation",
		},
		blocks: "{{count}} blocks · {{chars}} characters",
		messages: "{{count}} lines · history window {{window}}",
		matchedKey: "Matched key: {{key}}",
		chars: "{{count}} characters",
		injectedOrder: "Injection order {{n}}",
		matchedOf: "{{active}} of {{count}} matched",
		managed: "{{app}} managed",
		tokens: "{{count}} tokens",
		stateCount: "{{count}}",
		dropped:
			"Older events were dropped because of the cap ({{count}}). Below, newest first.",
	},
	inspector: {
		connect: "Connect {{provider}} in AI settings",
	},
	summary: {
		defaultScene: "Default opening",
		untitledScene: "Untitled opening",
		model: "Model",
		responseLength: "Response length",
		reasoning: "Reasoning effort",
		startScene: "Opening scene",
	},
	startButton: {
		failure: {
			autosave:
				"Couldn't save the edits you just made. Please try again in a moment.",
			storage: "Couldn't read the draft. Please try again in a moment.",
			unknown: "Couldn't start the test. Please try again in a moment.",
		},
	},
	runtimePlaytest: {
		storyTest: "Story test",
		closeDebugger: "Close debugger",
		debugger: "Debugger",
	},
	playtestShell: {
		storyTest: "Story test",
	},
	playtestPage: {
		ifYouMadeItIn:
			"If you made it in another account, sign in with that account. Drafts are saved on the device per account.",
		thisDraftIsnTIn: "This draft isn't in this account.",
		openThisReplySDebug: "Open this reply's debug record",
		loadingTheDraft: "Loading the draft…",
		backToDrafts: "Back to drafts",
	},
	playtestInspector: {
		anOpeningUsedOnlyIn:
			"An opening used only in this test. The draft's default opening doesn't change.",
		aModelUsedOnlyIn:
			"A model used only in this test. Your defaults don't change.",
		appliesOnlyInThisTest: "Applies only in this test.",
		newTestWithTheLatest: "New test with the latest draft",
		draftSDefaultOpening: "Draft's default opening",
		resetTest: "Reset test",
		testConditions: "Test conditions",
		openingScene: "Opening scene",
		model: "Model",
		session: "Session",
	},
	conversationTabs: {
		loreEntriesAreInjectedInto:
			"Lore entries are injected into the prompt when a keyword matches or when always on. You can add them in the draft's Lore section.",
		providerNeutralRequestCredentialsHave:
			"provider-neutral request (credentials have no place in this shape)",
		someTextWasCutBecause:
			"Some text was cut because of the cap. What's shown below isn't everything.",
		thisTurnNeverReachedA: "This turn never reached a provider request.",
		theProviderDidnTReport: "The provider didn't report usage",
		providerFinishReason: "Provider finish reason",
		thisStoryHasNoLore: "This story has no lore",
		rawTheAssembledRequest: "Raw: the assembled request",
		estimatedFromCharacterCount: "Estimated · from character count",
		whyItWasnTSaved: "Why it wasn't saved",
		systemPrompt: "System prompt",
		empty: "(empty)",
		committedMessage: "Committed message",
		readFromCache: "Read from cache",
		notIncluded: "Not included",
		providerReported: "Provider-reported",
		scannedText: "Scanned text",
		duration: "Duration",
		endReason: "End reason",
		billingPath: "Billing path",
		directConnection: "Direct connection",
		reasoningEffort: "Reasoning effort",
		responseLength: "Response length",
		outputCap: "Output cap",
		ratingDecision: "Rating decision",
		allAges: "All ages",
		notApplied: "Not applied",
		inputCharacters: "Input characters",
		replyCharacters: "Reply characters",
		inputTokens: "Input tokens",
		outputTokens: "Output tokens",
		writtenToCache: "Written to cache",
		exceptionName: "Exception name",
		noKeys: "No keys",
		narrationPack: "Narration pack",
		messages: "Messages",
		provider: "Provider",
		applied: "Applied",
		included: "Included",
		decision: "Decision",
		status: "Status",
		start: "Start",
		execution: "Execution",
		model: "Model",
		adult: "Adult",
		size: "Size",
		failure: "Failure",
		code: "Code",
		turn: "Turn",
		end: "End",
	},
	playtestToolbar: {
		notAvailableOnThisDevice: "Not available on this device",
		backToEditing: "← Back to editing",
		testSettings: "Test settings",
		testing: "Testing",
		closeSettings: "Close settings",
		closeDebugger: "Close debugger",
		debugger: "Debugger",
	},
	conversationDebugger: {
		theChosenTurnWasPushed:
			"The chosen turn was pushed past the cap, so the latest turn is shown.",
	},
	debugPrimitives: {
		providerReported: "Provider-reported",
		expand: "Expand",
		estimated: "Estimated",
		collapse: "Collapse",
	},
	startPlaytestButton: {
		storyTest: "Story test",
		opening: "Opening…",
	},
	runtimeDebugger: {
		pressRunAndFromThe:
			"Press Run and, from the moment the session starts, commits, saves, diagnostics and generation requests are recorded here in order.",
		noEventsRecordedYet: "No events recorded yet",
	},
	playtestDebugger: {
		testDebugger: "Test debugger",
		debuggerPanes: "Debugger panes",
	},
	stateTab: {
		onceHydrationFinishesItemsDefined:
			"Once hydration finishes, items defined with defineStoryState and definePersistentState appear here. A story with no definitions stays empty.",
		pressRunAndThisSession:
			"Press Run and this session's playthrough and long-term progress appear here. Values update with every commit; uncommitted changes can't be observed by the host.",
		theValuesHereAreCommitted:
			"The values here are **committed**. Changes before a commit have never left the VM, so the host can't observe them and doesn't draw them.",
		usepersistentstateItSurvivesResetPlay:
			"usePersistentState. It **survives** reset play; only resetting long-term progress empties this list.",
		thisStoryDoesnTDefine: "This story doesn't define usePersistentState.",
		usestorystateResetPlayEmptiesThis:
			"useStoryState. Reset play empties this list.",
		thisStoryDoesnTDefine2: "This story doesn't define useStoryState.",
		persistentStateLongTermProgress: "Persistent state: long-term progress",
		noSavedStateHasArrived: "No saved state has arrived yet",
		storyStateThisPlaythrough: "Story state: this playthrough",
		notRunning: "Not running",
		valueAtThePreviousCommit: "Value at the previous commit",
		justChanged: "Just changed",
		noneYet: "None yet",
		currentValue: "Current value",
	},
};
