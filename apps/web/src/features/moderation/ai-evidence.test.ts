import type { ChatMessage } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	aiEvidenceDisclosure,
	buildAiResponseEvidence,
} from "./ai-evidence.ts";

/**
 * Checks only what this app adds: the label and the disclosure sentence. Which content is uploaded
 * and which is not is covered by @rowcat/chat's ai-evidence.test.ts, since web and mobile must
 * share one table. The two checks here depend on the locale, so each app keeps its own.
 */

const message = (over: Partial<ChatMessage> & { id: string }): ChatMessage =>
	({
		roomId: "room-1",
		role: "assistant",
		speaker: "",
		content: "body",
		createdAt: "2026-08-20T00:00:00.000Z",
		...over,
	}) as ChatMessage;

const CONVERSATION: ChatMessage[] = [
	message({
		id: "u1",
		role: "user",
		content: "question",
		createdAt: "2026-08-20T00:00:01.000Z",
	}),
	message({
		id: "a1",
		content: "response",
		createdAt: "2026-08-20T00:00:02.000Z",
	}),
];

describe("preview labels", () => {
	/**
	 * Pins the role-to-label table as this app's own values. Ordering comes from the shared rule: the
	 * user's preceding message first, then the reported response.
	 */
	it("maps roles to this screen's words", () => {
		const selection = buildAiResponseEvidence(CONVERSATION, "a1", {
			includePreceding: true,
		});
		expect(selection?.preview).toEqual([
			{ label: "My message", content: "question" },
			{ label: "AI response", content: "response" },
		]);
	});

	/**
	 * If what is previewed and what is sent diverge, the user uploads content they did not agree to.
	 */
	it("the preview content is the evidence content as is", () => {
		const selection = buildAiResponseEvidence(CONVERSATION, "a1", {
			includePreceding: true,
		});
		expect(selection?.preview.map((item) => item.content)).toEqual([
			selection?.evidence.precedingUserMessage?.content,
			selection?.evidence.response.content,
		]);
	});
});

describe("disclosure", () => {
	it("says both what is sent and what is not", () => {
		// Pins the wording. If only half of the disclosure survived, the disclosure would be incomplete
		// (§5).
		expect(aiEvidenceDisclosure()).toContain("sends the selected");
		expect(aiEvidenceDisclosure()).toContain(
			"No other conversation content is sent",
		);
	});
});
