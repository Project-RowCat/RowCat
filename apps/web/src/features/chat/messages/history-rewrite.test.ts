import type { ChatSeed } from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import {
	canPersistGeneration,
	type GenerationOwner,
} from "#/features/conversation/generation-owner.ts";
import { createChatStore } from "#/lib/local-chat/store.ts";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";

/**
 * A late-finishing generation cannot attach its answer to a history that was rewritten under it
 * (P0).
 *
 * This order is common: while a response streams, the user edits a message above or presses `Delete
 * from here`. The provider request has already gone out, and the abort signal is only a signal. A request
 * whose body has fully arrived finishes normally, so its confirming save arrives as a success
 * rather than a failure. Code that only checks "was it aborted?" would let it through.
 *
 * The test runs without React because it verifies behavior, not rendering. The hook does two things
 * (`rewriteHistory` and the confirming block in `use-chat-generation.ts`), and here those two steps
 * are reproduced in the same order on a **real store**:
 *
 * ```text
 * 1. start generation   owner = { viewerId, session, historyEpoch }
 * 2. rewrite            ++epoch → commit the store operation      ← raise the epoch first
 * 3. late commit        write only when canPersistGeneration(owner, key, epoch) holds
 * ```
 */

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

let sequence = 0;
const nextViewer = (): string => `race-${++sequence}`;

afterEach(() => {
	resetLocalDbScope();
});

/** Sets up one conversation and one generation turn running on top of it. */
async function scene() {
	const viewerId = nextViewer();
	const store = createChatStore(activateLocalDbScope(viewerId));
	const room = await store.createRoom({ originStoryId: null, seed: seed() });
	const first = await store.appendMessage({
		roomId: room.id,
		role: "user",
		content: "first question",
	});
	await store.appendMessage({
		roomId: room.id,
		role: "assistant",
		content: "first answer",
	});
	const second = await store.appendMessage({
		roomId: room.id,
		role: "user",
		content: "second question",
	});

	// ① Start generation: the scope and the history epoch are fixed at this point.
	let epoch = 0;
	const owner: GenerationOwner = {
		viewerId,
		session: store,
		historyEpoch: epoch,
	};
	const key = { viewerId, session: store };

	/** ③ A late confirming save. It passes the same condition as the hook's confirming block. */
	const lateCommit = async (content: string): Promise<boolean> => {
		if (!canPersistGeneration(owner, key, epoch)) return false;
		await store.appendMessage({ roomId: room.id, role: "assistant", content });
		return true;
	};

	/** ② Tail rewrite. Raises the epoch first, then commits (same order as the hook's `rewriteHistory`). */
	const rewrite = async (perform: () => Promise<unknown>): Promise<void> => {
		epoch += 1;
		await perform();
	};

	const contents = async () =>
		(await store.listRecentMessages(room.id, { limit: 100 })).map(
			(message) => message.content,
		);

	return { store, room, first, second, lateCommit, rewrite, contents };
}

describe("an in-flight generation and a tail rewrite", () => {
	it("a generation finishing after delete-from-here **cannot write**", async () => {
		const { second, lateCommit, rewrite, contents, store } = await scene();

		await rewrite(() => store.deleteFromMessage(second.id));
		expect(await lateCommit("answer to a deleted question")).toBe(false);

		expect(await contents()).toEqual(["first question", "first answer"]);
	});

	it("a generation finishing after a user message edit cannot write either", async () => {
		const { first, lateCommit, rewrite, contents, store } = await scene();

		await rewrite(() =>
			store.editUserMessage(first.id, "edited first question"),
		);
		expect(await lateCommit("answer to the old question")).toBe(false);

		// Only the edit remains: neither the old answer nor the late answer is there.
		expect(await contents()).toEqual(["edited first question"]);
	});

	/**
	 * **Assistant response edits pass through the same gate.**
	 *
	 * This operation does not start a continuation (`use-actions.tsx`), but the order of cutting the
	 * running generation and raising the epoch must match a user edit exactly. If it differed, a late
	 * response would attach itself after the sentence that was just hand-edited.
	 */
	it("a generation finishing after an assistant reply edit cannot write either", async () => {
		const { lateCommit, rewrite, contents, store, room } = await scene();
		const answer = (
			await store.listRecentMessages(room.id, { limit: 100 })
		).find((message) => message.role === "assistant");

		await rewrite(() =>
			store.editAssistantMessage(answer?.id ?? "", "hand-edited first answer"),
		);
		expect(await lateCommit("late answer")).toBe(false);

		/** The user utterance after the anchor also disappears: the tail rule does not depend on role. */
		expect(await contents()).toEqual([
			"first question",
			"hand-edited first answer",
		]);
	});

	/**
	 * The opposite side must hold too. If the check were so strict that nothing happened yet saving
	 * were blocked, the user would see a response they just read vanish after a refresh.
	 */
	it("without a rewrite a late finish is saved as is", async () => {
		const { lateCommit, contents } = await scene();

		expect(await lateCommit("normal reply")).toBe(true);
		expect(await contents()).toEqual([
			"first question",
			"first answer",
			"second question",
			"normal reply",
		]);
	});

	/**
	 * Even if the rewrite fails, the confirming save stays blocked. What is lost is the partial text
	 * of the response in progress, which the user just said to delete. Letting it through would put an
	 * answer under an edit that failed.
	 */
	it("even if the rewrite throws, the later commit is blocked", async () => {
		const { lateCommit, rewrite, contents } = await scene();

		await expect(
			rewrite(() => Promise.reject(new Error("save failed"))),
		).rejects.toThrow("save failed");
		expect(await lateCommit("late answer")).toBe(false);

		expect(await contents()).toEqual([
			"first question",
			"first answer",
			"second question",
		]);
	});
});
