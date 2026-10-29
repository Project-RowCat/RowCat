import {
	type AiResponseEvidence,
	AiResponseEvidence as AiResponseEvidenceSchema,
	REPORT_LIMITS,
} from "@rowcat/contracts";
import type { ChatMessage, ChatRole } from "./model.ts";

/**
 * Single place that selects the evidence for an AI-response report. Web and mobile both call it.
 * - Moved here from apps/web/src/features/moderation/ because there are now two consumers.
 * - This is the only path where plaintext leaves the end-to-end encrypted chat. A second copy
 *   could add a field the other lacks and upload content the user never agreed to, with no compile
 *   or test failure.
 * - Pure function, so exactly what is uploaded can be checked without rendering a screen.
 * - Only response, precedingUserMessage and model (while still on the message) are taken from
 *   ChatMessage. Room history, memory, seed, lore, system prompt, safety guards, keys, endpoints
 *   and ids are never included.
 * - The provider class (RowCat-hosted or a direct call with the user's key) is omitted. It cannot
 *   be determined reliably at report time, since the response may come from another device or
 *   setting. Add it once generation records it on the message.
 */

/**
 * The item shown to the user in the preview. The preview and the sent content are the same value.
 *
 * It carries no display label such as `My message` or `AI response`. Labels are locale-bound, and screens word
 * them differently on purpose. Only the role is carried; each app maps roles to text with its own
 * table.
 */
export interface AiEvidencePreviewItem {
	role: ChatRole;
	content: string;
}

export interface AiEvidenceSelection {
	evidence: AiResponseEvidence;
	/**
	 * The list shown to the user before submission. It is derived from the evidence rather than built
	 * separately, because a separate preview could diverge from what is sent. Such a divergence would
	 * show up only as the user submitting content they did not agree to.
	 */
	preview: AiEvidencePreviewItem[];
}

/**
 * Truncates an over-long response, keeping its beginning. Exceeding the contract limit makes the
 * server reject the whole request.
 */
const clamp = (text: string): string =>
	text.length > REPORT_LIMITS.aiEvidenceContent
		? text.slice(0, REPORT_LIMITS.aiEvidenceContent)
		: text;

/**
 * The user message directly before this one, found by array position: scan backward from the anchor
 * and take the first user message. The list already defines display order, so no sort rule is
 * repeated here, since a second rule could diverge from the screen. Consecutive assistant responses
 * still pair with the right question this way.
 */
function findPrecedingUserMessage(
	messages: readonly ChatMessage[],
	anchorIndex: number,
): ChatMessage | null {
	for (let i = anchorIndex - 1; i >= 0; i--) {
		const candidate = messages[i];
		if (candidate?.role === "user") return candidate;
	}
	return null;
}

export interface BuildAiEvidenceOptions {
	/** Whether the user chose to include the preceding message. The checkbox on screen sets this. */
	includePreceding: boolean;
}

/**
 * Maps the reported response to the evidence to upload. Only assistant messages qualify. A user
 * message reported as an 'AI response' would be mislabeled, and it could let users report their own
 * text.
 *
 * Streaming (unsaved) responses are excluded too. Their text can change in the next frame, so the
 * uploaded text could differ from what the user confirmed. Only the stored list is accepted.
 *
 * Returns null if the message is missing or not from the assistant. No empty evidence is
 * fabricated.
 */
export function buildAiResponseEvidence(
	messages: readonly ChatMessage[],
	messageId: string,
	options: BuildAiEvidenceOptions,
): AiEvidenceSelection | null {
	const index = messages.findIndex((message) => message.id === messageId);
	const anchor = index >= 0 ? messages[index] : undefined;
	if (!anchor || anchor.role !== "assistant") return null;

	const content = clamp(anchor.content).trim();
	// An empty response cannot be evidence. The contract requires min(1), so it would be rejected.
	if (!content) return null;

	const preceding = options.includePreceding
		? findPrecedingUserMessage(messages, index)
		: null;
	const precedingContent = preceding ? clamp(preceding.content).trim() : "";

	const evidence: AiResponseEvidence = {
		response: { content, createdAt: anchor.createdAt },
		...(preceding && precedingContent
			? {
					precedingUserMessage: {
						content: precedingContent,
						createdAt: preceding.createdAt,
					},
				}
			: {}),
		...(anchor.model ? { model: anchor.model } : {}),
	};

	/**
	 * Re-validates the assembled evidence against the contract before it is shown. The SDK parses
	 * again before sending, but this check runs earlier because the preview shows exactly this result.
	 * The shape must be one the server accepts before the user sees it. If validation fails, the
	 * report is not opened.
	 */
	const parsed = AiResponseEvidenceSchema.safeParse(evidence);
	if (!parsed.success) return null;

	const preview: AiEvidencePreviewItem[] = [];
	if (parsed.data.precedingUserMessage)
		preview.push({
			role: "user",
			content: parsed.data.precedingUserMessage.content,
		});
	preview.push({ role: "assistant", content: parsed.data.response.content });

	return { evidence: parsed.data, preview };
}
