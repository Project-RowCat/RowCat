/**
 * The user's own chat tools: the settings library, its editor, tool files, and the room settings
 * view that turns them on per conversation (features/tools, features/chat/room-settings/tools.tsx).
 */
export const tools = {
	page: {
		title: "Tools",
		description:
			"Tools the model can call during your conversations. Each tool's description is sent with every reply, so keep only the ones you use on.",
	},
	library: {
		loading: "Loading tools",
		unavailableTitle: "Can't open tools",
		unavailableBody:
			"Tools are saved on this device per account. They'll be there when you sign in again.",
		signIn: "Sign in",
		create: "New tool",
		createFirst: "Create your first tool",
		emptyTitle: "No tools yet",
		emptyBody:
			"A tool is something the model can use mid-reply: fill in a template, draw from a random table, ask a sub-agent, or call your own web address.",
		manage: "Manage tool {{name}}",
		edit: "Edit",
		export: "Export",
		import: "Import",
		onByDefault: "On in all conversations",
		offByDefault: "Off unless turned on in a conversation",
		reaches: "Sends to {{origin}}",
	},
	kind: {
		label: {
			template: "Template",
			table: "Random table",
			agent: "Sub-agent",
			http: "Web request",
		},
		description: {
			template:
				"Returns your text with {{placeholder}} placeholders filled in from the call.",
			table: "Draws rows at random from a list you write.",
			agent:
				"Runs a separate model call with its own instructions and returns its answer. It sees only what the model passes it, not the conversation.",
			http: "Sends the call to a web address you run and returns the response text.",
		},
	},
	parameterType: {
		string: "Text",
		number: "Number",
		boolean: "Yes/No",
	},
	editor: {
		newTitle: "New tool",
		editTitle: "Edit tool",
		description:
			"The model decides whether to call a tool from its name and description alone, so describe when it's useful.",
		name: "Name",
		nameHint:
			"Lowercase letters, digits and underscores, starting with a letter. The model calls the tool by this name.",
		toolDescription: "Description",
		toolDescriptionPlaceholder:
			"e.g. Rolls dice. Use whenever a scene needs a chance outcome.",
		parameters: "Parameters",
		parametersHint:
			"What the model fills in when it calls the tool. A tool can have up to {{max}}.",
		noParameters: "No parameters. The model calls the tool as is.",
		addParameter: "Add parameter",
		removeParameter: "Remove parameter {{name}}",
		parameterName: "Parameter name",
		parameterType: "Type",
		parameterDescription: "Description for the model",
		parameterRequired: "Required",
		parameterChoices: "Allowed values",
		parameterChoicesHint: "One per line. Leave empty to accept any text.",
		kind: "What it does",
		template: "Template",
		templateHint: "{{example}} is replaced with that parameter's value.",
		entries: "Rows",
		entriesHint: "One row per line, up to {{max}}.",
		draws: "Rows per call",
		system: "Sub-agent instructions",
		systemPlaceholder:
			"e.g. You are a strict editor. Point out one weakness in the line you're given.",
		maxOutputTokens: "Max answer length (tokens)",
		agentNote:
			"A sub-agent runs on the same model and connection as the conversation that called it, so it uses that connection's tokens. It can't call tools itself.",
		url: "Address",
		urlPlaceholder: "https://example.com/tool",
		method: "Method",
		methodHint: {
			GET: "Arguments are sent as query parameters.",
			POST: 'Sends JSON: { "tool": name, "arguments": { … } }.',
		},
		headers: "Headers",
		headersHint:
			"Sent with every call, for example an Authorization key. Stored encrypted with your account and never included in exported files.",
		addHeader: "Add header",
		removeHeader: "Remove header {{name}}",
		headerName: "Header name",
		headerValue: "Value",
		httpWarning:
			"The arguments the model writes are drawn from your conversation, and every call sends them to this address. Only use an address you trust.",
		httpCors:
			"Calls go straight from this browser, so the server must allow cross-origin requests (CORS) from this site.",
		enabledByDefault: "On in all conversations",
		enabledByDefaultHint:
			"When off, turn it on per conversation in Conversation settings → Tools.",
		save: "Save",
		create: "Create",
		saving: "Saving…",
		delete: "Delete",
		saveFailed: "Couldn't save the tool. Please try again.",
		fixIssues: "Fix the highlighted fields to save.",
	},
	issue: {
		name: "Use up to 48 lowercase letters, digits and underscores, starting with a letter.",
		nameReserved: "This name is built in. Choose another.",
		nameTaken: "Another tool already uses this name.",
		description: "Write a description of up to {{max}} characters.",
		parameterNamesRepeat: "Parameter names can't repeat.",
		tooManyParameters: "A tool can have up to {{max}} parameters.",
		parameterName:
			"Parameter {{index}}: use lowercase letters, digits and underscores, starting with a letter.",
		parameterDescription:
			"Parameter {{index}}: the description can be up to {{max}} characters.",
		parameterChoices:
			"Parameter {{index}}: up to {{max}} allowed values, none empty.",
		template: "Write a template of up to {{max}} characters.",
		entries: "Write 1 to {{max}} rows, each up to {{chars}} characters.",
		draws: "Draw between 1 and {{max}} rows.",
		system: "Write instructions of up to {{max}} characters.",
		maxOutputTokens: "Enter a whole number between 1 and {{max}}.",
		url: "The address must start with http:// or https://.",
		tooManyHeaders: "Up to {{max}} headers.",
		headerName: "Header {{index}}: use letters, digits and hyphens only.",
		headerValue: "Header {{index}}: the value can be up to {{max}} characters.",
		other: "Check this tool's settings: {{detail}}",
	},
	delete: {
		title: "Delete this tool?",
		body: "<name>{{name}}</name> will be removed from your library and from every conversation. Replies already written stay as they are.",
		deleting: "Deleting…",
		failed: "Couldn't delete the tool. Please try again.",
	},
	exportDialog: {
		title: "Export tools",
		description:
			"Saves the chosen tools as a file you can give to someone else. Which conversations they're on in isn't included.",
		selectAll: "Select all",
		strippedHeaders:
			"Header values aren't included in the file: {{list}}. Whoever imports it fills them in.",
		download: "Download",
		nothingSelected: "Choose at least one tool.",
		failed: "Couldn't create the file. Please try again.",
	},
	importDialog: {
		title: "Import tools",
		description:
			"Imported tools start off in every conversation. Turn them on here or per conversation once you've checked what they do.",
		choose: "Choose file",
		reading: "Reading the file…",
		failure: {
			not_tool_file: "This isn't a RowCat tool file.",
			newer_version:
				"This file was made by a newer version of RowCat. Update the app, then try again.",
			too_large: "This file is too large to be a tool file.",
			invalid: "This tool file is damaged and can't be read.",
		},
		readFailed: "Couldn't read the file. Please try again.",
		status: {
			new: "New",
			name_taken: "You already have a tool with this name",
			duplicate_in_file: "Appears earlier in this file; skipped",
			invalid: "Can't be imported",
		},
		choice: {
			import: "Import",
			replace: "Replace mine",
			skip: "Skip",
		},
		choiceLabel: "What to do with {{name}}",
		unnamed: "Unnamed tool",
		sendsTo: "Sends calls to {{origin}}",
		headersToFill: "Fill in after importing: {{headers}}",
		apply_one: "Import {{count}} tool",
		apply_other: "Import {{count}} tools",
		applyNone: "Nothing to import",
		applying: "Importing…",
		applyFailed:
			"Some tools couldn't be saved. Check your library, then try again.",
	},
	room: {
		summary: {
			none: "No tools yet",
			off: "None on",
			on: "{{count}} on",
		},
		description:
			"Turn your tools on or off for this conversation only. Tools you haven't changed here follow their default.",
		followsDefault: "Follows default",
		changedHere: "Changed here",
		reset: "Reset to default",
		resetLabel: "Reset {{name}} to its default",
		toggleLabel: "Use {{name}} in this conversation",
		empty: "You haven't made any tools yet.",
		manage: "Manage tools",
		limit:
			"A conversation can offer the model up to {{max}} tools at once, including built-in and story tools. Tools past the limit are left out.",
		saveFailed: "Couldn't change this tool. Please try again.",
	},
};
