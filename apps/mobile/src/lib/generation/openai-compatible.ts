import { checkOpenAiCompatibleEndpoint } from "@rowcat/chat";
import type { ChatStreamEvent } from "@rowcat/contracts";
import type { ByoAdapter, ByoTransportInput } from "./byo.ts";
import {
	type ChatCompletionsProfile,
	probeChatCompletions,
	startChatCompletions,
} from "./chat-completions.ts";
import { providerErrorForStatus } from "./errors.ts";

/**
 * A server the user names: any `https` address, or a local server on this device's loopback. The
 * protocol is `chat-completions.ts`; this profile is what we can assume about a server we know nothing
 * else about, which is only the standard (the web's `openai-compatible.ts` is its pair).
 *
 * - The address comes from the stored connection and is checked again here with the same rule the
 *   connect dialog used, so a stored value the rule refuses never receives the key.
 * - No non-standard parameters (cache breakpoints, `session_id`, unified reasoning) and no extra
 *   headers: strict servers answer unknown keys with a 400.
 * - The credential check is `GET /models`, the one listing endpoint the standard has.
 * - Status codes keep their HTTP meaning (403 is a refused key here).
 *
 * "Loopback" is this device's own: on a phone, `localhost` is the phone, not the computer beside it.
 * A server elsewhere on the network needs an `https` address.
 */
const PROFILE: ChatCompletionsProfile = {
	endpointFor: (endpoint) => {
		if (endpoint === undefined) return null;
		const checked = checkOpenAiCompatibleEndpoint(endpoint);
		return checked.ok ? checked.endpoint : null;
	},
	probePath: "/models",
	extraHeaders: {},
	explicitPromptCaching: () => false,
	routingSession: false,
	unifiedReasoning: false,
	failureForStatus: providerErrorForStatus,
};

async function start(
	input: ByoTransportInput,
): Promise<AsyncIterable<ChatStreamEvent>> {
	return startChatCompletions(PROFILE, input);
}

const probe = probeChatCompletions(PROFILE);

export const openAiCompatibleAdapter: ByoAdapter = { start, probe };
