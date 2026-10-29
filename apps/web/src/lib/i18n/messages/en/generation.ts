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
			"Members under 14 can't generate conversations with a personal API key ({{provider}}). Choose an {{app}}-provided model in conversation settings.",
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
		minimal: "Minimal",
		low: "Low",
		medium: "Standard",
		high: "High",
	},
	inherit: "Use default ({{value}})",
	target: {
		label: "Generation target",
		provider: "Provider",
		model: "Model",
		catalogFailed: "Couldn't load the model list.",
		loading: "Loading…",
		byoNotPermitted: " · Not available under 14",
		providerNotConnected: " · Connect the provider first",
		missingFromCatalog: " · Not in the list",
		managedOnly:
			"This work can only be used with {{app}}-provided models. Choose {{app}} as the provider.",
		byoNotPermittedMessage:
			"Members under 14 can't use a personal API key ({{provider}}). Choose {{app}} as the provider.",
		providerNotConnectedMessage:
			"Not available on this device right now · {{provider}} needs to be connected.",
		missingMessage: "This model isn't available in the current list.",
	},
};
