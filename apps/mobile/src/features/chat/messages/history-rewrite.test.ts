import {
	type ChatStore,
	canPersistGeneration,
	type GenerationOwner,
} from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalScopeController } from "../../../lib/local-data/activation.ts";
import { seed } from "../../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../../test/sqlite-node.ts";

/**
 * A generation that finishes late must not attach its answer on top of rewritten history (P0).
 *
 * This ordering is common: the user edits an upper message or presses `Delete from here` while a response is
 * arriving. The provider request is already out, and an abort signal is only a signal: a request
 * that already received its whole body ends normally, so its confirming save arrives as a success,
 * and code that only checks "was it aborted" lets it through.
 *
 * It runs without React because the subject is not rendering. The hook's work reduces to two lines
 * (`rewriteHistory` and the confirm block in `use-chat-generation.ts`), reproduced here on real
 * SQLite in the same order:
 *
 * ```text
 * 1. start generation   owner = { viewerId, session, historyEpoch }
 * 2. rewrite            ++epoch, then commit the store operation   (epoch first)
 * 3. late confirm       write only if canPersistGeneration(owner, key, epoch) is true
 * ```
 *
 * Web's `features/chat/messages/history-rewrite.test.ts` runs the same table on IndexedDB. Keeping
 * both is intended: the predicate is one function (`@rowcat/chat`) but the order it is called in is
 * each app's wiring and can slip in one only.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;

const storage = createMemorySecureStorage();

beforeEach(() => {
	temp = createTempDirectory();
	controller = createTestScopeController(temp.path, storage);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

/** Sets up a room and one generation turn running over it. */
async function scene(viewerId = "alice") {
	const scope = await controller.activate(viewerId);
	const store: ChatStore = scope.stores.chat;
	const room = await store.createRoom({
		originStoryId: null,
		seed: seed("Test story"),
	});
	const first = await store.appendMessage({
		roomId: room.id,
		role: "user",
		content: "First question",
	});
	await store.appendMessage({
		roomId: room.id,
		role: "assistant",
		content: "First answer",
	});
	const second = await store.appendMessage({
		roomId: room.id,
		role: "user",
		content: "Second question",
	});

	// 1. Generation starts; the scope and history epoch freeze here.
	let epoch = 0;
	const owner: GenerationOwner = {
		viewerId,
		session: store,
		historyEpoch: epoch,
	};
	/** The latest identity of the open conversation; an account switch moves this first. */
	let key = {
		viewerId: viewerId as string | null,
		session: store as object | null,
	};

	/** 3. The late confirming save, passing the same condition as the hook's confirm block. */
	const lateCommit = async (content: string): Promise<boolean> => {
		if (!canPersistGeneration(owner, key, epoch)) return false;
		await store.appendMessage({ roomId: room.id, role: "assistant", content });
		return true;
	};

	/** 2. Tail rewrite: raise the epoch, then commit (same order as the hook's `rewriteHistory`). */
	const rewrite = async (perform: () => Promise<unknown>): Promise<void> => {
		epoch += 1;
		await perform();
	};

	/** The account changed, like the screen effect swapping the key. */
	const switchAccount = (next: {
		viewerId: string | null;
		session: object | null;
	}) => {
		key = next;
	};

	const contents = async () =>
		(await store.listRecentMessages(room.id, { limit: 100 })).map(
			(message) => message.content,
		);

	return {
		store,
		room,
		first,
		second,
		lateCommit,
		rewrite,
		switchAccount,
		contents,
	};
}

describe("an in-progress generation and a tail rewrite", () => {
	it("a generation finishing after delete-from-here **can't write**", async () => {
		const { second, lateCommit, rewrite, contents, store } = await scene();

		await rewrite(() => store.deleteFromMessage(second.id));
		expect(await lateCommit("An answer to the deleted question")).toBe(false);

		expect(await contents()).toEqual(["First question", "First answer"]);
	});

	it("a generation finishing after a user message edit can't write either", async () => {
		const { first, lateCommit, rewrite, contents, store } = await scene();

		await rewrite(() =>
			store.editUserMessage(first.id, "The edited first question"),
		);
		expect(await lateCommit("An answer to the old question")).toBe(false);

		// Only the edit remains: no old answer and no late one.
		expect(await contents()).toEqual(["The edited first question"]);
	});

	// The other side must hold too: if the check is so strict it blocks a save when nothing happened,
	// the user sees a response they just read vanish after restarting the app.
	it("without a rewrite, a late finish is saved as is", async () => {
		const { lateCommit, contents } = await scene();

		expect(await lateCommit("A normal reply")).toBe(true);
		expect(await contents()).toEqual([
			"First question",
			"First answer",
			"Second question",
			"A normal reply",
		]);
	});

	// Stay blocked even if the rewrite failed. All that is lost is the in-flight response's partial
	// text, in a spot the user just said to delete; letting it through would put an answer under a
	// failed edit.
	it("even when the rewrite throws, the confirmed save after it is blocked", async () => {
		const { lateCommit, rewrite, contents } = await scene();

		await expect(
			rewrite(() => Promise.reject(new Error("Save failed"))),
		).rejects.toThrow("Save failed");
		expect(await lateCommit("A late answer")).toBe(false);

		expect(await contents()).toEqual([
			"First question",
			"First answer",
			"Second question",
		]);
	});
});

describe("a generation that finished after the account switched", () => {
	it("signing out blocks the confirmed save", async () => {
		const { lateCommit, switchAccount, contents } = await scene();

		switchAccount({ viewerId: null, session: null });
		expect(await lateCommit("An answer that nearly went to a guest")).toBe(
			false,
		);

		expect(await contents()).toEqual([
			"First question",
			"First answer",
			"Second question",
		]);
	});

	// Blocked even when the same member returns: the id matches but the database connection closed and
	// reopened, and a write aimed at the old instance goes to a closed connection. A check on member
	// id alone lets this path through.
	it("blocked even for `Alice → sign out → Alice`", async () => {
		const { room, lateCommit, switchAccount } = await scene("alice");

		await controller.release();
		const reopened = await controller.activate("alice");
		switchAccount({ viewerId: "alice", session: reopened.stores.chat });

		expect(
			await lateCommit("An answer that nearly went to the old instance"),
		).toBe(false);

		// Verify through the reopened store. The old instance is closed, and reading through it would
		// show `database is not open` instead of the fact under test, which is itself the reason this
		// rule exists.
		const messages = await reopened.stores.chat.listRecentMessages(room.id, {
			limit: 100,
		});
		expect(messages.map((message) => message.content)).toEqual([
			"First question",
			"First answer",
			"Second question",
		]);
	});
});
