/**
 * Custom tools (features/tools): the library in settings, the editor, tool files (export and
 * import), and the room settings pane that turns each tool on or off in one conversation.
 */
export const tools = {
	copy: {
		add: "New tool",
		import: "Import from file",
		exportAll: "Export to file",
		emptyTitle: "No tools yet",
		emptyBody:
			"A tool is something the model can call while it writes: fill in a template, draw from a random table, ask a sub-agent, or call your own web address. Make one once and turn it on in any conversation.",
		guest:
			"Tools are stored on your account and this device. Sign in to see the tools you made.",
		unavailable: "Couldn't check your session. Please try again in a moment.",
		storageError: "Couldn't open this device's data. Tools can't be loaded.",
		readError: "Couldn't load tools. Please try again in a moment.",
		saveFailed: "Couldn't save the tool. Please try again.",
		deleteFailed: "Couldn't delete the tool. Please try again.",
		deleteTitle: "Delete this tool?",
		deleteConfirm: "Delete",
		deleteNotice:
			"Conversations stay as they are; the model just can't call this tool anymore.",
		newTitle: "New tool",
		editTitle: "Edit tool",
		save: "Save",
		deleteThis: "Delete this tool",
		name: "Name",
		nameHint:
			"The name the model calls. Lowercase letters, digits and underscores, starting with a letter.",
		description: "Description",
		descriptionHint:
			"When to use this tool and what it returns. The model decides whether to call it from this alone.",
		parameters: "Parameters",
		parametersHint:
			"What the model fills in when it calls the tool. Leave empty for a tool that takes nothing.",
		addParameter: "Add parameter",
		removeParameter: "Remove parameter",
		parameterName: "Parameter name",
		parameterDescription: "Parameter description",
		parameterType: "Parameter type",
		parameterRequired: "Required",
		parameterChoices: "Allowed values",
		parameterChoicesHint:
			"One per line. Leave empty to allow any text. Only for text parameters.",
		typeString: "Text",
		typeNumber: "Number",
		typeBoolean: "Yes / no",
		kind: "What it does",
		kindTemplate: "Template",
		kindTemplateNote: "Returns text with the parameters filled in",
		kindTable: "Random table",
		kindTableNote: "Draws lines from a list at random",
		kindAgent: "Sub-agent",
		kindAgentNote:
			"Asks a second model with its own instructions, on this conversation's model and connection",
		kindHttp: "Web request",
		kindHttpNote: "Calls an address you run and returns its answer",
		template: "Template",
		entries: "Lines",
		entriesHint: "One line per entry. Each call draws from these.",
		draws: "Lines per call",
		system: "Sub-agent instructions",
		systemHint:
			"The sub-agent's own system prompt. It sees only what the model passes it, not the conversation.",
		maxOutputTokens: "Maximum output tokens",
		url: "URL",
		method: "Method",
		methodPost: "POST (JSON body)",
		methodGet: "GET (query string)",
		headers: "Headers",
		headersHint:
			"For example an Authorization key. Values stay on your devices and are sent only to this URL.",
		addHeader: "Add header",
		removeHeader: "Remove header",
		headerName: "Header name",
		headerValue: "Header value",
		httpNotice:
			"When the model calls this tool, the arguments it writes, drawn from your conversation, are sent to this URL. Only use an address you trust.",
		enabledByDefault: "On in every conversation",
		enabledByDefaultHint:
			"Off: the tool stays available, and you turn it on per conversation in its settings.",
		nameTaken: "Another tool already uses this name.",
		fixIssues: "Fix these before saving:",
		fieldName: "Name",
		fieldDescription: "Description",
		fieldParameters: "Parameters",
		fieldAction: "What it does",
		exportFailed: "Couldn't export the tools. Please try again.",
		exportEmpty: "There are no tools to export yet.",
		importFailed: "Couldn't read that file. Please try again.",
		importTitle: "Import tools",
		importIntro:
			"Imported tools start off. Turn one on in a conversation's settings, or switch on “On in every conversation”.",
		importChoiceImport: "Import",
		importChoiceReplace: "Replace mine",
		importChoiceSkip: "Skip",
		importNothing: "Nothing selected to import.",
		importApplyFailed:
			"Some tools couldn't be imported. Please check your library and try again.",
		statusNew: "New",
		statusNameTaken:
			"You already have a tool with this name. It's skipped unless you replace yours.",
		statusDuplicate:
			"An earlier tool in this file has the same name. Not imported.",
		statusInvalid: "This tool isn't valid and won't be imported.",
		unnamed: "Unnamed tool",
		failureNotToolFile: "This isn't a RowCat tool file.",
		failureNewerVersion:
			"This file was made by a newer version of RowCat. Update the app to import it.",
		failureTooLarge: "This file is too large to be a tool file.",
		failureInvalid: "This tool file is damaged and can't be read.",
	},
	templateHint:
		"Write a parameter's name in double braces, like {{example}}, where its value goes. Unknown names become empty.",
	importAction: "Import {{count}}",
	importApplied: "Tools imported: {{count}}.",
	exportStripped:
		"Header values were left out of the file ({{headers}}). Whoever imports it fills in their own.",
	httpReach: "Sends to {{origin}}",
	headersToFill: "Fill in after importing: {{headers}}",
	invalidAt: "Entry {{position}}",
	edit: "Edit {{name}}",
	delete: "Delete {{name}}",
	deleteDescription: "The {{name}} tool disappears from your library.",
	parameterLabel: "Parameter {{position}}",
	headerLabel: "Header {{position}}",
	room: {
		description:
			"Your tools from settings. Switching one here applies to this conversation only.",
		empty:
			"You haven't made any tools yet. Make them in settings, then turn them on here.",
		openSettings: "Manage tools in settings",
		followsDefault: "Follows the tool's default",
		overridden: "Set for this conversation",
		reset: "Use default",
		saveFailed: "Couldn't change this conversation's tools. Please try again.",
		summaryEmpty: "Add your own tools in settings",
		summaryNoneOn: "No tools on",
		summaryOn: "{{on}} of {{total}} on",
		switchLabel: "{{name}} in this conversation",
		resetLabel: "Use the default for {{name}}",
		creatorTitle: "This story's local tools",
		creatorDescription:
			"These call a program on this device. When the AI uses one, it sends what it wrote from this conversation to that address. They stay off until you turn them on here.",
		creatorAddress: "Calls {{address}}",
		creatorSwitchLabel: "Let {{name}} call {{address}} in this conversation",
	},
};
