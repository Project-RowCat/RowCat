import { describe, expect, it } from "vitest";
import {
	type NotificationQueryView,
	notificationPanelView,
} from "./notifications-state.ts";

/**
 * Checked without rendering. The order of the surface's branches is what matters here. Three of its
 * failures do not show up in a normal development environment, where the network always works. See
 * `notificationPanelView` for the reasons.
 */

const view = (
	patch: Partial<NotificationQueryView> = {},
): NotificationQueryView => ({
	isPaused: false,
	isError: false,
	isPending: false,
	hasData: true,
	itemCount: 3,
	...patch,
});

describe("notificationPanelView", () => {
	it("draws held rows", () => {
		expect(notificationPanelView(view())).toEqual({
			state: "ready",
			retryable: false,
		});
	});

	it("the server answering an empty list is not a failure", () => {
		expect(notificationPanelView(view({ itemCount: 0 }))).toEqual({
			state: "empty",
			retryable: false,
		});
	});

	it("a failed first fetch is an error — not an empty inbox", () => {
		expect(
			notificationPanelView(
				view({ isError: true, isPending: false, hasData: false, itemCount: 0 }),
			),
		).toEqual({ state: "error", retryable: true });
	});

	it("paused comes before loading — offline does not become a never-ending placeholder", () => {
		/**
		 * A paused query is still `isPending`, which is why the pause check must come before the loading
		 * check.
		 */
		expect(
			notificationPanelView(
				view({ isPaused: true, isPending: true, hasData: false, itemCount: 0 }),
			),
		).toEqual({ state: "offline", retryable: true });
	});

	it("paused comes before failure too — the next step differs", () => {
		expect(
			notificationPanelView(
				view({
					isPaused: true,
					isError: true,
					hasData: false,
					itemCount: 0,
				}),
			).state,
		).toBe("offline");
	});

	it("a running first fetch is a placeholder", () => {
		expect(
			notificationPanelView(
				view({ isPending: true, hasData: false, itemCount: 0 }),
			),
		).toEqual({ state: "loading", retryable: false });
	});

	it("held rows are not erased when a background refresh fails", () => {
		expect(notificationPanelView(view({ isError: true }))).toEqual({
			state: "ready",
			retryable: true,
		});
	});

	it("paused with held rows keeps the rows", () => {
		expect(notificationPanelView(view({ isPaused: true }))).toEqual({
			state: "ready",
			retryable: true,
		});
	});

	it("a refresh failure after an empty list can be retried too", () => {
		/** A failure does not override the empty state here, because the server actually answered 0. */
		expect(
			notificationPanelView(view({ itemCount: 0, isError: true })),
		).toEqual({ state: "empty", retryable: true });
	});
});
