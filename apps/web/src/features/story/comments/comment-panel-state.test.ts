import { describe, expect, it } from "vitest";
import {
	type CommentQueryView,
	commentPanelView,
} from "./comment-panel-state.ts";

/**
 * What the comment section draws, and in what order. Checked without rendering. Three things cannot
 * be reproduced when the network is healthy:
 * - A paused load must not become a placeholder that never ends offline.
 * - A failure must not stand in for the empty-list message.
 * - Held values win over everything else, so a failed background refresh or 'load more' does not
 *   erase lines already shown.
 *
 * The last one is why this file exists. The component once stacked isPending, then isError, then
 * empty. When the next page failed, a discussion already on screen turned into an error box.
 */

const view = (patch: Partial<CommentQueryView> = {}): CommentQueryView => ({
	isPaused: false,
	isError: false,
	isPending: false,
	hasData: true,
	commentCount: 3,
	...patch,
});

describe("commentPanelView", () => {
	it("draws held rows", () => {
		expect(commentPanelView(view())).toEqual({
			state: "ready",
			retryable: false,
		});
	});

	it("the server answering an empty list is not a failure", () => {
		expect(commentPanelView(view({ commentCount: 0 }))).toEqual({
			state: "empty",
			retryable: false,
		});
	});

	it("a failed first fetch is an error — not an empty list", () => {
		expect(
			commentPanelView(
				view({ isError: true, hasData: false, commentCount: 0 }),
			),
		).toEqual({ state: "error", retryable: true });
	});

	it("paused comes before loading — offline does not become a never-ending placeholder", () => {
		/** A paused query is still `isPending`. That is the reason this order matters. */
		expect(
			commentPanelView(
				view({
					isPaused: true,
					isPending: true,
					hasData: false,
					commentCount: 0,
				}),
			),
		).toEqual({ state: "offline", retryable: true });
	});

	it("paused comes before failure too — the next step differs", () => {
		expect(
			commentPanelView(
				view({
					isPaused: true,
					isError: true,
					hasData: false,
					commentCount: 0,
				}),
			).state,
		).toBe("offline");
	});

	it("a running first fetch is a placeholder", () => {
		expect(
			commentPanelView(
				view({ isPending: true, hasData: false, commentCount: 0 }),
			),
		).toEqual({ state: "loading", retryable: false });
	});

	it("held rows are not erased when a background refresh or next page fails", () => {
		expect(commentPanelView(view({ isError: true }))).toEqual({
			state: "ready",
			retryable: true,
		});
	});

	it("paused with held rows keeps the rows", () => {
		expect(commentPanelView(view({ isPaused: true }))).toEqual({
			state: "ready",
			retryable: true,
		});
	});

	it("a refresh failure after an empty list can be retried too", () => {
		/** A failure does not override the empty state, because the server actually answered 0. */
		expect(commentPanelView(view({ commentCount: 0, isError: true }))).toEqual({
			state: "empty",
			retryable: true,
		});
	});
});
