import { APP_NAME } from "@rowcat/domain";
import {
	type ChatCompletionsProfile,
	chatCompletionsAdapter,
} from "./chat-completions.ts";
import { ProviderError, providerErrorForStatus } from "./errors.ts";

/**
 * OpenRouter: the gateway the managed path already speaks to, reached from the browser with the
 * user's own key. The protocol is `chat-completions.ts`; this profile is what the gateway adds to it.
 *
 * - The address is a constant. Users cannot change it — that is the other provider's job.
 * - Explicit cache breakpoints on the Anthropic namespace only (the managed path's
 *   `usesExplicitPromptCaching` is the same rule); other upstreams cache implicitly.
 * - `session_id` and the unified `reasoning.effort` are the gateway's parameters, the same ones the
 *   managed body sends.
 * - 403 is a moderation flag on this gateway, not a bad key (that is 401). Sending the user to fix a
 *   key that works would hide the real cause.
 * - The credential check is `/key`, which requires auth and spends nothing.
 * - `X-Title` names the app; the gateway's CORS allows it (checked 2026-11-03). No referer header —
 *   the browser already sends its own.
 */
const API_BASE = "https://openrouter.ai/api/v1";

export const OPENROUTER_PROFILE: ChatCompletionsProfile = {
	provider: "openrouter-byo",
	baseUrl: () => API_BASE,
	probePath: "/key",
	extraHeaders: { "X-Title": APP_NAME },
	explicitPromptCaching: (model) => model.startsWith("anthropic/"),
	routingSession: true,
	unifiedReasoning: true,
	failureForStatus: (status, retryAfterSeconds) =>
		status === 403
			? new ProviderError("content_blocked")
			: providerErrorForStatus(status, retryAfterSeconds),
};

export const openRouterAdapter = chatCompletionsAdapter(OPENROUTER_PROFILE);
