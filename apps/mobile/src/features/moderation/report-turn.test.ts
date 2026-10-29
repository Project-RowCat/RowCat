import type { ReportCreateRequest, ReportTarget } from "@rowcat/contracts";
import { REPORT_ERROR_CODE, REPORT_LIMITS } from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import { describe, expect, it } from "vitest";
import { createReportTurn, type ReportTurnResult } from "./report-turn.ts";

/**
 * Checks the report submission rules by value.
 *
 * This app's tests do not render screens, so ordering, locking and failure handling would be
 * checkable only by trying the app manually if they lived in a hook. They live in a pure module,
 * and these tests run the same function the product calls.
 *
 * Duplicate-submission defense is what pays off here: a screen that runs twice creates two
 * identical reports in the operator queue, and that defect only reproduces on devices where two
 * fingers land in the same frame.
 */

const STORY: ReportTarget = { type: "story", storyId: "story-1" };

function recorder() {
	const sent: ReportCreateRequest[] = [];
	let invalidated = 0;
	return {
		sent,
		invalidations: () => invalidated,
		ports: {
			submit: async (request: ReportCreateRequest) => {
				sent.push(request);
				return { reportId: "r1", createdAt: "2026-08-27T00:00:00.000Z" };
			},
			invalidate: () => {
				invalidated += 1;
			},
		},
	};
}

describe("nothing goes out without a reason", () => {
	/**
	 * A report without a reason cannot be reviewed. A disabled button in the UI is guidance, not a
	 * guard: accessibility tools can activate disabled controls, and the resulting request would be a
	 * 400.
	 */
	it("a null reason isn't sent and isn't a failure", async () => {
		const spy = recorder();
		const turn = createReportTurn(spy.ports);

		const result = await turn.run({
			target: STORY,
			reason: null,
			details: "A description I wrote",
		});

		expect(result).toEqual<ReportTurnResult>({
			kind: "skipped",
			why: "no-reason",
		});
		expect(spy.sent).toHaveLength(0);
		expect(spy.invalidations()).toBe(0);
	});
});

describe("only what the contract can hold goes out", () => {
	/**
	 * Public targets carry only ids. Title, body, nickname and bio have no slot in the contract; the
	 * server takes the snapshot from its own rows. If the reporter could supply evidence, that
	 * evidence would not be evidence. The whole request object is compared, rather than checking for
	 * absent sensitive values, because a key added later would pass such a check and leak.
	 */
	it("a story report goes out with the target as is", async () => {
		const spy = recorder();
		const turn = createReportTurn(spy.ports);

		await turn.run({ target: STORY, reason: "spam", details: "" });

		expect(spy.sent).toEqual([
			{
				target: { type: "story", storyId: "story-1" },
				reason: "spam",
				details: "",
			},
		]);
	});

	/** A comment carries its story id too; the server verifies ownership with that pair. */
	it("a comment report carries both ids", async () => {
		const spy = recorder();
		const turn = createReportTurn(spy.ports);

		await turn.run({
			target: { type: "comment", storyId: "s", commentId: "c" },
			reason: "harassment",
			details: "",
		});

		expect(spy.sent[0]?.target).toEqual({
			type: "comment",
			storyId: "s",
			commentId: "c",
		});
	});

	it("a member report carries only the member id", async () => {
		const spy = recorder();
		const turn = createReportTurn(spy.ports);

		await turn.run({
			target: { type: "member", memberId: "m" },
			reason: "impersonation",
			details: "",
		});

		expect(spy.sent[0]?.target).toEqual({ type: "member", memberId: "m" });
	});

	/**
	 * The explanation is passed through unmodified. Trimming is the contract's job (`.trim()`); if the
	 * screen trimmed too, the length check would run in two places and could disagree.
	 */
	it("passes the description as is", async () => {
		const spy = recorder();
		const turn = createReportTurn(spy.ports);
		const details = "x".repeat(REPORT_LIMITS.details);

		await turn.run({ target: STORY, reason: "other", details });

		expect(spy.sent[0]?.details).toBe(details);
	});
});

