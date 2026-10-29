import { describe, expect, it } from "vitest";
import {
	PUSH_TAP_ROUTE,
	parsePushPayload,
	pushReceiptShouldRefreshInbox,
	pushResponsePlan,
} from "./push-response.ts";

/**
 * Received push to app action.
 *
 * Two things are locked here: there is **one destination** (no second destination table), and a
 * malformed payload **still does something**.
 */

describe("payload", () => {
	it("accepts only the version and the notification id", () => {
		expect(parsePushPayload({ version: 1, notificationId: "n1" })).toEqual({
			notificationId: "n1",
		});
	});

	/** An old version's or another app's banner is not read as ours. */
	it("doesn't accept an unknown version", () => {
		expect(parsePushPayload({ version: 2, notificationId: "n1" })).toBeNull();
	});

	/**
	 * A value the server does not send is **rejected**. That is why the contract is `.strict()`, and
	 * especially the navigation address: if code ever read such a value, a notification could send
	 * people to an arbitrary screen.
	 */
	it("doesn't accept it as a payload when it carries an address", () => {
		expect(
			parsePushPayload({
				version: 1,
				notificationId: "n1",
				href: "/account",
			}),
		).toBeNull();
	});

	it("empty values and other shapes are all null", () => {
		expect(parsePushPayload(null)).toBeNull();
		expect(parsePushPayload("n1")).toBeNull();
		expect(parsePushPayload({ notificationId: "n1" })).toBeNull();
	});
});

describe("press", () => {
	it("always goes to the inbox", () => {
		expect(pushResponsePlan({ version: 1, notificationId: "n1" })).toEqual({
			route: PUSH_TAP_ROUTE,
			notificationId: "n1",
		});
	});

	/**
	 * The worst outcome is **nothing happening** for someone who tapped our banner. The inbox is the
	 * right destination in every case.
	 */
	it("goes to the inbox even with a wrong shape", () => {
		expect(pushResponsePlan({ nope: true })).toEqual({
			route: PUSH_TAP_ROUTE,
			notificationId: null,
		});
	});

	it("there's only one destination", () => {
		expect(PUSH_TAP_ROUTE).toBe("/notifications");
	});
});

describe("foreground receipt", () => {
	/** Does not fabricate a notification row. The only answer is "ask again". */
	it("our banner asks the inbox again", () => {
		expect(
			pushReceiptShouldRefreshInbox({ version: 1, notificationId: "n1" }),
		).toBe(true);
	});

	it("does nothing for an unknown banner", () => {
		expect(pushReceiptShouldRefreshInbox({ nope: true })).toBe(false);
	});
});
