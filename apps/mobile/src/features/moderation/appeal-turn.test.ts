import type { AppealCreateRequest } from "@rowcat/contracts";
import { APPEAL_ERROR_CODE, REPORT_LIMITS } from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import { type AppealTurnResult, createAppealTurn } from "./appeal-turn.ts";

/**
 * Verifies the **rules** of filing an appeal by value. The pair of `report-turn.test.ts`.
 *
 * The duplicate-filing defence is worth checking by value here: a screen that runs twice would file
 * two appeals against the same action, the server rejects the second, and the user reads the
 * failure message for the appeal they just filed. That defect only reproduces on devices where two
 * fingers land in the same frame.
 */

function recorder() {
	const sent: AppealCreateRequest[] = [];
	let invalidated = 0;
	return {
		sent,
		invalidations: () => invalidated,
		ports: {
			submit: async (request: AppealCreateRequest) => {
				sent.push(request);
				return null;
			},
			invalidate: async () => {
				invalidated += 1;
			},
		},
	};
}

describe("nothing goes out without a body", () => {
	/** A disabled button is guidance, not a guard; accessibility tools can activate disabled controls too. */
	it("an empty body isn't sent and isn't a failure", async () => {
		const spy = recorder();
		const turn = createAppealTurn(spy.ports);

		const result = await turn.run({ actionId: "a1", message: "" });

		expect(result).toEqual<AppealTurnResult>({
			kind: "skipped",
			why: "empty-message",
		});
		expect(spy.sent).toHaveLength(0);
		expect(spy.invalidations()).toBe(0);
	});

	it("a whitespace-only body isn't sent either", async () => {
		const spy = recorder();
		const turn = createAppealTurn(spy.ports);

		const result = await turn.run({ actionId: "a1", message: "  \n\t " });

		expect(result).toEqual<AppealTurnResult>({
			kind: "skipped",
			why: "empty-message",
		});
		expect(spy.sent).toHaveLength(0);
	});
});

describe("what goes out is the original as is", () => {
	/**
	 * **Not trimmed.** `trim()` is used only for the check of whether there is anything to send;
	 * trimming is the contract's job. If the screen trimmed in advance, the limit check would diverge
	 * in two places (the same rule as the web).
	 */
	it("passes the body as is without trimming", async () => {
		const spy = recorder();
		const turn = createAppealTurn(spy.ports);
		const message = `  An appeal with leading and trailing spaces ${"x".repeat(REPORT_LIMITS.appealMessage - 40)}  `;

		const result = await turn.run({ actionId: "a1", message });

		expect(result).toEqual<AppealTurnResult>({ kind: "submitted" });
		expect(spy.sent).toEqual([{ actionId: "a1", message }]);
	});
});

describe("folds a second confirmation in the same tick", () => {
	/** A lock that waits for a render is not a lock; call it back to back without `await`. */
	it("calling twice without await is still one request", async () => {
		const spy = recorder();
		const turn = createAppealTurn(spy.ports);

		const first = turn.run({ actionId: "a1", message: "An appeal" });
		const second = turn.run({ actionId: "a1", message: "An appeal" });

		expect(await second).toEqual<AppealTurnResult>({
			kind: "skipped",
			why: "pending",
		});
		expect(await first).toEqual<AppealTurnResult>({ kind: "submitted" });
		expect(spy.sent).toHaveLength(1);
		expect(spy.invalidations()).toBe(1);
	});

	it("it can retry after a failure — the screen keeps the form's value", async () => {
		let calls = 0;
		const turn = createAppealTurn({
			submit: async () => {
				calls += 1;
				if (calls === 1) throw new Error("network");
				return null;
			},
			invalidate: async () => {},
		});

		const failed = await turn.run({ actionId: "a1", message: "An appeal" });
		expect(failed.kind).toBe("failed");

		const retried = await turn.run({ actionId: "a1", message: "An appeal" });
		expect(retried).toEqual<AppealTurnResult>({ kind: "submitted" });
		expect(calls).toBe(2);
	});
});