describe("folds a second confirmation in the same tick", () => {
	/**
	 * Render-based locks are not locks. `if (pending) return` is true only after the state reaches the
	 * screen. If two fingers land in the same frame, or assistive tech activates twice in the same
	 * tick, both checks see false and two reports are submitted. This test calls without awaiting in
	 * between, which is exactly that situation.
	 */
	it("calling twice without await is still one request", async () => {
		const spy = recorder();
		const turn = createReportTurn(spy.ports);

		const first = turn.run({ target: STORY, reason: "spam", details: "" });
		const second = turn.run({ target: STORY, reason: "spam", details: "" });

		expect(await second).toEqual<ReportTurnResult>({
			kind: "skipped",
			why: "pending",
		});
		expect(await first).toEqual<ReportTurnResult>({ kind: "submitted" });
		expect(spy.sent).toHaveLength(1);
		expect(spy.invalidations()).toBe(1);
	});

	/** The lock is released once the call finishes; a failed report must be retryable. */
	it("it can retry after a failure", async () => {
		let calls = 0;
		const turn = createReportTurn({
			submit: async () => {
				calls += 1;
				if (calls === 1) throw new Error("network");
				return null;
			},
			invalidate: () => {},
		});

		const failed = await turn.run({
			target: STORY,
			reason: "spam",
			details: "",
		});
		expect(failed.kind).toBe("failed");

		const retried = await turn.run({
			target: STORY,
			reason: "spam",
			details: "",
		});
		expect(retried).toEqual<ReportTurnResult>({ kind: "submitted" });
		expect(calls).toBe(2);
	});
});

describe("after filing only `My reports` becomes stale", () => {
	/**
	 * Not awaited. The server confirmed the submission, and cache cleanup should not delay the
	 * confirmation text. The only way to check that by value is to pass an invalidation that never
	 * finishes.
	 */
	it("doesn't wait for invalidation to finish", async () => {
		let started = false;
		const turn = createReportTurn({
			submit: async () => null,
			invalidate: () => {
				started = true;
				/** Never finishes. If the caller awaited it, the assertions below would not run. */
				void new Promise<void>(() => {});
			},
		});

		const result = await turn.run({
			target: STORY,
			reason: "spam",
			details: "",
		});

		expect(result).toEqual<ReportTurnResult>({ kind: "submitted" });
		expect(started).toBe(true);
	});

	/** On failure nothing changed, so there is no invalidation. */
	it("no invalidation on failure", async () => {
		let invalidated = 0;
		const turn = createReportTurn({
			submit: async () => {
				throw new Error("network");
			},
			invalidate: () => {
				invalidated += 1;
			},
		});

		await turn.run({ target: STORY, reason: "spam", details: "" });

		expect(invalidated).toBe(0);
	});
});

describe("the failure arrives as a sentence", () => {
	const failWith = async (error: unknown): Promise<ReportTurnResult> =>
		createReportTurn({
			submit: async () => {
				throw error;
			},
			invalidate: () => {},
		}).run({ target: STORY, reason: "spam", details: "" });

	const apiError = (code: string, status: number) =>
		new RowCatApiError({ status, code, message: "Server raw text" });

	/**
	 * A named reason gets its own sentence. Duplicates in particular do not recommend retrying: what
	 * the person should do is wait, not report again.
	 */
	it("a duplicate report has its own sentence", async () => {
		const result = await failWith(apiError(REPORT_ERROR_CODE.duplicate, 409));
		expect(result).toEqual<ReportTurnResult>({
			kind: "failed",
			message: "You already reported this, and it's still under review.",
		});
	});

	it("rate limit, self and restricted account each have a sentence", async () => {
		expect(
			await failWith(apiError(REPORT_ERROR_CODE.rateLimited, 429)),
		).toMatchObject({ message: expect.stringContaining("too many") });
		expect(
			await failWith(apiError(REPORT_ERROR_CODE.selfTarget, 400)),
		).toMatchObject({ message: "You can't report yourself." });
		expect(await failWith(apiError("account_restricted", 403))).toMatchObject({
			message: expect.stringContaining("restricted account"),
		});
	});

	/**
	 * 404 is not inspected for its cause. Whether the target was deleted, made private, hidden, or
	 * never existed is a distinction the server deliberately collapses; if the screen split them into
	 * different sentences, the response would become an existence oracle. Different codes must yield
	 * the same sentence.
	 */
	it("every 404 is the same single sentence", async () => {
		const message = "This can't be reported.";
		for (const code of ["not_found", "story_not_found", "comment_not_found"])
			expect(
				await failWith(apiError(code, 404)),
				code,
			).toEqual<ReportTurnResult>({ kind: "failed", message });
	});

	/**
	 * Unknown failures collapse to the generic sentence, and the server's raw message is not passed
	 * through. That string is for diagnostics; drawing it would show users text they cannot act on or
	 * leak internals.
	 */
	it("the server's raw text doesn't mix into the screen sentence", async () => {
		const result = await failWith(apiError("who_knows", 500));
		expect(result).toEqual<ReportTurnResult>({
			kind: "failed",
			message: "Couldn't file the report. Please try again in a moment.",
		});
	});

	/** Non-API errors (network, parse) go to the same slot. */
	it("failures that aren't API errors have a sentence too", async () => {
		const result = await failWith(new TypeError("Network request failed"));
		expect(result).toMatchObject({
			kind: "failed",
			message: "Couldn't file the report. Please try again in a moment.",
		});
	});
});
