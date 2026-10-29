import { AiResponseEvidence, REPORT_LIMITS } from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { buildAiResponseEvidence } from "./ai-evidence.ts";
import type { ChatMessage } from "./model.ts";

/**
 * E2EE boundary test: the most important test in this slice (see §78).
 *
 * Conversations are end-to-end encrypted, and the server cannot read their contents. Reporting an
 * AI response is the one exception, and the user opens it explicitly. So what matters here is not
 * whether reporting works, but what does NOT leave: the whole room history, room memory, the work's
 * seed, lore, the system prompt, other messages, the room id, and the message id.
 *
 * It is checked without rendering. If the assembly lived inside a component, the check would have
 * to mount the screen, and then nobody would actually verify it.
 */

const message = (over: Partial<ChatMessage> & { id: string }): ChatMessage => ({
	roomId: "room-1",
	role: "assistant",
	speaker: "",
	content: "본문",
	createdAt: "2026-08-20T00:00:00.000Z",
	updatedAt: "2026-08-20T00:00:00.000Z",
	dirty: 0,
	/** A fixed revision is enough, since this test does not depend on ordering. */
	rev: { t: 0, c: 0, d: "test-device" },
	serverVersion: 0,
	deletedAt: null,
	...over,
});

/** One room: user, reply, user, reply. The reported target is the second reply. */
const CONVERSATION: ChatMessage[] = [
	message({
		id: "u1",
		role: "user",
		content: "첫 질문",
		createdAt: "2026-08-20T00:00:01.000Z",
	}),
	message({
		id: "a1",
		content: "첫 응답",
		createdAt: "2026-08-20T00:00:02.000Z",
	}),
	message({
		id: "u2",
		role: "user",
		content: "두 번째 질문",
		createdAt: "2026-08-20T00:00:03.000Z",
	}),
	message({
		id: "a2",
		content: "문제가 된 응답",
		createdAt: "2026-08-20T00:00:04.000Z",
		model: "claude-sonnet",
	}),
];

describe("AI response evidence: what goes up", () => {
	it("holds only the chosen response and my message right before it", () => {
		const selection = buildAiResponseEvidence(CONVERSATION, "a2", {
			includePreceding: true,
		});
		expect(selection).not.toBeNull();
		expect(selection?.evidence.response.content).toBe("문제가 된 응답");
		expect(selection?.evidence.precedingUserMessage?.content).toBe(
			"두 번째 질문",
		);
	});

	it("without the preceding message only the response remains", () => {
		const selection = buildAiResponseEvidence(CONVERSATION, "a2", {
			includePreceding: false,
		});
		expect(selection?.evidence.precedingUserMessage).toBeUndefined();
		expect(selection?.preview).toHaveLength(1);
	});

	it("preview and submission are the same value", () => {
		const selection = buildAiResponseEvidence(CONVERSATION, "a2", {
			includePreceding: true,
		});
		// What is shown and what is sent must not diverge, or the user would upload content they never
		// agreed to.
		expect(selection?.preview).toEqual([
			{ role: "user", content: "두 번째 질문" },
			{ role: "assistant", content: "문제가 된 응답" },
		]);
	});
});

describe("AI response evidence: what does **not** go up", () => {
	it("the serialized evidence has no other message at all", () => {
		const selection = buildAiResponseEvidence(CONVERSATION, "a2", {
			includePreceding: true,
		});
		const wire = JSON.stringify(selection?.evidence);
		/**
		 * Scans the whole serialized string. Asserting field by field would miss newly added fields,
		 * which is exactly the regression this test is meant to catch (someone adds a field for
		 * convenience).
		 */
		expect(wire).not.toContain("첫 질문");
		expect(wire).not.toContain("첫 응답");
	});

	it("no room id or message id rides along", () => {
		const selection = buildAiResponseEvidence(CONVERSATION, "a2", {
			includePreceding: true,
		});
		const wire = JSON.stringify(selection?.evidence);
		expect(wire).not.toContain("room-1");
		expect(wire).not.toContain("a2");
		expect(wire).not.toContain("u2");
	});

	it("the contract refuses unknown keys wholesale", () => {
		/**
		 * Final safeguard check: even if the screen mistakenly attaches room memory or the seed, the
		 * server contract rejects the whole request (`.strict()`).
		 */
		const smuggled = {
			response: { content: "본문", createdAt: "2026-08-20T00:00:00.000Z" },
			roomMemory: ["사용자는 고양이를 좋아한다"],
		};
		expect(AiResponseEvidence.safeParse(smuggled).success).toBe(false);
	});

	it("the evidence's key set stays within the three the contract knows", () => {
		const selection = buildAiResponseEvidence(CONVERSATION, "a2", {
			includePreceding: true,
		});
		// Counts the keys. The public profile projection is held to the same shape.
		expect(Object.keys(selection?.evidence ?? {}).sort()).toEqual([
			"model",
			"precedingUserMessage",
			"response",
		]);
	});
});

describe("AI response evidence: target decisions", () => {
	it("user messages are not targets", () => {
		expect(
			buildAiResponseEvidence(CONVERSATION, "u2", { includePreceding: true }),
		).toBeNull();
	});

	it("a message not in the list is null", () => {
		expect(
			buildAiResponseEvidence(CONVERSATION, "없음", {
				includePreceding: true,
			}),
		).toBeNull();
	});

	it("an empty response cannot be evidence", () => {
		const empty = [message({ id: "a0", content: "   " })];
		expect(
			buildAiResponseEvidence(empty, "a0", { includePreceding: false }),
		).toBeNull();
	});

	it("a response over the cap passes the contract truncated", () => {
		const long = [
			message({
				id: "a0",
				content: "가".repeat(REPORT_LIMITS.aiEvidenceContent + 500),
			}),
		];
		const selection = buildAiResponseEvidence(long, "a0", {
			includePreceding: false,
		});
		expect(selection?.evidence.response.content.length).toBe(
			REPORT_LIMITS.aiEvidenceContent,
		);
	});
});
