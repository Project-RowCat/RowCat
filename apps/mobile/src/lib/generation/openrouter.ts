import type { ChatStreamEvent } from "@rowcat/contracts";
import { APP_NAME } from "@rowcat/domain";
import type { ByoAdapter, ByoTransportInput } from "./byo.ts";
import {
	type ChatCompletionsProfile,
	probeChatCompletions,
	startChatCompletions,
} from "./chat-completions.ts";
import { ProviderError, providerErrorForStatus } from "./errors.ts";

/**
 * OpenRouter: the gateway the managed path already speaks to, reached from the device with the user's
 * own key. The protocol is `chat-completions.ts`; this profile is what the gateway adds to it (the
 * web's `openrouter.ts` is its pair).
 *
 * - The address is a constant.
 * - Explicit cache breakpoints on the Anthropic namespace only (the managed path's same rule).
 * - `session_id` and the unified `reasoning.effort` are the gateway's parameters.
 * - `reasoning.effort: "none"` is thinking off, listed per model by the catalogue.
 * - A model provider the person typed for this model goes out as
 *   `provider: { order: [slug], allow_fallbacks: false }` (`upstreamRouting`); none typed, none sent.
 * - 403 is a moderation flag on this gateway, not a bad key (that is 401).
 * - The credential check is `/key`, which requires auth and spends nothing.
 */
const API_BASE = "https://openrouter.ai/api/v1";

const PROFILE: ChatCompletionsProfile = {
	endpointFor: () => API_BASE,
	probePath: "/key",
	extraHeaders: { "X-Title": APP_NAME },
	explicitPromptCaching: (model) => model.startsWith("anthropic/"),
	routingSession: true,
	unifiedReasoning: true,
	upstreamRouting: true,
	failureForStatus: (status, retryAfterSeconds) =>
		status === 403
			? new ProviderError("content_blocked")
			: providerErrorForStatus(status, retryAfterSeconds),
};

async function start(
	input: ByoTransportInput,
): Promise<AsyncIterable<ChatStreamEvent>> {
	return startChatCompletions(PROFILE, input);
}

const probe = probeChatCompletions(PROFILE);

export const openRouterAdapter: ByoAdapter = { start, probe };
