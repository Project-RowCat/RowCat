import { checkOpenAiCompatibleEndpoint } from "@rowcat/chat";
import {
	type ChatCompletionsProfile,
	chatCompletionsAdapter,
} from "./chat-completions.ts";
import { providerErrorForStatus } from "./errors.ts";

/**
 * A server the user names: any `https` address, or a local server on this device's loopback (Ollama,
 * LM Studio, vLLM, llama.cpp, a company proxy). The protocol is `chat-completions.ts`; this profile is
 * what we can assume about a server we know nothing else about, which is only the standard.
 *
 * - The address comes from the stored connection (`ByoTransportInput.endpoint`) and is checked again
 *   here with the same rule the connect dialog used. A row edited outside the dialog cannot send the
 *   key to an address the rule refuses; it is a connection to fix.
 * - No non-standard parameters: no cache breakpoints, no `session_id`, no unified `reasoning`. Strict
 *   servers answer unknown keys with a 400, and these rows list no reasoning levels anyway.
 * - No extra headers. A header the server's CORS does not list fails the preflight, and the browser
 *   reports that as a network failure the user cannot diagnose.
 * - The credential check is `GET /models`, the one listing endpoint the standard has. A local server
 *   that ignores keys answers it too; that is fine — the key is theirs to require.
 * - Status codes keep their HTTP meaning (403 is a refused key here, as on OpenAI).
 *
 * Tools are sent when the room has lore, like every provider. A model or server without tool support
 * answers that with an error the screen shows as a provider failure; there is no capability to look
 * up first, because nothing about the server is known.
 */
export const OPENAI_COMPATIBLE_PROFILE: ChatCompletionsProfile = {
	provider: "openai-compatible-byo",
	baseUrl: (endpoint) => {
		if (endpoint === undefined) return null;
		const checked = checkOpenAiCompatibleEndpoint(endpoint);
		return checked.ok ? checked.endpoint : null;
	},
	probePath: "/models",
	extraHeaders: {},
	explicitPromptCaching: () => false,
	routingSession: false,
	unifiedReasoning: false,
	upstreamRouting: false,
	failureForStatus: providerErrorForStatus,
};

export const openAiCompatibleAdapter = chatCompletionsAdapter(
	OPENAI_COMPATIBLE_PROFILE,
);
