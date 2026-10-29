import { describe, expect, it } from "vitest";
import { notificationBellLabel } from "./notification.ts";
import {
	notificationAttention,
	UPDATE_UNSEEN_LABEL_SUFFIX,
} from "./notification-attention.ts";

/**
 * Pins the bell's two-axis attention priority as values. The file guards priority, not wording. If
 * each app wrote these rules itself, the same state could render as a count on web and as a dot on
 * mobile.
 */
describe("notificationAttention", () => {
	it("nothing draws nothing", () => {
		expect(notificationAttention({ unread: 0, unseenUpdate: false })).toEqual({
			badge: null,
			dot: false,
			label: "Notifications",
		});
	});

	it("an unknown count states no count", () => {
		const attention = notificationAttention({
			unread: null,
			unseenUpdate: false,
		});
		expect(attention.badge).toBeNull();
		expect(attention.label).toBe("Notifications");
	});

	/**
	 * The attention dot still appears while the count is unknown, because the dot does not depend on
	 * the server.
	 */
	it("the note dot stands even with an unknown count", () => {
		const attention = notificationAttention({
			unread: null,
			unseenUpdate: true,
		});
		expect(attention.badge).toBeNull();
		expect(attention.dot).toBe(true);
		expect(attention.label).toBe(`Notifications${UPDATE_UNSEEN_LABEL_SUFFIX}`);
	});

	it("unread notifications draw the count", () => {
		expect(notificationAttention({ unread: 3, unseenUpdate: false })).toEqual({
			badge: "3",
			dot: false,
			label: "Notifications, 3 unread",
		});
	});

	it("no unread notifications but a new note is a dot", () => {
		expect(notificationAttention({ unread: 0, unseenUpdate: true })).toEqual({
			badge: null,
			dot: true,
			label: `Notifications${UPDATE_UNSEEN_LABEL_SUFFIX}`,
		});
	});

	it("never draws the count and the dot together", () => {
		const attention = notificationAttention({ unread: 3, unseenUpdate: true });
		expect(attention.badge).toBe("3");
		expect(attention.dot).toBe(false);
	});

	it("a hidden note still shows in the name", () => {
		expect(notificationAttention({ unread: 3, unseenUpdate: true }).label).toBe(
			`Notifications, 3 unread${UPDATE_UNSEEN_LABEL_SUFFIX}`,
		);
	});

	it("a note does not increase the unread count", () => {
		for (const unread of [0, 1, 3, 99, 120]) {
			const without = notificationAttention({ unread, unseenUpdate: false });
			const with_ = notificationAttention({ unread, unseenUpdate: true });
			expect(with_.badge).toBe(without.badge);
		}
	});

	it("does not redefine the cap notation", () => {
		expect(
			notificationAttention({ unread: 120, unseenUpdate: true }).badge,
		).toBe("99+");
	});

	it("without a note the bell's name is unchanged", () => {
		for (const unread of [null, 0, 2, 150])
			expect(notificationAttention({ unread, unseenUpdate: false }).label).toBe(
				notificationBellLabel(unread),
			);
	});
});
