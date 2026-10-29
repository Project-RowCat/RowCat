import {
	type MyReportDto,
	REPORT_REASON_LABEL,
	REPORT_TARGET_LABEL,
} from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	type MyReportsQueryView,
	myReportsPanelView,
	myReportTitle,
} from "./my-reports-state.ts";

/**
 * Checks the state order of the my-reports section by value.
 *
 * The key assertion is one thing: **failure is not an empty state.** If the person who just filed a
 * report reads `You haven't filed any reports` after one network error, that reads as us having lost the report.
 */

const base: MyReportsQueryView = {
	isPaused: false,
	isError: false,
	isPending: false,
	hasData: false,
	reportCount: 0,
};

describe("with no held value", () => {
	it("loading while the first lookup runs", () => {
		expect(myReportsPanelView({ ...base, isPending: true })).toEqual({
			state: "loading",
			retryable: false,
		});
	});

	/**
	 * **Stall comes before loading.** A stalled query is still `isPending`, so if the order were
	 * reversed, an offline user would see a placeholder that never ends.
	 */
	it("paused is offline, not loading", () => {
		expect(
			myReportsPanelView({ ...base, isPaused: true, isPending: true }),
		).toEqual({ state: "offline", retryable: true });
	});

	it("a failure is error — not empty", () => {
		const view = myReportsPanelView({ ...base, isError: true });
		expect(view).toEqual({ state: "error", retryable: true });
		expect(view.state).not.toBe("empty");
	});
});

describe("with a held value — not erased", () => {
	it("only an empty list the server confirmed is empty", () => {
		expect(myReportsPanelView({ ...base, hasData: true })).toEqual({
			state: "empty",
			retryable: false,
		});
	});

	it("rows mean ready", () => {
		expect(
			myReportsPanelView({ ...base, hasData: true, reportCount: 3 }),
		).toEqual({ state: "ready", retryable: false });
	});

	/** A background failure or stall does not erase rows: only a path to retry is attached. */
	it("a background failure is ready + retryable", () => {
		expect(
			myReportsPanelView({
				...base,
				hasData: true,
				reportCount: 3,
				isError: true,
			}),
		).toEqual({ state: "ready", retryable: true });
	});

	it("a background pause is ready + retryable too", () => {
		expect(
			myReportsPanelView({
				...base,
				hasData: true,
				reportCount: 3,
				isPaused: true,
			}),
		).toEqual({ state: "ready", retryable: true });
	});

	/** A server-confirmed 0 is also a held value: a failure after it is empty + retryable. */
	it("a background failure over an empty list doesn't erase the value either", () => {
		expect(
			myReportsPanelView({ ...base, hasData: true, isError: true }),
		).toEqual({ state: "empty", retryable: true });
	});
});

describe("row titles", () => {
	const report: MyReportDto = {
		id: "r1",
		targetType: "story",
		reason: "spam",
		state: "reviewing",
		createdAt: "2026-08-01T00:00:00.000Z",
		reviewedAt: null,
	};

	/** The source of the labels is the contract. Do not create a Korean table just for mobile. */
	it("builds the `target · reason` form from the contract label tables", () => {
		expect(
			myReportTitle(report, {
				target: REPORT_TARGET_LABEL,
				reason: REPORT_REASON_LABEL,
			}),
		).toBe("Story · Spam or flooding");
	});
});
