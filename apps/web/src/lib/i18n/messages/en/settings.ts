/**
 * Copy for /settings: general, appearance, theme colors, this device's data, generation defaults and AI providers.
 */
export const settings = {
	theme: {
		preset: {
			default: "Default",
			white: "White",
			gray: "Gray",
			black: "Black",
		},
		sectionTitle: "Theme",
		sectionDescription:
			"This setting is saved to your account, applies on other devices you're signed in to, and uses the same colors in light and dark mode.",
		presetGroupTitle: "Preset colors",
		presetGroupDescription: "Choose one of the color sets RowCat prepared.",
		customGroupTitle: "Custom colors",
		customGroupDescription:
			"Set the background, surface and accent colors, and a background gradient, to the colors you want.",
		foregroundNote:
			"Text color adjusts automatically to the colors you choose.",
		save: "Save colors",
		saveNote: "Custom colors apply to your account only after you save.",
		resetMenu: "Reset",
		clearColors: "Reset custom colors",
		resetAll: "Reset entire theme",
		slotPreset: "Use preset color",
		slotUnset: "Preset color",
		pickerSurface: "color saturation and brightness",
		pickerHue: "color hue",
		pickerHex: "color code",
		pickerCurrent: "current color",
		invalidValue: "Only colors in #rrggbb format can be used.",
		gradientToggle: "Background gradient",
		gradientToggleDescription:
			"Draws the background as a gradient between two colors.",
		gradientFrom: "Start color",
		gradientFromNote: "The background color above is used as is.",
		gradientTo: "End color",
		gradientToDescription: "Blends from the background color into this one.",
		gradientToControl: "Gradient end",
		gradientAngle: "Direction",
		gradientAngleUnit: "°",
		gradientContrast:
			"The two colors differ a lot in brightness, so text may be hard to read.",
		randomPalette: "Random palette",
		randomGradient: "Random gradient",
		previewTitle: "Theme preview",
		previewNote: "Until you save, the preview applies only inside this box.",
		slot: {
			background: "Background",
			surface: "Surface",
			primary: "Accent",
		},
		slotDescription: {
			background: "The default background of the whole page.",
			surface: "The background of cards, popovers and the sidebar.",
			primary: "The accent used for buttons and selected items.",
		},
		failure: {
			preset: "Couldn't save the preset color. Please try again in a moment.",
			colors: "Couldn't save the colors. Please try again in a moment.",
			clearColors:
				"Couldn't reset the custom colors. Please try again in a moment.",
			resetAll: "Couldn't reset the theme. Please try again in a moment.",
		},
	},
	nav: {
		general: "General",
		ai: "AI",
		persona: "Personas",
		account: "Manage account",
		return: "Back to the conversation",
	},
	appearance: {
		theme: {
			system: "Follow system setting",
			light: "Light",
			dark: "Dark",
		},
		language: "Language",
		languageDescription:
			"The language RowCat is shown in. Saved in this browser; the page reloads to apply it.",
	},
	connect: {
		notPermitted:
			"Members under 14 can't connect a personal API key. You can still converse with RowCat's models.",
		saveFailed: "Couldn't save the connection. Please try again.",
		invalidCredential:
			"The provider rejected this API key. Please check the key.",
		rateLimited:
			"The provider's request limit was reached. Please try again in a moment.",
		quotaExceeded:
			"The provider account's usage limit was exceeded. Please check your provider account.",
		unavailable:
			"The key can't be checked right now. Please try again in a moment.",
	},
	providerDialog: {
		replaceTitle: "Replace {{label}} key",
		connectTitle: "Connect {{label}}",
		description:
			"Conversations are generated with your personal {{label}} API key.",
	},
	picker: {
		surfaceValue: "Saturation {{saturation}}%, brightness {{brightness}}%",
		hueValue: "{{degrees}} degrees",
	},
	section: {
		editColor: "Edit {{name}} color",
		colorHue: "{{name}} color hue",
	},
	providers: {
		disconnectTitle: "Disconnect {{label}}?",
	},
	generationDefaults: {
		connect: "Connect {{provider}}",
		appliedToNewConversationsBy:
			"Applied to new conversations by default. Applies only on this device; a conversation's own settings take priority.",
		couldnTSaveTheSettings: "Couldn't save the settings. Please try again.",
		howDeeplyToThinkBefore: "How deeply to think before replying.",
		theDefaultLengthOfReplies:
			"The default length of replies in conversations.",
		theModelThatGeneratesConversations:
			"The model that generates conversations.",
		generationDefaults: "Generation defaults",
	},
	themeCustomizationSection: {
		youReNotConnectedRight:
			"You're not connected right now. Theme settings reload once you're connected.",
		couldnTLoadThemeSettings: "Couldn't load theme settings.",
		resetting: "Resetting…",
		saving: "Saving…",
		getStarted: "Get started",
	},
	settingsGeneralPage: {
		manageHowTheAppLooks:
			"Manage how the app looks, its theme colors, and the data stored on this device.",
		general: "General",
	},
	localDataSection: {
		clearsTheConversationsDraftsGeneration:
			"Clears the conversations, drafts, generation settings and saved API keys stored in this browser. Your account and other devices' data stay.",
		conversationsDraftsInProgressThis:
			"Conversations, drafts in progress, this device's generation settings and saved AI provider API keys are stored in this browser.",
		couldnTClearTheData:
			"Couldn't clear the data. If RowCat is open in another tab, close it and try again.",
		clearStoredData: "Clear stored data",
		thisDeviceSData: "This device's data",
		clearData: "Clear data",
		dangerZone: "Danger zone",
	},
	settingsAiPage: {
		manageConversationGenerationDefaultsAnd:
			"Manage conversation generation defaults and personal AI providers. These values apply only on this device.",
	},
	providerConnectionDialog: {
		whenYouUseThisProvider:
			"When you use this provider, the context needed to generate the conversation is sent directly from your browser to that provider.",
		apiUsageFeesForThat:
			"API usage fees for that provider may be charged to your provider account.",
		theApiKeyIsStored:
			"The API key is stored only on this device and is never sent to RowCat's server.",
		usingAPersonalApiKey:
			"Using a personal API key on a shared device isn't recommended.",
		hideApiKey: "Hide API key",
		createAnApiKey: "Create an API key",
		showApiKey: "Show API key",
		apiKey: "API key",
		checking: "Checking…",
		hide: "Hide",
		show: "Show",
		replace: "Replace",
		connect: "Connect",
	},
	localDataResetDialog: {
		ifYouUseSyncAcross:
			"If you use sync across devices, the encrypted copy kept on the server remains. Enter the key on this device again and that copy comes back down.",
		conversationsDraftsInProgressThis:
			"Conversations, drafts in progress, this device's generation settings, saved AI provider API keys and the remembered sync key are all cleared.",
		yourAccountStaysPublishedStories:
			"Your account stays. Published stories and comments aren't removed by this.",
		onlyWhatSStoredIn:
			"Only what's stored in this browser is cleared, and it can't be undone.",
		thePageReloadsAfterClearing: "The page reloads after clearing.",
		clearThisDeviceSData: "Clear this device's data?",
		clearData: "Clear data",
		clearing: "Clearing…",
	},
	providerConnections: {
		deletesTheApiKeyStored:
			"Deletes the API key stored on this device. Conversations that chose this provider can't generate until you reconnect, but the chosen model settings stay. The key in your provider account and other devices' connections stay.",
		membersUnder14CanT:
			"Members under 14 can't connect a personal API key. You can keep conversing with RowCat's models, and this opens when you turn 14.",
		connectAPersonalApiKey:
			"Connect a personal API key to choose that provider's models. The connection is used only on this device, and the API key is never sent to RowCat's server.",
		couldnTDisconnectPleaseTry: "Couldn't disconnect. Please try again.",
		aiProviders: "AI providers",
		notConnected: "Not connected",
		disconnect: "Disconnect",
		disconnecting: "Disconnecting…",
		replaceKey: "Replace key",
		connected: "Connected",
		connect: "Connect",
	},
	settingsNavigation: {
		settings: "Settings",
	},
	appearanceSection: {
		followTheSystemSettingOr:
			"Follow the system setting or choose brightness yourself. Applies only in this browser.",
		screenBrightness: "Screen brightness",
		display: "Display",
	},
	runtimeGeneration: {
		title: "Generation settings",
		description:
			"The model and reasoning effort for this story's AI generation.",
		modelDescription: "The model that generates for this story.",
		reasoningDescription: "How deeply to think before answering in this story.",
		saveFailed: "Couldn't save the settings. Please try again.",
		inheritTitle: "Default settings",
		inheritBefore: "Anything not set for this story follows the ",
		inheritLink: "default AI settings",
		inheritAfter:
			". What you choose here applies only to this device and is used from the next generation request.",
		connectProvider: "Connect {{provider}} in AI settings",
	},
};
