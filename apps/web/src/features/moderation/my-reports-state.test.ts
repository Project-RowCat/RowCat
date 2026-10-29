import {
	type MyReportDto,
	myReportStateOf,
	ReportStatus,
} from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import { moderation } from "#/lib/i18n/messages/en/moderation.ts";
import {
	type MyReportsQueryView,
	myReportsPanelView,
	myReportTitle,
} from "./my-reports-state.ts";

/**
 * Rules for the `My reports` section, checked without rendering. Three things are guarded, none visible
 * by looking at the screen:
 * - State order: a failure is never drawn as "no reports".
 * - Vocabulary boundary: internal dispositions (resolved, dismissed) do not leak to reporters.
 * - Label source: the screen does not retype labels; they come from the dictionary keyed by the contract's codes.
 */

const view = (patch: Partial<MyReportsQueryView>): MyReportsQueryView => ({
	isPaused: false,
	isError: false,
	isPending: false,
	hasData: false,
	reportCount: 0,
	...patch,
});

describe("myReportStateOf — internal disposition → what the reporter sees", () => {
	it("before review it is `Under review`", () => {
		expect(myReportStateOf("open")).toBe("reviewing");
	});

	/**
	 * Both map to `Reviewed`. This line is the start of the reporter-side privacy boundary.
	 * Splitting dismissed would turn that value into a disposition notice ("no action taken"), and
	 * reporters would infer what happened to the other party.
	 */
	it("resolved and dismissed fold into the same `Reviewed`", () => {
		expect(myReportStateOf("resolved")).toBe("reviewed");
		expect(myReportStateOf("dismissed")).toBe("reviewed");
		expect(myReportStateOf("resolved")).toBe(myReportStateOf("dismissed"));
	});

	/**
	 * Checks every internal status exhaustively, so a newly added value cannot silently fall into
	 * `Under review`.
	 */
	it("every internal status lands on one of the two", () => {
		for (const status of ReportStatus.options)
			expect(["reviewing", "reviewed"]).toContain(myReportStateOf(status));
	});

	/**
	 * No operator vocabulary in labels. The operator queue uses `Processed` and `Dismissed`; if that wording reached this screen, reporters would read a disposition instead of
	 * a status.
	 */
	it("reporter labels carry no disposition vocabulary", () => {
		const labels = Object.values(moderation.myReports.state);
		expect(labels).toEqual(["Under review", "Reviewed"]);
		for (const label of labels)
			for (const forbidden of [
				"Dismissed",
				"Processed",
				"Approved",
				"Rejected",
				"Sanction",
			])
				expect(label).not.toContain(forbidden);
	});
});

describe("myReportsPanelView — what gets drawn", () => {
	/**
	 * The most important assertion in this file. If the order flipped, someone who just filed a report
	 * would see "no reports submitted" after one network error, and read it as the report being lost.
	 */
	it("does not draw failure as empty", () => {
		expect(myReportsPanelView(view({ isError: true })).state).toBe("error");
	});

	/**
	 * Pause is checked before loading. Otherwise an offline user would see a placeholder that never
	 * ends.
	 */
	it("paused is offline, not loading", () => {
		expect(
			myReportsPanelView(view({ isPaused: true, isPending: true })).state,
		).toBe("offline");
	});

	/**
	 * Pause is checked before failure because the user's next step differs: waiting versus pressing
	 * again.
	 */
	it("paused and failed together is paused", () => {
		expect(
			myReportsPanelView(view({ isPaused: true, isError: true })).state,
		).toBe("offline");
	});

	it("loading during the first fetch", () => {
		expect(myReportsPanelView(view({ isPending: true })).state).toBe("loading");
	});

	it("an empty fetched list is the empty state", () => {
		expect(myReportsPanelView(view({ hasData: true })).state).toBe("empty");
	});

	it("rows draw the list", () => {
		expect(
			myReportsPanelView(view({ hasData: true, reportCount: 3 })).state,
		).toBe("ready");
	});

	/**
	 * Held data is never cleared. If a background refresh fails, the list stays and only the retry
	 * path is added.
	 */
	it("a background refresh failure keeps the rows and only opens retry", () => {
		expect(
			myReportsPanelView(
				view({ hasData: true, reportCount: 2, isError: true }),
			),
		).toEqual({ state: "ready", retryable: true });
		expect(
			myReportsPanelView(
				view({ hasData: true, reportCount: 2, isPaused: true }),
			),
		).toEqual({ state: "ready", retryable: true });
	});

	it("a normal list gets no retry", () => {
		expect(
			myReportsPanelView(view({ hasData: true, reportCount: 1 })).retryable,
		).toBe(false);
	});
});

describe("myReportTitle", () => {
	const report = (patch: Partial<MyReportDto> = {}): MyReportDto => ({
		id: "r1",
		targetType: "story",
		reason: "spam",
		state: "reviewing",
		createdAt: "2026-08-20T00:00:00.000Z",
		reviewedAt: null,
		...patch,
	});

	/**
	 * Checks that labels come from the contract as values. The screen does not retype the text.
	 */
	it("maps target and reason through the dictionary", () => {
		expect(
			myReportTitle(report(), {
				target: moderation.target,
				reason: moderation.reason,
			}),
		).toBe("Story · Spam or flooding");
		expect(
			myReportTitle(report({ targetType: "ai_response", reason: "hate" }), {
				target: moderation.target,
				reason: moderation.reason,
			}),
		).toBe("AI response · Hate speech");
	});
});
