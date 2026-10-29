import { describe, expect, it } from "vitest";
import {
	draftIdIndex,
	editableDraftIdFor,
	type ServerPanelQueryView,
	serverPanelView,
} from "./server-panel-state.ts";

/**
 * Panel state ordering and the server work to local draft bridge. A wrong order fails silently:
 * offline users see a placeholder that never ends, or someone with ten published works sees `No published
 * stories yet` after one network error.
 */

const q = (over: Partial<ServerPanelQueryView>): ServerPanelQueryView => ({
	isPaused: false,
	isError: false,
	isPending: false,
	hasData: false,
	rowCount: 0,
	...over,
});

describe("cell states", () => {
	// Paused comes before loading: it is still `isPending`, so placing it after would read as loading
	// and never end.
	it("a pause with no held value is offline", () => {
		expect(serverPanelView(q({ isPaused: true, isPending: true }))).toEqual({
			state: "offline",
			retryable: true,
		});
	});

	it("a failure with no held value is an error", () => {
		expect(serverPanelView(q({ isError: true }))).toEqual({
			state: "error",
			retryable: true,
		});
	});

	it("the first lookup is loading", () => {
		expect(serverPanelView(q({ isPending: true }))).toEqual({
			state: "loading",
			retryable: false,
		});
	});

	// Held data wins: a failed background refresh keeps the list and only adds a retry.
	it("held value + failure draws the value and opens retry", () => {
		expect(
			serverPanelView(q({ hasData: true, rowCount: 3, isError: true })),
		).toEqual({ state: "ready", retryable: true });
	});

	it("held value + pause draws the value too", () => {
		expect(
			serverPanelView(q({ hasData: true, rowCount: 3, isPaused: true })),
		).toEqual({ state: "ready", retryable: true });
	});

	// A server that answered zero rows differs from one that could not be asked.
	it("only an answered zero is the empty state", () => {
		expect(serverPanelView(q({ hasData: true, rowCount: 0 })).state).toBe(
			"empty",
		);
	});
});

describe("server stories ↔ local drafts", () => {
	const index = draftIdIndex([{ id: "draft-1" }, { id: "draft-2" }]);

	it("only drafts on this device link to editing", () => {
		expect(editableDraftIdFor({ originDraftId: "draft-1" }, index)).toBe(
			"draft-1",
		);
	});

	// Having `originDraftId` is not the same as that draft existing on this device; mixing them draws
	// a dead link to a deleted draft.
	it("stories published on other devices don't link to editing", () => {
		expect(editableDraftIdFor({ originDraftId: "draft-9" }, index)).toBeNull();
	});

	it("the same for stories that came in without a draft", () => {
		expect(editableDraftIdFor({ originDraftId: null }, index)).toBeNull();
	});
});
