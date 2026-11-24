import type { ChatGenerationRequest } from "@rowcat/contracts/chat";
import type { GenerationTransport } from "./transport.ts";

/**
 * Runs one sub-agent (`agent` custom tool) to completion and returns its text: the body of
 * `ChatCustomToolPorts.runAgent` on the web.
 *
 * The caller builds the transport (the turn's own target and credentials, with no tool access) and
 * the request (`chatAgentRequest`). This file only drains the stream, so it never sees which
 * provider runs or how the key is opened, and the credential boundary stays in the generation hook.
 *
 * Text is collected whole rather than streamed to the screen. The agent's answer is a tool result:
 * the model reads it, the person does not, and a partial result is worth nothing to the model.
 *
 * An `error` frame is thrown. The tool loop never reads the thrown value (it substitutes one fixed
 * sentence), so the provider's message cannot become model input; throwing is only how the loop
 * learns the call failed. A response cut at the agent's output cap is returned as is: a shortened
 * answer is still an answer, and the cap is the tool author's choice.
 *
 * The agent's usage is not reported into the turn. The parent's usage frame describes the parent's
 * own request; adding a second model's tokens there would make the conversation's recorded cost
 * disagree with the request it is attached to.
 */
export async function runToolAgent(
	transport: GenerationTransport,
	request: ChatGenerationRequest,
	signal: AbortSignal,
): Promise<string> {
	let text = "";
	for await (const event of transport.stream(request, { signal })) {
		if (event.type === "delta") text += event.text;
		else if (event.type === "error")
			throw new Error(`sub-agent stream failed: ${event.code}`);
	}
	return text;
}
