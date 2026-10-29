/**
 * Copy for the conversation room: messages, the composer, room settings, memory and search.
 */
export const chat = {
	characters: {
		summary: {
			none: "Add characters to this conversation",
			added: "{{added}} added",
			story: "{{fromStory}} from the story",
			both: "{{fromStory}} from the story · {{added}} added",
		},
		limit: "You can add up to {{limit}} characters.",
		edit: "Edit {{name}}",
		delete: "Delete {{name}}",
		promptPlaceholder:
			"Write freely about anything you want to say about this character, such as looks, personality, speech, or their relationship with {{user}}.",
		seedCount:
			"The story's {{count}} characters keep appearing separately from this list.",
		theseCharactersAppearOnlyIn:
			"These characters appear only in this conversation. They don't affect other conversations or the original story.",
		couldnTSaveTheCharacter: "Couldn't save the character. Please try again.",
		ifLeftEmptyOnlyThe: "If left empty, only the name goes on the cast list.",
		noCharactersAddedYet: "No characters added yet.",
		addCharacter: "Add character",
		name: "Name",
		description: "Description",
		add: "Add",
	},
	userNote: {
		summary: {
			none: "Set how this conversation goes",
			written: "{{count}} characters written",
		},
		saveFailed: "Couldn't save the user note. Please try again.",
		tooLong: "A user note can be up to {{max}} characters.",
		description:
			"Write a request to the model about how this conversation should go. It's sent with every reply and doesn't affect other conversations.",
		placeholder:
			"e.g. Keep descriptions short and focus on dialogue. Leave a blank line when the scene changes.",
		savingItEmptyClearsThis:
			"Saving it empty clears this conversation's user note.",
		userNote: "User note",
	},
	intensity: {
		notApplied: "{{label}} · not applied now",
		default: "Default",
		defaultDescription: "Uses exactly what the story and its rating set.",
		label: {
			softened: "Softened",
			intense: "Intense",
		},
		description: {
			softened:
				"Sexual scenes and graphic violence are handled through suggestion and implication. Conflict, tension and dark turns stay as they are.",
			intense:
				"Requested scenes are described concretely, without avoiding them or glossing over them.",
		},
		allAgesNotice:
			"This is an all-ages story, so «Intense» can't be chosen. Even at this rating, dark turns such as conflict, combat and death are still handled.",
		adultLockedNotice:
			"This conversation is running as all-ages right now, so «Intense» isn't applied. Your choice is kept and is used again once you can view adult content.",
		ratingNote: "Intensity only applies within what the story's rating allows.",
		saveFailed: "Couldn't save the intensity. Please try again.",
		intensity: "Intensity",
	},
	roomSettings: {
		back: "Back to {{title}}",
		title: {
			home: "Conversation settings",
			generation: "Generation settings",
			persona: "Persona",
			narration: "Narration",
			intensity: "Intensity",
			characters: "Characters",
			userNote: "User note",
			info: "Conversation info",
		},
	},
	narration: {
		scope: {
			strict: "Only I write my character",
			reactive: "Default",
			assisted: "AI assists",
			auto: "Autoplay",
		},
		scopeDescription: {
			strict:
				"The AI never writes my character for me. It continues from the last action I wrote.",
			reactive: "Characters react to everything I wrote.",
			assisted: "The AI also continues my character's actions and lines.",
			auto: "The AI writes even my thoughts and feelings. You read along as if watching.",
		},
		off: "Off",
		offDescription: "No narration instructions are added. Same as now.",
		density: {
			light: "Concise",
			rich: "Rich",
		},
		densityDescription: {
			light: "Lightly polishes the style.",
			rich: "Writes dense description. The prompt gets longer, so each request uses more tokens.",
		},
		lockedHint:
			"Turn it on to choose description density and character cards here.",
		cast: "Character cards",
		castDescription:
			"Attaches a card summarizing the characters' state below each reply. It helps stories with many characters; the prompt gets longer, so each request uses more tokens.",
		unsupported:
			"The model this conversation uses doesn't apply narration instructions. Your choice is kept and is used again if you switch to a model that applies them.",
		catalogUnknown:
			"The model list couldn't be loaded, so it's unclear whether this applies right now.",
		densityFolded: "This model has only one density, so that one is applied.",
		saveFailed: "Couldn't save the narration. Please try again.",
		singleDensity: "This model has only one density: «{{label}}».",
		notApplied: "{{label}} · not applied on this model",
		credit: {
			heading: "Attribution and license notice",
			line1: "Original author: Jakho (CHZZK streamer)",
			line2: "Provided as: with the original author's permission and license",
			line3:
				"Scope of use: RowCat's story progression and conversation generation features",
			body: "The components based on the 'Goseumdochi' (Hedgehog) project included in RowCat were ported under a license formally granted by the original author, Jakho. The rights to these components belong to the original author, and RowCat uses them within the scope of the granted license.",
			thanks: "Our deep thanks to Jakho for sharing this valuable work.",
		},
		narrationScope: "Narration scope",
		descriptionDensity: "Description density",
	},
	persona: {
		edit: "Edit persona {{title}}",
		thisConversationSPersona: "This conversation's persona",
		saveAndApply: "Save and apply",
		managePersonas: "Manage personas",
		createAndApply: "Create and apply",
		newPersona: "New persona",
	},
	generation: {
		connect: "Connect {{provider}} in AI settings",
		defaultsNote:
			"Anything this conversation doesn't set follows the <link>default AI settings</link>. Values chosen here apply only on this device.",
		howDeeplyToThinkBefore:
			"How deeply to think before replying in this conversation.",
		couldnTSaveTheSettings: "Couldn't save the settings. Please try again.",
		howLongTheRepliesIn: "How long the replies in this conversation are.",
		theModelThatGeneratesThis: "The model that generates this conversation.",
		defaults: "Defaults",
	},
	info: {
		recentCount: "The last {{count}} replies.",
		unreported:
			" {{count}} of them didn't report usage, so they aren't counted in the totals.",
		input: "Input",
		cachedInput: "Cached input",
		output: "Output",
		theCreatorProtectedThisStory:
			"The creator protected this story, so its creative prompt isn't shown.",
		thisConversationDidnTStart: "This conversation didn't start from a story.",
		thisConversationStartedFromAn:
			"This conversation started from an adult story.",
		viewTheOriginalStory: "View the original story",
		usageNotReported: "Usage not reported",
		cutAtTheLimit: "Cut at the limit",
		recentUsage: "Recent usage",
		unknownModel: "Unknown model",
		prompt: "Prompt",
		startedFrom: "Started from",
		rating: "Rating",
		interrupted: "Interrupted",
	},
	home: {
		notAvailableOnThisDevice: "Not available on this device",
		manageWhatThisConversationRemembers:
			"Manage what this conversation remembers",
		originalStoryAndConversationDetails:
			"Original story and conversation details",
		generationSettings: "Generation settings",
		narration: "Narration",
		intensity: "Intensity",
		userNote: "User note",
		conversationInfo: "Conversation info",
		rename: "Rename",
		deleteConversation: "Delete conversation",
		persona: "Persona",
		characters: "Characters",
		generation: "Generation",
		conversation: "Conversation",
		memory: "Memory",
		manage: "Manage",
	},
	memory: {
		rejection: {
			empty: "Please enter something to remember.",
			too_long: "A memory can be up to {{max}} characters.",
		},
		limit:
			"Each conversation can store up to {{max}} memories. Please delete memories you don't need.",
		full: "Memories have reached the per-conversation limit ({{max}}). Delete an existing memory to add a new one.",
		unpin: "Unpin memory {{label}}",
		pin: "Pin memory {{label}}",
		edit: "Edit memory {{label}}",
		delete: "Delete memory {{label}}",
		saveFailed: "Couldn't save the memory. Please try again.",
		deleteFailed: "Couldn't delete the memory. Please try again.",
		roomGone:
			"This conversation no longer exists, so the memory can't be saved.",
	},
	rename: {
		rejection: {
			empty: "Please enter a conversation name.",
			too_long: "A name can be up to {{max}} characters.",
		},
		failed: "Couldn't rename it. Please try again.",
		deleteFailed: "Couldn't delete the conversation. Please try again.",
	},
	roomActions: {
		label: "Manage conversation {{title}}",
		action: {
			rename: "Rename",
			settings: "Conversation settings",
			delete: "Delete conversation",
		},
	},
	messageActions: {
		deleteOne: "This message will be deleted.",
		deleteMany: "This message and the {{later}} after it will be deleted.",
		regenerateWarning:
			"Regenerating from this reply deletes the {{later}} messages after it.",
		synced:
			"If sync is set up, the change reaches your other devices after the next sync.",
		editUser: "Edits your message stored on this device. {{synced}}",
		editAssistant:
			"Edits the text of the reply stored on this device. The reply isn't generated again. {{synced}}",
		editWarning: "Saving deletes the {{later}} messages after this one.",
		empty: "Please enter a message.",
		editFailed: "Couldn't edit the message. Please try again.",
		deleteFromFailed: "Couldn't delete the conversation. Please try again.",
		regenerateFailed: "Couldn't regenerate. Please try again.",
	},
	summary: {
		response: "{{model}} · {{length}} replies",
		reasoning: "{{effort}} reasoning",
	},
	search: {
		me: "Me",
		other: "Other",
		count: "{{count}} messages",
	},
	deleteDialog: {
		description:
			"<title>{{title}}</title> and its stored messages and memories will be deleted from this device. If sync is set up, the deletion reaches your other devices after the next sync.",
		deleteThisConversation: "Delete this conversation?",
		deleting: "Deleting…",
	},
	suggestion: {
		malformed: "Couldn't make suggested lines.",
	},
	trackingPanel: {
		cast: "Character cards",
	},
	chatHeaderContext: {
		findInConversation: "Find in conversation",
		conversationSettings: "Conversation settings",
		conversation: "Conversation",
	},
	dialog: {
		savedMemoriesAreSentAlong:
			"Saved memories are sent along when replies in this conversation are made. When there are many, pinned memories go first.",
		youCanAddInformationYou:
			"You can add information you want the conversation to keep remembering.",
		noMemoriesSavedYet: "No memories saved yet.",
		loadingMemories: "Loading memories…",
		deleteThisMemory: "Delete this memory?",
		rememberedByAi: "Remembered by AI",
		whatToRemember: "What to remember",
		savedMemories: "Saved memories",
		addMemory: "Add memory",
		pinMemory: "Pin memory",
		memoryContent: "Memory content",
		savedByYou: "Saved by you",
		saving: "Saving…",
		pinned: "Pinned",
		memory: "Memory",
		add: "Add",
		other: "Other",
		searchesTheMessagesStoredIn:
			"Searches the messages stored in this conversation. Searching happens only on this device.",
		enterWhatToFindIn: "Enter what to find in the conversation.",
		readingTheConversation: "Reading the conversation.",
		noResults: "No results.",
		findInConversation: "Find in conversation",
		searchTerms: "Search terms",
		showMore: "Show more",
	},
	chatShell: {
		conversations: "← Conversations",
	},
	panel: {
		suggestedRepliesPickingOneFills:
			"Suggested replies · picking one fills the message box",
		noReplyWasReceived: "No reply was received",
		choosingASuggestion: "Choosing a suggestion",
		closeSuggestedReplies: "Close suggested replies",
		suggestedReplies: "Suggested replies",
	},
	chatPage: {
		thisConversationIsnTIn:
			"This conversation isn't in the current account on this device. If you started it in another account, sign in with that account.",
		theConversationStartsWhenYou:
			"The conversation starts when you send the first message.",
		scrollingDownAlsoContinuesGenerating:
			"Scrolling down also continues generating.",
		theReplyWasCutOff: "The reply was cut off at the length limit.",
		theReplyWasCutOff2: "The reply was cut off midway.",
		conversationNotFound: "Conversation not found",
		backToConversations: "Back to conversations",
		discoverStories: "Discover stories",
		continueGenerating: "Continue generating",
	},
	composer: {
		loadingTheConversation: "Loading the conversation",
		typeAMessage: "Type a message",
		insertActionMarker: "Insert action marker",
		message: "Message",
		stopGenerating: "Stop generating",
		send: "Send",
	},
	renameDialog: {
		theNameOfTheConversation:
			"The name of the conversation stored on this device. If sync is set up, it reaches your other devices after the next sync.",
		rename: "Rename",
		conversationName: "Conversation name",
	},
	recentChats: {
		noConversations: "No conversations",
	},
	list: {
		generatingAReply: "Generating a reply",
		loadEarlierMessages: "Load earlier messages",
		jumpToLatest: "Jump to latest",
	},
	editDialog: {
		editMessage: "Edit message",
		messageContent: "Message content",
	},
	useActions: {
		regenerateFromThisReply: "Regenerate from this reply?",
		thisReplyIsGeneratedAgain: "This reply is generated again.",
		deleteFromHere: "Delete from here?",
		regenerate: "Regenerate",
		cleaningUp: "Cleaning up…",
		aiReply: "AI reply",
	},
	actionBar: {
		regenerateFromThisReply: "Regenerate from this reply",
		myMessageMenu: "My message menu",
		reportThisReply: "Report this reply",
		deleteFromHere: "Delete from here",
		editMessage: "Edit message",
		replyMenu: "Reply menu",
		regenerate: "Regenerate",
		report: "Report",
	},
	row: {
		theReplyWasCutOff: "The reply was cut off midway",
	},
	saving: "Saving…",
	deleting: "Deleting…",
	conversation: "Conversation",
};
