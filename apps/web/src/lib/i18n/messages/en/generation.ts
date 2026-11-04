/**
 * Generation targets, provider failures and generation preference fields (lib/generation, features/generation).
 */
export const generation = {
	providerError: {
		invalid_credential: "Please check your API key.",
		rate_limited:
			"You've hit the provider's request limit. Please try again in a moment.",
		quota_exceeded:
			"You've exceeded your provider account's usage limit. Please check your provider account.",
		model_unavailable:
			"This model isn't available for this account. Please choose another model.",
		network: "Couldn't reach the provider. Please check your network.",
		content_blocked:
			"The provider's content policy blocked this response. Change the scene or choose another model.",
		browser_blocked:
			"The browser couldn't connect to the provider directly. An extension or network policy may be blocking the request.",
		provider_error: "The provider couldn't process the request.",
	},
	blocked: {
		managedOnly:
			"This work protects its prompt, so you can only chat with {{app}}-provided models. Choose an {{app}}-provided model in conversation settings.",
		byoNotPermitted:
			"Members under {{guardianAge}} can't generate conversations with a personal API key ({{provider}}). Choose an {{app}}-provided model in conversation settings.",
		providerNotConnected:
			"The AI provider chosen for this conversation ({{provider}}) isn't connected on this device.",
		modelUnavailable:
			"The chosen model is no longer available. Please choose another model.",
	},
	responseLength: {
		label: "Response length",
		short: "Short",
		standard: "Standard",
		long: "Long",
	},
	reasoning: {
		label: "Reasoning effort",
		description: "Sets how deeply the model thinks before answering.",
		off: "Off",
		minimal: "Minimal",
		low: "Low",
		medium: "Standard",
		high: "High",
	},
	inherit: "Use default ({{value}})",
	utility: {
		followsConversation: "Same as the conversation",
		summaryLabel: "Summary model",
		summaryDescription:
			"Writes the running summary of a long conversation, about every ten turns. Applies only to conversations on your own API key, and the conversation is sent to this model's provider.",
		suggestionLabel: "Reply suggestion model",
		suggestionDescription:
			"Drafts the lines offered when you ask for a reply suggestion. Applies only to conversations on your own API key, and the conversation is sent to this model's provider.",
	},
	target: {
		label: "Generation target",
		provider: "Provider",
		model: "Model",
		catalogFailed: "Couldn't load the model list.",
		loading: "Loading…",
		byoNotPermitted: " · Not available under {{guardianAge}}",
		providerNotConnected: " · Connect the provider first",
		missingFromCatalog: " · Not in the list",
		customModel: "Model ID",
		customModelHint:
			"Any OpenRouter model id (vendor/model). Type one that isn't in the list to use it.",
		customModelInvalid:
			"Enter a model id as OpenRouter writes it, such as qwen/qwen3-max.",
		upstream: "Model provider",
		upstreamPlaceholder: "Automatic (e.g. anthropic, deepinfra/fp8)",
		upstreamHint:
			"Type OpenRouter's provider slug to use only that provider; if it can't answer, the request isn't sent anywhere else. Leave empty to let OpenRouter choose.",
		upstreamInvalid:
			"Enter a provider slug such as anthropic or amazon-bedrock.",
		managedOnly:
			"This work can only be used with {{app}}-provided models. Choose {{app}} as the provider.",
		byoNotPermittedMessage:
			"Members under {{guardianAge}} can't use a personal API key ({{provider}}). Choose {{app}} as the provider.",
		providerNotConnectedMessage:
			"Not available on this device right now · {{provider}} needs to be connected.",
		missingMessage: "This model isn't available in the current list.",
	},
};
