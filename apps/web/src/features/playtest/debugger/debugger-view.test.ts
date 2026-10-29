import { PLAYTEST_DEBUG_TABS } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	applicableDebugTabs,
	debugTabApplies,
	playtestDebugTabUnavailable,
} from "./debugger-view.ts";

/**
 * The axis only the web has: the lane. The rest (pane vocabulary, turn selection, exact vs.
 * estimated, display) is shared by both apps, so its tests live in @rowcat/chat's
 * debug-view.test.ts. What remains here exists only because the runtime lane exists only on the
 * web.
 */

describe("lanes", () => {
	it("each lane answers different panes", () => {
		expect(applicableDebugTabs("conversation")).toEqual([
			"prompt",
			"lore",
			"generation",
			"timeline",
		]);
		expect(applicableDebugTabs("runtime")).toEqual(["state", "timeline"]);
	});

	it("Timeline answers in both lanes", () => {
		expect(debugTabApplies("timeline", "conversation")).toBe(true);
		expect(debugTabApplies("timeline", "runtime")).toBe(true);
	});

	it("panes that cannot answer say **why**", () => {
		for (const lane of ["conversation", "runtime"] as const)
			for (const tab of PLAYTEST_DEBUG_TABS) {
				if (debugTabApplies(tab, lane)) continue;
				const copy = playtestDebugTabUnavailable(lane, tab);
				expect(copy?.title).toBeTruthy();
				expect(copy?.body).toBeTruthy();
			}
	});

	/**
	 * Does not write 'why it is missing' into a pane that can answer. That sentence would never
	 * appear, so it would drift out of sync with the facts.
	 */
	it("panes that can answer have no such copy", () => {
		for (const lane of ["conversation", "runtime"] as const)
			for (const tab of applicableDebugTabs(lane))
				expect(playtestDebugTabUnavailable(lane, tab)).toBeUndefined();
	});
});
