/**
 * Copy for the runtime studio (/create/:draftId/runtime) and the editor's runtime section.
 */
export const runtimeStudio = {
	intro: {
		title: "Build a custom interactive experience",
		body: "Build this story's own screens and interactions in TypeScript and TSX. Start from a template or an empty project; the prompt, lore, opening scenes and scene images you have now stay as they are.",
		action: "Get started",
		capability1: "Custom UI",
		capability2: "Interactive state",
		capability3: "Reusable components",
		capability4: "Branching progress",
	},
	section: {
		title: "Runtime",
		description:
			"An optional extension built with code. The story publishes as usual without it.",
		enabledBadge: "On",
		disabledBadge: "Off",
		open: "Open studio",
		disable: "Turn off runtime",
		enable: "Turn runtime back on",
		confidentiality:
			"Runtime code runs on players' devices, so it is not a place for secrets. Don't put values that must not be public, such as passwords or API keys, in the code.",
		publishNotice:
			"When you publish the story, the runtime is published with it. The code is compiled on the server, and players receive and run the result.",
		savedCheckClean:
			"Structure check of the saved code: no problems. Type checking and compilation happen on the server at publish time.",
		savedCheckFailed:
			"Couldn't check the saved code. Please review it in the studio.",
		savedCheckOpen: "Fix in studio",
		savedCheckProblems:
			"Structure check of the saved code: {{errors}} problems. The server will reject it if published as is.",
		loadingProject: "Loading the project…",
		fileCount: "{{count}} files are attached to this story.",
	},
	disableConfirm: {
		title: "Turn off runtime?",
		body: "The code you wrote stays. Turn it back on to continue from where you are.",
		confirm: "Turn off runtime",
		cancel: "Cancel",
	},
	studio: {
		title: "Runtime Studio",
		back: "Back to the draft editor",
		open: "Open",
		newFile: "New file",
		newFolder: "New folder",
		rename: "Rename",
		copyPath: "Copy path",
		collapseAll: "Collapse all",
		remove: "Delete",
		explorer: "Explorer",
		preview: "Preview",
		showPreview: "Show preview",
		hidePreview: "Hide preview",
		panel: "Tool panel",
		openPanel: "Open panel",
		closePanel: "Close panel",
		openProblems: "Open problems panel",
		closeTab: "Close",
		closeOtherTabs: "Close other tabs",
		closeAllTabs: "Close all tabs",
		tabMenu: "Tab menu",
		revealInExplorer: "Reveal in explorer",
		studioMenu: "Studio menu",
		layout: "Layout",
		showExplorer: "Show explorer",
		hideExplorer: "Hide explorer",
		resetLayout: "Reset panel sizes",
		quickOpen: "Open file",
		quickOpenPlaceholder: "File name or path",
		quickOpenEmpty: "No matching files.",
		quickOpenResults: "Search results",
		commandPalette: "Command palette",
		commandPalettePlaceholder: "Command name",
		commandPaletteEmpty: "No matching commands.",
		commandPaletteResults: "Commands",
		breadcrumb: "File location",
		breadcrumbMenu: "File menu",
		problemsFilter: "Problem filter",
		problemsFilterAll: "All",
		problemsFilterErrors: "Errors",
		problemsFilterWarnings: "Warnings",
		problemsFilterEmpty: "No problems at this level.",
		openEntry: "Open entry file",
	},
	onboarding: {
		title: "If this is your first time",
		run: "Run it in the preview",
		problems: "Errors gather in the Problems pane",
		dismiss: "Dismiss guide",
		edit: "Start by editing {{entry}}",
	},
	explorerEmpty: {
		title: "No files yet.",
	},
	editorEmpty: {
		noFiles: "There are no files to write code in.",
		noFilesAction: "Create a new file",
		noSelection: "Pick a file in the explorer to start editing.",
		noSelectionShortcut: "Open file",
	},
	copyPath: {
		copied: "Copied the path.",
		failed: "Couldn't copy the path.",
	},
	assets: {
		title: "Assets",
		description: "Pictures and sounds the code calls by name.",
		empty: "No assets bound yet.",
		add: "Add asset",
		nameLabel: "Asset name",
		namePlaceholder: "characters/sena/smile",
		rename: "Rename",
		replace: "Replace file",
		replaceKindImage: "An image can only be replaced with an image.",
		replaceKindAudio: "A sound can only be replaced with a sound.",
		remove: "Remove from list",
		copyName: "Copy name",
		copyCall: "Copy asset(...)",
		copied: "Copied.",
		copyFailed: "Couldn't copy.",
		publishNotice:
			"Changed assets reach the story only after you publish again.",
		renameNotice:
			"Renaming doesn't change the code automatically. Please update it yourself.",
		cancel: "Cancel",
		confirm: "Save",
		searchLabel: "Find by asset name",
		searchPlaceholder: "Find by name",
		kindFilterLabel: "Asset kind",
		noMatch: "No assets match.",
		clearQuery: "Clear filters",
		referencesHeading: "Places written directly in the code",
		nameHint: 'Call it from code with `asset("name")`.',
		kindFilter: {
			all: "All",
			image: "Images",
			audio: "Sounds",
		},
		assembled:
			"{{count}} places assemble a name, so it can't be confirmed whether they use this name.",
		moreReferences: "and {{count}} more",
		removeConfirm: {
			titleAudio: "Remove the sound from the list?",
			titleImage: "Remove the image from the list?",
			descriptionAudio:
				"The name `{{path}}` disappears. The uploaded sound itself isn't deleted, and stories you've already published keep playing it until you publish again.",
			descriptionImage:
				"The name `{{path}}` disappears. The uploaded image itself isn't deleted, and stories you've already published keep showing it until you publish again.",
			consequenceAudio:
				"Until another sound is bound to that name, those places make no sound.",
			consequenceImage:
				"Until another image is bound to that name, those places show a placeholder.",
			confirm: "Remove",
			cancel: "Cancel",
		},
		referenceNotice:
			"This name is written directly in the code in {{count}} places. {{consequence}}",
		actions: "Actions for {{path}}",
	},
	deleteConfirm: {
		title: "Delete the file?",
		body: "{{path}} is removed from this project. This can't be undone.",
		confirm: "Delete",
		cancel: "Cancel",
	},
	actionFailure: "Couldn't save this action. Please try again in a moment.",
	problemSource: {
		module: "Module resolution",
		policy: "Runtime policy",
		runtime: "Compiler",
	},
	problemsEmpty: {
		title: "No problems",
		body: "Type and syntax errors and the runtime compiler's diagnostics gather here. Output and diagnostics while running go to the Console pane.",
	},
	assetKind: {
		image: "Image",
		audio: "Sound",
	},
	compile: {
		idle: "Waiting to check",
		checking: "Checking…",
		clean: "No problems",
		failed: "Check failed",
		warnings_one: "{{value}} warning",
		warnings_other: "{{value}} warnings",
		problems_one: "{{value}} problem",
		problems_other: "{{value}} problems",
		checkerFailed:
			"Couldn't run the runtime checker. The code is still saved.{{detail}}",
	},
	assetName: {
		invalidShape: "Write names like `characters/sena/smile`.",
	},
	bottomPanel: {
		errorPrefix: "errors ",
		warningPrefix: "warnings ",
		error: "Error",
		warning: "Warning",
	},
	tabs: {
		close: "Close tab {{path}}",
		closeOtherTabs: "Close other tabs",
		openFiles: "Open files",
	},
	imageFile: {
		empty: "The file is empty. Please choose another image.",
		tooLarge:
			"Runtime images can be up to {{max}}MB. Please choose a smaller file.",
		unsupported: "Only {{formats}} files can be uploaded.",
		generic: "Couldn't upload the image. Please try again in a moment.",
		invalidImage: "Couldn't read the image. The file may be damaged.",
		invalidDimensions: "The image is too large. Please reduce its resolution.",
		storageFailed: "Couldn't save the image. Please try again in a moment.",
		inputHint: "{{formats}} · up to {{max}}MB",
	},
	audioFile: {
		empty: "The file is empty. Please choose another file.",
		tooLarge:
			"Runtime sounds can be up to {{max}}MB. Please choose a smaller file.",
		unsupported: "Only {{formats}} files can be uploaded.",
		generic: "Couldn't upload the sound. Please try again in a moment.",
		invalidAudio: "Couldn't read the sound file. The file may be damaged.",
		tooLong:
			"Sounds can be up to {{minutes}} minutes long. Please choose a shorter file.",
		storageFailed: "Couldn't save the sound. Please try again in a moment.",
		inputHint: "{{formats}} · up to {{max}}MB · {{minutes}} min",
	},
	mobileTab: {
		files: "Files",
		code: "Code",
		preview: "Preview",
	},
	explorer: {
		folder: "Folder {{name}}",
		menu: "{{label}} menu",
	},
	runtimePreview: {
		runtimePreview: "Runtime preview",
	},
	codeEditor: {
		runtimeCodeEditor: "Runtime code editor",
	},
	runtimeOnboardingStrip: {
		dismissGuide: "Dismiss guide",
	},
	deleteDialog: {
		deleteThisFile: "Delete this file?",
	},
	runtimeStudioPage: {
		draftsAreSavedOnThe:
			"Drafts are saved on the device per account. If you made it in another account, sign in with that account.",
		youCanTurnItOn: "You can turn it on in the draft editor's Runtime section.",
		runtimeIsnTOnFor: "Runtime isn't on for this draft.",
		thisDraftIsnTIn: "This draft isn't in this account.",
		loadingTheProject: "Loading the project…",
		loadingTheEditor: "Loading the editor…",
		backToDrafts: "Back to drafts",
		previewWidth: "Preview width",
		quickOpen: "Quick open",
		explorerWidth: "Explorer width",
		panelHeight: "Panel height",
		files: "Files",
	},
	runtimeSection: {
		runtimeIsOffTheCode:
			"Runtime is off. The code you wrote stays, and you can continue once you turn it back on.",
	},
	panel: {
		newFile: "New file",
	},
	breadcrumb: {
		closeAllTabs: "Close all tabs",
	},
	mobileTabs: {
		workspace: "Workspace",
	},
	pathIssue: {
		empty: "Please enter a path.",
		too_long: "A path can't exceed {{max}} characters.",
		too_deep: "Folders can be nested only {{max}} levels deep.",
		traversal: "A path can't point outside the project.",
		segment_too_long: "A name can't exceed {{max}} characters.",
		invalid_character: "Only letters, digits and `.`, `_`, `-` can be used.",
		unsupported_extension: "Only {{extensions}} files can be created.",
		content_too_long: "A file can't exceed {{max}} characters.",
		file: {
			too_many: "Up to {{max}} files can be created.",
			duplicate: "A file with the same path already exists.",
		},
		asset: {
			too_many: "Up to {{max}} images can be bound.",
			duplicate: "An image with the same name already exists.",
		},
	},
	beta: {
		label: "Beta",
		srPrefix: "Creator runtime ",
		promise:
			"The creator runtime is in beta. The current public API grows while staying compatible, and any breaking change is announced in advance.",
	},
};
