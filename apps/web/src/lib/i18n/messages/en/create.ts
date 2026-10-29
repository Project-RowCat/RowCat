/**
 * Copy for the creation workspace (/create): drafts, the editor, publishing, analytics and comments.
 */
export const create = {
	coverFile: {
		inputHint: "{{formats}} · up to {{max}}MB ({{maxAnimated}}MB for GIF)",
		empty: "The file is empty. Please choose another image.",
		tooLarge:
			"Covers can be up to {{max}}MB ({{maxAnimated}}MB for GIF). Please choose a smaller file.",
		unsupported: "Only {{formats}} files can be uploaded.",
		restricted:
			"A restricted account can't change covers. Check the restriction on your account screen.",
		generic: "Couldn't change the cover. Please try again in a moment.",
		invalidImage: "Couldn't read the image. The file may be damaged.",
		tooManyFrames:
			"Animated covers can have up to {{max}} frames. Please choose a shorter image.",
		dimensionsTooLarge:
			"The resolution is too high. Reduce it to {{side}}px per side and {{megapixels}} megapixels in total, then upload it.",
		loginRequired: "You need to sign in.",
		notFound: "The story couldn't be found.",
	},
	manageDialog: {
		description:
			"Upload or remove the cover for <title>{{title}}</title>. Accepted formats and size: {{hint}}.",
		theCoverIsStillThere:
			"The cover is still there, but the story can't be viewed right now, so there's no preview. You can still replace or remove it.",
		notUploadedYetTheCover:
			"Not uploaded yet. The cover changes when you press upload.",
		deleteTheCoverTheStory: "Delete the cover? The story stays.",
		thisIsTheStoryS: "This is the story's current cover.",
		noCoverYet: "No cover yet.",
		selectedImage: "Selected image",
		coverImage: "Cover image",
		uploading: "Uploading…",
		uploadCover: "Upload cover",
		manageCover: "Manage cover",
		deleting: "Deleting…",
		deleteCover: "Delete cover",
		replaceCover: "Replace cover",
	},
	coverField: {
		stagedHint: "{{hint}}. It's uploaded when you publish.",
	},
	field: {
		thisCoverIsUploadedWhen:
			"This cover is uploaded when you publish. Until then it's only on this device.",
		choosingAFileUpdatesThe: "Choosing a file updates the story right away.",
		uploadingTheCover: "Uploading the cover…",
		removeChosenCover: "Remove chosen cover",
		pendingPublish: "Pending publish",
		cover: "Cover",
	},
	visibility: {
		hint: {
			private: "Only you can see it. You can make it public any time later.",
			unlisted:
				"It isn't shown in lists or search, and only people with the link can use it. Anyone who gets the link can open it.",
			public:
				"It goes up in the gallery the moment you publish, and anyone can see it.",
		},
		button: {
			private: "Publish privately",
			unlisted: "Publish as link-only",
			public: "Publish publicly",
		},
	},
	lifecycle: {
		label: {
			publish: "Make public",
			unlist: "Switch to link-only",
			unpublish: "Switch to private",
			archive: "Archive",
			restore: "Restore",
		},
		pending: {
			publish: "Making public…",
			unlist: "Switching…",
			unpublish: "Switching…",
			archive: "Archiving…",
			restore: "Restoring…",
		},
		failed: {
			publish: "Couldn't make it public. Please try again in a moment.",
			unlist: "Couldn't switch to link-only. Please try again in a moment.",
			unpublish: "Couldn't switch to private. Please try again in a moment.",
			archive: "Couldn't archive it. Please try again in a moment.",
			restore: "Couldn't restore it. Please try again in a moment.",
		},
		publish: {
			title: 'Make "{{title}}" public?',
			line1: "Once public, it goes up in the gallery and anyone can see it.",
			line2: "There is no review step: it goes public the moment you press.",
			line3: "You can switch it back to private at any time.",
			confirm: "Make public",
		},
		unlist: {
			title: 'Switch "{{title}}" to link-only?',
			line1: "It won't appear in the gallery, search or your creator profile.",
			line2:
				"Anyone who has the link can open it and start a conversation: there is no password and no expiry.",
			line3: "You can make it public or private again at any time.",
			confirm: "Link only",
		},
		archive: {
			title: 'Archive "{{title}}"?',
			line1:
				"The story is not deleted. Its cover and its views and favorites so far stay too.",
			line2:
				"Archived, it disappears from the gallery and its address, and it receives no new comments.",
			line3:
				"You can restore it as private later. Restoring doesn't make it public again.",
			confirm: "Archive",
		},
		error: {
			archived: "This story is already archived. Restore it, then try again.",
			notArchived: "This story isn't archived. Please refresh the list.",
			adult:
				"Only members who completed adult verification can make adult stories visible to others.",
			notFound: "The story couldn't be found.",
			cannotExpose: "You can't make stories visible right now.",
			cannotAct: "You can't do this right now.",
		},
	},
	publishPanel: {
		failure: {
			archived_unavailable:
				"You can't publish in the archived state. You can archive after publishing.",
			story_archived:
				"This story is archived. Restore it from the published list in Create, then publish again.",
			adult_not_permitted:
				"Only members who completed adult verification can publish adult stories.",
			origin_mismatch:
				"This story was published from a draft on another device. Edit it from that draft.",
			scene_image_invalid:
				"A scene image couldn't be found. Upload the picture again in the Scene images section.",
			runtime_invalid:
				"Couldn't publish the runtime code. Check the problems in the studio.",
			runtime_asset_invalid:
				"Couldn't publish the runtime assets. Upload the images and sounds again from the studio's asset list.",
			restricted:
				"A restricted account can't publish stories. Check the restriction on your account screen.",
			generic: "Couldn't publish. Please try again in a moment.",
		},
		alreadyPublished:
			"This draft is already published. Publishing again updates <link>this story</link> with the current content.",
		uploadsToTheServerYou:
			"Uploads to the server. You can change the visibility any time after publishing.",
		someThingsNeedFixingBefore:
			"Some things need fixing before you can publish",
		couldnTPublish: "Couldn't publish",
		publishing: "Publishing…",
		visibility: "Visibility",
		publishAgain: "Publish again",
		manageCover: "Manage cover",
		runtime: "Runtime",
		publish: "Publish",
	},
	workCard: {
		updated: "Updated {{at}}",
		manage: "Manage {{title}}",
		hiddenNote:
			"Operators have hidden this story. <link>Check restrictions</link>",
		theOriginalDraftIsnT: "The original draft isn't on this device.",
		protectedPrompt: "Protected prompt",
		hiddenByOperators: "Hidden by operators",
		manageCover: "Manage cover",
		viewStory: "View story",
		editDraft: "Edit draft",
		adult: "Adult",
	},
	analyticsWorkList: {
		count: "{{count}} stories",
	},
	workList: {
		stale:
			"The last refresh failed, so the list you received earlier is shown.",
		couldnTLoadMoreStories: "Couldn't load more stories. Please try again.",
		performanceByStory: "Performance by story",
		hiddenByOperators: "Hidden by operators",
		showMore: "Show more",
		story: "Story",
		finishADraftAndPublish:
			"Finish a draft and publish it to see it here. You can switch between public and private any time after publishing.",
		yourPublishedStoriesReloadOnce:
			"Your published stories reload once you're connected. Your drafts stay on this device.",
		couldnTLoadYourPublished: "Couldn't load your published stories.",
		yourDraftsStayOnThis: "Your drafts stay on this device.",
		youReNotConnectedRight: "You're not connected right now.",
		loadingYourPublishedStories: "Loading your published stories",
		noPublishedStoriesYet: "No published stories yet",
	},
	analytics: {
		metric: {
			views: "Views",
			playStarts: "Play starts",
			favorites: "Favorites",
			comments: "Comments",
		},
		windowed: "{{label}} · {{window}}",
		updated: "Updated {{at}}",
		captionAll:
			"Cumulative views and play starts across all your published stories, and their current favorites and comments.",
		captionWindow:
			"Views and play starts are counts for {{window}}; favorites and comments are current counts. Cumulative views {{views}} · cumulative play starts {{playStarts}}.",
		playStartConversionNote:
			"Views are folded by viewer and date; play starts count each room for conversations and each account for runtime stories. So this ratio can exceed 100%, and stories with different playback modes can't be compared.",
	},
	overview: {
		playStartsPerView: "Play starts per view",
		overallPerformance: "Overall performance",
	},
	panel: {
		onceYouPublishAStory:
			"Once you publish a story, its views, favorites and comments show up here.",
		analyticsReloadOnceYouRe:
			"Analytics reload once you're connected. Your drafts stay on this device.",
		theLastRefreshFailedSo:
			"The last refresh failed, so the values you received earlier are shown.",
		yourDraftsAndPublishedStories:
			"Your drafts and published stories are unaffected.",
		couldnTLoadAnalytics: "Couldn't load analytics.",
		youReNotConnectedRight: "You're not connected right now.",
		noStoriesToAnalyzeYet: "No stories to analyze yet",
		loadingAnalytics: "Loading analytics",
		analyticsPeriod: "Analytics period",
		yourSignInExpiredSo:
			"Your sign-in expired, so received comments can't be loaded. Your drafts stay on this device.",
		whenOthersCommentOnOr:
			"When others comment on or reply in your published stories, they gather here, newest first.",
		receivedCommentsReloadOnceYou:
			"Received comments reload once you're connected. Your drafts stay on this device.",
		theLastRefreshFailedSo2:
			"The last refresh failed, so the comments you received earlier are shown.",
		couldnTLoadMoreComments: "Couldn't load more comments. Please try again.",
		couldnTLoadReceivedComments: "Couldn't load received comments.",
		loadingReceivedComments: "Loading received comments",
		noCommentsReceivedYet: "No comments received yet",
		youNeedToSignIn: "You need to sign in again.",
		receivedComments: "Received comments",
		showMore: "Show more",
		signIn: "Sign in",
		report: "Report",
	},
	comments: {
		kind: {
			comment: "Comment",
			reply: "Reply",
		},
		unreachable: {
			hidden: "Hidden under the operating policy",
			archived: "Archived story",
			private: "Private story",
		},
		unnamed: "No name",
		menu: "{{name}}'s {{kind}} menu",
		untitled: "Untitled",
	},
	nav: {
		drafts: "Drafts",
		published: "Published",
		analytics: "Analytics",
		comments: "Comments",
		label: "Workspace",
	},
	drafts: {
		deleteNotice:
			"Only the draft is deleted. Stories you've already published stay.",
	},
	failure: {
		structure: "Couldn't save the changes. Please try again in a moment.",
		create: "Couldn't create the draft. Please try again in a moment.",
		delete: "Couldn't delete the draft. Please try again in a moment.",
	},
	list: {
		deleteDraft: "Delete draft {{title}}",
		modifiedSuffix: "modified",
		draftsAreSavedOnThis:
			"Drafts are saved on this device. They stay even without a title and without publishing.",
		noDraftsYet: "No drafts yet",
		createANewStory: "Create a new story",
		published: "Published",
		unpublished: "Unpublished",
		story: "Story",
		status: "Status",
		modified: "Modified",
	},
	createHomePage: {
		draftsAreSavedOnThis:
			"Drafts are saved on this device per account. Sign in again and they're still there.",
		createCanTBeOpened: "Create can't be opened",
		creating: "Creating…",
		newStory: "New story",
		create: "Create",
		signIn: "Sign in",
	},
	createSkeleton: {
		theFullStorySetupThe: "The full story setup the model reads every turn.",
		loadingTheWorkspace: "Loading the workspace",
		thisIsWhatShowsIn: "This is what shows in the gallery.",
		loadingTheDraft: "Loading the draft",
		basics: "Basics",
		prompt: "Prompt",
	},
	useActions: {
		addLore: "Add lore",
	},
	useAutosave: {
		couldnTSave: "Couldn't save",
	},
	leave: {
		title: "Your changes haven't been saved yet",
		description:
			"Edits that couldn't be saved on this device remain. If you leave now, they'll be lost.",
		retryFailed:
			"Saving failed again. Try again in a moment, or leave without saving.",
		stay: "Stay on this screen",
		retry: "Try again",
		retrying: "Saving…",
		discard: "Leave without saving",
	},
	promptExpand: {
		open: "Edit full screen",
		title: "Edit full screen",
		description: "Edit the same text in a wider space. Autosave keeps running.",
		close: "Done",
	},
	promptRuntimeLock: {
		title: "Stories with runtime on don't use this prompt.",
		body: "AI requests are built inside the runtime code. The prompt you wrote is kept, and you can edit it again once runtime is off.",
	},
	lorePosition: {
		system_top: "Before the system prompt",
		system_bottom: "After the system prompt",
		before_history: "Before the conversation history",
	},
	loreSection: {
		title: "Lore",
		description:
			"Settings inserted into the prompt when a keyword comes up in the conversation. Turn on 'Always include' to always send it.",
	},
	loreRuntimeLock: {
		title: "Stories with runtime on don't use lore.",
		body: "Lore is inserted into the conversation prompt, but a runtime story's AI requests are built inside the runtime code. The lore you wrote is kept, and you can edit it again once runtime is off.",
	},
	sceneImageSection: {
		title: "Scene images",
		description:
			"Shows a scene as a picture during the conversation. When a reply mentions a trigger, the picture is attached; you can also write [img:trigger] in the text yourself.",
	},
	sceneImageRuntimeLock: {
		title: "Stories with runtime on don't use scene images.",
		body: "Scene images are pictures attached to conversation replies, but runtime stories don't open a conversation room. Runtime code draws pictures on screen. The pictures you uploaded are kept, and you can edit them again once runtime is off.",
	},
	startSceneSection: {
		title: "Opening scenes",
		description:
			"The opening when a conversation starts. The scene chosen as default is published.",
	},
	startSceneRuntimeLock: {
		title: "Stories with runtime on don't use opening scenes.",
		body: "Runtime stories don't open a conversation room, so there is no place for an opening. Runtime code draws the first screen. The scenes you wrote are kept, and you can edit them again once runtime is off.",
	},
	lore: {
		noKeywords: "No keywords",
		alwaysInclude: "Always include",
		priority: "Priority {{order}}",
		nth: "#{{n}}",
		manage: "Manage lore #{{n}}",
	},
	startScene: {
		nth: "Scene #{{n}}",
		manage: "Manage scene #{{n}}",
		untitled: "Untitled scene",
	},
	runtimePending: "Checking runtime settings…",
	sceneImage: {
		inputHint: "{{formats}} · up to {{max}}MB",
		empty: "The file is empty. Please choose another image.",
		tooLarge:
			"Scene images can be up to {{max}}MB. Please choose a smaller file.",
		unsupported: "Only {{formats}} files can be uploaded.",
		generic: "Couldn't upload the scene image. Please try again in a moment.",
		invalidImage: "Couldn't read the image. The file may be damaged.",
		invalidDimensions: "The image is too large. Please reduce its resolution.",
		storageFailed: "Couldn't save the image. Please try again in a moment.",
		triggerHint:
			"When '{{trigger}}' appears in a reply, this picture is attached. You can also write {{token}} in the text yourself.",
		deleteNamed: "Delete scene image '{{trigger}}'",
		deleteNth: "Delete scene image #{{n}}",
		empty_list: "No scene images yet. {{hint}}",
	},
	tagInput: {
		remove: "Remove tag {{tag}}",
		noMoreTagsCanBe: "No more tags can be added",
		typeAndPressEnter: "Type and press Enter",
		tags: "Tags",
	},
	fields: {
		overflow: "Cut {{count}} characters to publish.",
	},
	page: {
		orientationUnset: "Not set",
		ifYouMadeItIn:
			"If you made it in another account, sign in with that account. Drafts are saved on the device per account.",
		withoutAdultVerificationThisCan:
			"Without adult verification this can't be published as is. Turn off the marker to publish.",
		onlyMembersWhoCompletedAdult:
			"Only members who completed adult verification can mark a story as adult. The server makes the final decision.",
		thisTextIsSentAs:
			"This text is sent as the story setup as is. Lore and opening scenes are sent separately.",
		writeTheWorldCharactersCounterpart:
			"Write the world, characters, counterpart and play rules in one place, in any format you like.",
		marksTheCreativePromptAs:
			"Marks the creative prompt as not shown on screen. It isn't encryption.",
		onlyMembersWhoCompletedAdult2:
			"Only members who completed adult verification can publish. The server makes the final decision.",
		theFullStorySetupThe: "The full story setup the model reads every turn.",
		sentAlongWhenAConversation: "Sent along when a conversation starts.",
		thisDraftIsnTIn: "This draft isn't in this account.",
		thisIsWhatShowsIn: "This is what shows in the gallery.",
		thisIsWhatShowsIn2: "This is what shows in the gallery",
		backToDrafts: "Back to drafts",
		protectPrompt: "Protect prompt",
		theNightLibrary: "The Night Library",
		oneLineIntro: "One-line intro",
		drafts: "Drafts",
		basics: "Basics",
		prompt: "Prompt",
		published: "Published",
		adult: "Adult",
		title: "Title",
		description: "Description",
		orientation: "Orientation",
	},
	autosave: {
		idle: "",
		pending: "Waiting to save…",
		saving: "Saving…",
		saved: "Saved",
		error: "Couldn't save",
	},
	previewSection: {
		drawnWithACoverThat:
			"Drawn with a cover that isn't uploaded yet. It's uploaded when you publish.",
		thisIsHowItAppears: "This is how it appears in the gallery once published.",
		enterATitleToSee: "Enter a title to see it on the card.",
		preview: "Preview",
	},
	headerContext: {
		draft: "Draft",
	},
	promptField: {
		storySetup: "Story setup",
	},
	sceneImageList: {
		enterTheWordThatCalls:
			"Enter the word that calls up this picture. If it's empty, it isn't published.",
		theSameTriggerAlreadyExists:
			"The same trigger already exists above. Only the picture above appears in conversations.",
		darkHallway: "Dark hallway",
		addImage: "Add image",
		trigger: "Trigger",
	},
	startSceneList: {
		noOpeningScenesYetYou:
			"No opening scenes yet. You can publish without one, but an opening keeps the conversation's style and point of view much steadier.",
		add: "Add",
	},
	loreList: {
		noLoreYetYouCan: "No lore yet. You can publish without lore.",
	},
	loreEditorCard: {
		separateWithCommasCaseDoesn: "Separate with commas. Case doesn't matter.",
		whenOnItSSent: "When on, it's sent every turn regardless of keywords.",
		withinTheSamePositionHigher:
			"Within the same position, higher numbers go first.",
		libraryLibrarian: "library, librarian",
		deleteLore: "Delete lore",
		alwaysInclude: "Always include",
		insertionPosition: "Insertion position",
		priority: "Priority",
		down: "Down",
		keywords: "Keywords",
		up: "Up",
		content: "Content",
	},
	startSceneEditorCard: {
		setAsDefaultOpening: "Set as default opening",
		theLibraryAtDawn: "The library at dawn",
		defaultOpening: "Default opening",
		deleteScene: "Delete scene",
		sceneTitle: "Scene title",
		down: "Down",
		up: "Up",
		body: "Body",
	},
	recovery: {
		notice:
			"Another device edited the same part at the same time, so the edit that didn't make it was kept aside.",
		open: "Review",
		title: "Kept edits",
		description:
			"When two devices edit the same part at the same time, only one side remains. The other side is kept here.",
		empty: "No kept edits.",
		orphaned:
			"The draft this edit belongs to no longer exists. You can still read it, but there's nowhere to restore it to.",
		restore: "Restore this version",
		discard: "Delete kept version",
		cancel: "Cancel",
		discardConfirm:
			"The kept version is deleted permanently. The current draft doesn't change.",
		restoreFailed: "Couldn't restore. Please try again in a moment.",
		discardFailed: "Couldn't delete. Please try again in a moment.",
		restoreMissing:
			"The draft this edit belongs to no longer exists, so it can't be restored.",
		preservedColumn: "Kept version",
		currentColumn: "Current version",
		emptyValue: "(empty)",
		summaryLabel: "Recoverable edits",
		restoreConfirm:
			"The current “{{group}}” content will be replaced with the kept version. Everything else stays.",
		orientationUnset: "Not set",
		defaultSceneUnset: "None",
		on: "On",
		off: "Off",
		group: {
			meta: "Basics",
			rating: "Visibility settings",
			body: "Prompt",
			defaults: "Default opening scene",
		},
		field: {
			title: "Title",
			tagline: "One-line intro",
			description: "Description",
			tags: "Tags",
			orientation: "Orientation",
			adult: "Adult",
			visibility: "Visibility",
			promptProtected: "Protect prompt",
			prompt: "Prompt",
			defaultStartSceneId: "Default opening scene",
		},
	},
};
