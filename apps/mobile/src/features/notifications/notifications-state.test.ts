import { describe, expect, it } from "vitest";
import {
	type NotificationQueryView,
	notificationPanelView,
	resolveNotificationsScreenState,
} from "./notifications-state.ts";

/**
 * Order of what gets drawn. A mistake here fails silently: an offline user sees a placeholder that
 * never ends, or a failed query shows "no notifications yet".
 */

const query = (
	overrides: Partial<NotificationQueryView>,
): NotificationQueryView => ({
	isPaused: false,
	isError: false,
	isPending: false,
	hasData: false,
	itemCount: 0,
	...overrides,
});

describe("the member's inbox", () => {
	it("loading while the first lookup runs", () => {
		expect(notificationPanelView(query({ isPending: true }))).toEqual({
			state: "loading",
			retryable: false,
		});
	});

	/** A paused query still reports `isPending`. Mapping it to loading would produce a placeholder that never ends. */
	it("a paused first lookup is offline, not loading", () => {
		expect(
			notificationPanelView(query({ isPending: true, isPaused: true })),
		).toEqual({ state: "offline", retryable: true });
	});

	/** Failure means "unknown", not "zero notifications". */
	it("a failed first lookup is an error, not the empty state", () => {
		expect(notificationPanelView(query({ isError: true }))).toEqual({
			state: "error",
			retryable: true,
		});
	});

	it("empty state only when the server answered 0", () => {
		expect(
			notificationPanelView(query({ hasData: true, itemCount: 0 })),
		).toEqual({ state: "empty", retryable: false });
	});

	it("draws when there are rows", () => {
		expect(
			notificationPanelView(query({ hasData: true, itemCount: 3 })),
		).toEqual({ state: "ready", retryable: false });
	});

	/** Keep held values on screen. A background refresh failure still leaves a retry path. */
	it("a refresh failure over held rows doesn't erase them", () => {
		expect(
			notificationPanelView(
				query({ hasData: true, itemCount: 3, isError: true }),
			),
		).toEqual({ state: "ready", retryable: true });
		expect(
			notificationPanelView(
				query({ hasData: true, itemCount: 3, isPaused: true }),
			),
		).toEqual({ state: "ready", retryable: true });
	});

	/** **An empty inbox is also a held value.** A refresh that fails after a 0 is `empty + retryable`, not an error. */
	it("a refresh failure over a confirmed empty inbox stays empty", () => {
		expect(
			notificationPanelView(
				query({ hasData: true, itemCount: 0, isError: true }),
			),
		).toEqual({ state: "empty", retryable: true });
	});
});

describe("identity branch", () => {
	const idle = query({});

	it("booting is a neutral wait — the guest notice isn't drawn first", () => {
		expect(resolveNotificationsScreenState("booting", idle)).toEqual({
			kind: "booting",
		});
	});

	it("a guest gets the guest notice", () => {
		expect(resolveNotificationsScreenState("guest", idle)).toEqual({
			kind: "guest",
		});
	});

	/** `unavailable` is not a guest. It must not fold into the branch that invites sign-in. */
	it("an unchecked session doesn't fold into guest", () => {
		expect(resolveNotificationsScreenState("unavailable", idle)).toEqual({
			kind: "unavailable",
		});
	});

	it("a member moves on to the inbox decision", () => {
		expect(
			resolveNotificationsScreenState(
				"authenticated",
				query({ hasData: true, itemCount: 2 }),
			),
		).toEqual({
			kind: "panel",
			panel: { state: "ready", retryable: false },
		});
	});
});
