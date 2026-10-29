import { describe, expect, it } from "vitest";
import {
	DEFAULT_NOTIFICATIONS_TAB,
	notificationsSearchForTab,
	notificationsTabFromSearch,
	validateNotificationsSearch,
} from "./notifications-search.ts";

/**
 * Pins the address serialization rule for the notifications tab as a value.
 *
 * The axis exists for one reason: the bell popover's `See all updates` link must arrive on that tab. If
 * that link hand-writes `?tab=`, one of the rules below will break.
 */
describe("validateNotificationsSearch", () => {
	it("an empty address is the default tab", () => {
		expect(validateNotificationsSearch({})).toEqual({});
		expect(notificationsTabFromSearch({})).toBe(DEFAULT_NOTIFICATIONS_TAB);
	});

	it("a known tab stays", () => {
		expect(validateNotificationsSearch({ tab: "updates" })).toEqual({
			tab: "updates",
		});
	});

	it("the default tab is not written to the address", () => {
		expect(validateNotificationsSearch({ tab: "general" })).toEqual({});
		expect(notificationsSearchForTab("general")).toEqual({});
		expect(notificationsSearchForTab("updates")).toEqual({ tab: "updates" });
	});

	/**
	 * Unknown values must not break the screen. If one edited character turned the inbox into an error
	 * page, the user would conclude their notifications had vanished, even though the server still has
	 * them.
	 */
	it("an unknown value folds to the default tab", () => {
		for (const tab of ["mentions", "", "UPDATES", 3, null, undefined, {}])
			expect(
				notificationsTabFromSearch(validateNotificationsSearch({ tab })),
				String(tab),
			).toBe(DEFAULT_NOTIFICATIONS_TAB);
	});

	/**
	 * Values that have not been validated do reach this function. The checks above go through
	 * `validateNotificationsSearch` first, so they do not test totality here. This test skips
	 * validation on purpose and calls this function directly. See `notificationsTabFromSearch` for why
	 * the raw value can arrive.
	 */
	it("a value that skipped validation also folds to the default tab", () => {
		for (const tab of ["garbage", "", "UPDATES", "generals"])
			expect(notificationsTabFromSearch({ tab } as never), String(tab)).toBe(
				DEFAULT_NOTIFICATIONS_TAB,
			);
	});

	/** Unknown keys are dropped entirely, so arbitrary values do not persist in the address. */
	it("does not carry unknown axes", () => {
		expect(validateNotificationsSearch({ tab: "updates", q: "x" })).toEqual({
			tab: "updates",
		});
	});

	it("tab → address → tab round-trips", () => {
		for (const tab of ["general", "updates"] as const)
			expect(
				notificationsTabFromSearch(
					validateNotificationsSearch({ ...notificationsSearchForTab(tab) }),
				),
			).toBe(tab);
	});
});