describe("after filing — one sanction state, no optimism", () => {
	/**
	 * **Waits for invalidation.** The result of filing is one refreshed restriction row (there is no
	 * success banner); if `submitted` returned before that row became true, a closed dialog would look
	 * as if nothing happened. This is where it differs from the report turn; the reason is in the
	 * header of `appeal-turn.ts`.
	 */
	it("submitted returns after invalidation finishes", async () => {
		const order: string[] = [];
		const turn = createAppealTurn({
			submit: async () => {
				order.push("submit");
			},
			invalidate: async () => {
				await Promise.resolve();
				order.push("invalidate");
			},
		});

		const result = await turn.run({ actionId: "a1", message: "An appeal" });

		expect(result).toEqual<AppealTurnResult>({ kind: "submitted" });
		expect(order).toEqual(["submit", "invalidate"]);
	});

	/**
	 * **A refresh failure is not a filing failure.** The server already received the appeal; folding
	 * it into a failure would make the user resubmit and receive `appeal_duplicate`.
	 */
	it("filing succeeds even if invalidation fails", async () => {
		const turn = createAppealTurn({
			submit: async () => null,
			invalidate: async () => {
				throw new Error("cache");
			},
		});

		expect(
			await turn.run({ actionId: "a1", message: "An appeal" }),
		).toEqual<AppealTurnResult>({ kind: "submitted" });
	});

	it("no invalidation on failure — nothing changed", async () => {
		let invalidated = 0;
		const turn = createAppealTurn({
			submit: async () => {
				throw new Error("network");
			},
			invalidate: async () => {
				invalidated += 1;
			},
		});

		await turn.run({ actionId: "a1", message: "An appeal" });

		expect(invalidated).toBe(0);
	});
});

describe("the failure arrives as a sentence — the body doesn't ride along", () => {
	const failWith = async (error: unknown): Promise<AppealTurnResult> =>
		createAppealTurn({
			submit: async () => {
				throw error;
			},
			invalidate: async () => {},
		}).run({ actionId: "a1", message: "The appeal body the user wrote" });

	const apiError = (code: string, status: number) =>
		new RowCatApiError({ status, code, message: "Server raw text" });

	/** Named reasons have their own sentence; a duplicate in particular does not suggest retrying. */
	it("duplicate, not allowed and already lifted each have a sentence", async () => {
		expect(
			await failWith(apiError(APPEAL_ERROR_CODE.duplicate, 409)),
		).toEqual<AppealTurnResult>({
			kind: "failed",
			message: "An appeal for this action is already under review.",
		});
		expect(
			await failWith(apiError(APPEAL_ERROR_CODE.notAppealable, 400)),
		).toMatchObject({ message: "This action can't be appealed." });
		expect(
			await failWith(apiError(APPEAL_ERROR_CODE.alreadyReversed, 409)),
		).toMatchObject({ message: "This action was already lifted." });
	});

	it("sign-in, format and rate limit each have a sentence", async () => {
		expect(await failWith(apiError("login_required", 401))).toMatchObject({
			message: "You need to sign in.",
		});
		expect(await failWith(apiError("invalid_input", 400))).toMatchObject({
			message: "Please check your appeal.",
		});
		expect(await failWith(apiError("who_knows", 429))).toMatchObject({
			message: expect.stringContaining("Too many requests"),
		});
	});

	/** A nonexistent action and someone else's are the same 404; the screen does not distinguish them either. */
	it("404 is one sentence", async () => {
		expect(await failWith(apiError("not_found", 404))).toMatchObject({
			message: "Couldn't find the action to appeal.",
		});
	});

	/**
	 * **Neither the server's original message nor the body the user wrote is carried into the
	 * result.** The failure result is a value that sits in screen state; if the body were carried, the
	 * next reader would draw it or log it.
	 */
	it("an unknown failure folds into a generic sentence and the raw text doesn't leak", async () => {
		const result = await failWith(apiError("who_knows", 500));
		expect(result).toEqual<AppealTurnResult>({
			kind: "failed",
			message: "Couldn't file the appeal. Please try again in a moment.",
		});
		expect(JSON.stringify(result)).not.toContain("Server raw text");
		expect(JSON.stringify(result)).not.toContain(
			"The appeal body the user wrote",
		);
	});

	it("failures that aren't API errors have a sentence too", async () => {
		expect(
			await failWith(new TypeError("Network request failed")),
		).toMatchObject({
			kind: "failed",
			message: expect.stringContaining("Check your connection"),
		});
	});
});
