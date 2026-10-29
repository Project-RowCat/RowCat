import { describe, expect, it } from "vitest";
import { awaitsAnswer, commitUserTurn } from "./user-turn.ts";

/**
 * The commit boundary of a user turn: the moment the input may be cleared, and the definition of a
 * turn that awaits an answer.
 *
 * Failures here are silent. If saving fails and the input is cleared, the user loses the sentence
 * they typed, with nowhere to recover it. If a failed attempt is treated as an unanswered turn, the
 * screen shows `Regenerate` for a question that was never saved. Neither path raises an error.
 */

/**
 * A minimal session that only supports append. The failure case is injected through the argument.
 */
function fakeSession(options: { fail?: boolean } = {}) {
	const appended: string[] = [];
	return {
		appended,
		session: {
			appendUserMessage: async (content: string) => {
				if (options.fail) throw new Error("the store refused");
				appended.push(content);
			},
		},
	};
}

describe("commitUserTurn", () => {
	it("announces acceptance after the save finished", async () => {
		const { session, appended } = fakeSession();
		/**
		 * Order is recorded as values. If the acceptance signal fired before the save, the signal would
		 * be false.
		 */
		const order: string[] = [];

		const committed = await commitUserTurn({
			session: {
				appendUserMessage: async (content) => {
					order.push("append");
					await session.appendUserMessage(content);
				},
			},
			text: "  a sentence to send  ",
			onAccepted: () => order.push("accepted"),
		});

		expect(committed).toBe(true);
		// Trimming of the input belongs to the commit function, not to the caller.
		expect(appended).toEqual(["a sentence to send"]);
		expect(order).toEqual(["append", "accepted"]);
	});

	/** This one assertion is the entire guarantee that the input is not cleared. */
	it("does not announce acceptance when the save fails", async () => {
		const { session } = fakeSession({ fail: true });
		let accepted = 0;

		await expect(
			commitUserTurn({
				session,
				text: "a sentence that must not be lost",
				onAccepted: () => {
					accepted += 1;
				},
			}),
		).rejects.toThrow();

		expect(accepted).toBe(0);
	});

	/**
	 * Throwing is what establishes that the provider request does not start. The caller's next step
	 * runs after this `await`; if the error were swallowed, the request would go out with an utterance
	 * that was never saved.
	 */
	it("does not swallow a save failure", async () => {
		const { session } = fakeSession({ fail: true });
		await expect(
			commitUserTurn({ session, text: "question" }),
		).rejects.toBeInstanceOf(Error);
	});

	/**
	 * Empty input is the `Regenerate` path: the turn's utterance is already in history, so
	 * nothing is appended and nothing is announced.
	 */
	it("empty input appends nothing and announces nothing", async () => {
		const { session, appended } = fakeSession();
		let accepted = 0;

		const committed = await commitUserTurn({
			session,
			text: "   ",
			onAccepted: () => {
				accepted += 1;
			},
		});

		expect(committed).toBe(false);
		expect(appended).toEqual([]);
		expect(accepted).toBe(0);
	});

	/**
	 * The utterance is already saved. If an exception raised while clearing the input marked the turn
	 * as failed, the user would see an error message beneath their saved utterance.
	 */
	it("the commit succeeds even if the announcement fails", async () => {
		const { session, appended } = fakeSession();

		const committed = await commitUserTurn({
			session,
			text: "question",
			onAccepted: () => {
				throw new Error("the composer blew up");
			},
		});

		expect(committed).toBe(true);
		expect(appended).toEqual(["question"]);
	});

	/**
	 * The acceptance notice fires once. A second notice would clear text the user typed in between.
	 */
	it("calls the announcement once", async () => {
		const { session } = fakeSession();
		let accepted = 0;

		await commitUserTurn({
			session,
			text: "question",
			onAccepted: () => {
				accepted += 1;
			},
		});

		expect(accepted).toBe(1);
	});
});

describe("awaitsAnswer", () => {
	it.each([
		["a saved user turn has no answer", true, false, true],
		["a saved user turn has an answer", true, true, false],
		["the user turn was not saved", false, false, false],
		["no user turn, only an answer", false, true, false],
	])("%s", (_label, userTurnCommitted, assistantSaved, expected) => {
		expect(awaitsAnswer({ userTurnCommitted, assistantSaved })).toBe(expected);
	});

	/**
	 * The third line of the assertion is the reason this function exists. If an attempt whose user
	 * turn failed to save were shown as an unanswered turn, `Regenerate` would appear. That button
	 * generates from the old history, so the sentence the user just typed appears nowhere, and an
	 * extra answer attaches to the old conversation.
	 */
	it("an attempt that failed to save does not become a fake unanswered turn", () => {
		expect(
			awaitsAnswer({ userTurnCommitted: false, assistantSaved: false }),
		).toBe(false);
	});
});
