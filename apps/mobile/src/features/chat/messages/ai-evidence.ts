/**
 * Vocabulary for what an AI-response report shows; it belongs to conversation, not to reporting. It
 * did not move with `report-error.ts` (shared by story, comment and profile reports, now in
 * `features/moderation`) because it applies only to the one path that leaves E2EE. Public-target
 * reports have no "what is sent" to show, since the server snapshots its own row. The report dialog
 * does not know these words: it receives one node, built by the conversation folder.
 */

/**
 * The sentence the report dialog must show. It sits beside the button, not buried in the terms,
 * because the user must read that this button sends part of their conversation to the server. Same
 * sentence as web.
 */
export const AI_EVIDENCE_DISCLOSURE =
	"Submitting the report sends the selected conversation content to the RowCat server for review. No other conversation content is sent.";

/** Preview row labels. */
export const EVIDENCE_LABEL = {
	user: "My message",
	assistant: "AI response",
} as const;
