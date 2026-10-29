import type {
	BuildAiEvidenceOptions,
	AiEvidencePreviewItem as ChatAiEvidencePreviewItem,
	AiEvidenceSelection as ChatAiEvidenceSelection,
	ChatMessage,
} from "@rowcat/chat";
import { buildAiResponseEvidence as selectAiResponseEvidence } from "@rowcat/chat";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Evidence for AI-response reports. Selection is done by @rowcat/chat; this file only attaches
 * display names.
 * - This is the only route by which plaintext leaves the server in an end-to-end encrypted
 *   conversation, and it now has two consumers (the web and mobile chat screens). With two copies,
 *   one would eventually add a field and the other would not. That mistake compiles and passes
 *   tests, yet uploads content the user never agreed to.
 * - Only two locale-bound items remain here: the label in the preview and the disclosure sentence
 *   the report dialog must show.
 */

export type { AiEvidenceSelection, BuildAiEvidenceOptions } from "@rowcat/chat";

/** One item the screen shows the user. The preview and the sent content are the same value. */
export interface AiEvidencePreviewItem {
	/** A label naming what the item is, such as `My message` or `AI response`. */
	label: string;
	content: string;
}

/** Maps role to this screen's wording. The shared rule carries only the role. */
const previewLabel = (role: ChatAiEvidencePreviewItem["role"]): string =>
	role === "user"
		? translator("moderation")("dialog.myMessage")
		: translator("moderation")("dialog.aiResponse");

export interface LabelledAiEvidenceSelection
	extends Omit<ChatAiEvidenceSelection, "preview"> {
	preview: AiEvidencePreviewItem[];
}

/**
 * Turns a response to report into the evidence to upload, plus a preview drawn from that same
 * evidence. Building the preview separately would let what is shown and what is sent diverge. The
 * mismatch would surface only as the user uploading content they did not agree to.
 */
export function buildAiResponseEvidence(
	messages: readonly ChatMessage[],
	messageId: string,
	options: BuildAiEvidenceOptions,
): LabelledAiEvidenceSelection | null {
	const selected = selectAiResponseEvidence(messages, messageId, options);
	if (!selected) return null;
	return {
		evidence: selected.evidence,
		preview: selected.preview.map((item) => ({
			label: previewLabel(item.role),
			content: item.content,
		})),
	};
}

/**
 * The sentence the report dialog must always show (§5). It sits next to the button rather than in
 * a separate document, since the user is pressing that button while part of their conversation is sent to the
 * server.
 */
export const aiEvidenceDisclosure = (): string =>
	translator("moderation")("dialog.disclosure");
