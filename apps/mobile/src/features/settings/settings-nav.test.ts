import { describe, expect, it } from "vitest";
import { mobileShellRouteFor } from "../shell/shell-route.ts";
import {
	MOBILE_SETTINGS_ACCOUNT_LINK,
	MOBILE_SETTINGS_NAV,
	SETTINGS_CATEGORY_DESCRIPTION,
	settingsLoginRedirect,
} from "./settings-nav.ts";

/**
 * The settings navigation model: there are three categories, and the account is not one of them.
 */

describe("categories", () => {
	it("three, in the same order as the web", () => {
		expect(MOBILE_SETTINGS_NAV.map((item) => item.category)).toEqual([
			"general",
			"ai",
			"persona",
		]);
		expect(MOBILE_SETTINGS_NAV.map((item) => item.label)).toEqual([
			"General",
			"AI",
			"Persona",
		]);
	});

	/**
	 * `/settings/general` does not exist. Two addresses for one screen leave no way to say which is
	 * canonical, and saved `/settings` links would then need a redirect.
	 */
	it("general is /settings itself", () => {
		expect(MOBILE_SETTINGS_NAV[0]?.route).toBe("/settings");
		for (const item of MOBILE_SETTINGS_NAV)
			expect(item.route).not.toBe("/settings/general");
	});

	it("addresses don't collide", () => {
		const routes = MOBILE_SETTINGS_NAV.map((item) => item.route);
		expect(new Set(routes).size).toBe(routes.length);
	});

	/**
	 * No placeholder categories: a vocabulary entry makes the screen draw it, even as a disabled row,
	 * and users read that as a coming feature.
	 */
	it("no vocabulary for screens that don't exist yet", () => {
		const labels = MOBILE_SETTINGS_NAV.map((item) => item.label).join(" ");
		for (const absent of [
			"Language",
			"text",
			"sound",
			"Notifications",
			"billing",
			"sync",
			"Security",
			"export",
			"Developer",
			"Theme",
		])
			expect(labels, absent).not.toContain(absent);
	});

	/** The copy table is a `Record`, so adding a category breaks compilation first. */
	it("each category has a description", () => {
		for (const item of MOBILE_SETTINGS_NAV)
			expect(SETTINGS_CATEGORY_DESCRIPTION[item.category]).toBeTruthy();
	});
});

describe("account isn't a category", () => {
	it("it's outside the list and points at another address", () => {
		expect(MOBILE_SETTINGS_ACCOUNT_LINK.route).toBe("/account");
		for (const item of MOBILE_SETTINGS_NAV)
			expect(item.route).not.toBe("/account");
	});

	/** No `/settings/account`: the account screen already has its own address. */
	it("there's no account address under settings", () => {
		for (const item of MOBILE_SETTINGS_NAV)
			expect(item.route).not.toMatch(/^\/settings\/account/);
	});
});

describe("every category is classified as the settings utility", () => {
	/**
	 * The list and the shell decision read the **same address**. If they diverge, an existing category
	 * fails to light the gear, and the symptom shows only on that screen.
	 */
	it("all three are utility=settings and turn on no section", () => {
		for (const item of MOBILE_SETTINGS_NAV)
			expect(mobileShellRouteFor(item.route), item.route).toEqual({
				section: null,
				activeRoomId: null,
				activeRuntimeStoryId: null,
				utility: "settings",
			});
	});
});

describe("where to return after signing in", () => {
	/**
	 * **A defect this slice fixed.** A guest who opened `/settings/ai` directly and signed in used to
	 * return to `/settings`. It was not an error, so nobody reported it.
	 */
	it("each category returns to its own screen", () => {
		expect(settingsLoginRedirect("general")).toBe("/settings");
		expect(settingsLoginRedirect("ai")).toBe("/settings/ai");
		expect(settingsLoginRedirect("persona")).toBe("/settings/personas");
	});

	/**
	 * **The return target is one of the three values this module knows.** The point is that there is
	 * no slot for an arbitrary path, and that value goes through Better Auth's Expo client into a deep
	 * link (`lib/return-path.ts`: that one place is the phishing path).
	 */
	it("returns only addresses in the navigation list", () => {
		const routes = new Set(MOBILE_SETTINGS_NAV.map((item) => item.route));
		for (const item of MOBILE_SETTINGS_NAV)
			expect(routes.has(settingsLoginRedirect(item.category))).toBe(true);
	});

	/** The account screen is not a settings category, so it is absent from this return table too. */
	it("doesn't send to the account", () => {
		for (const item of MOBILE_SETTINGS_NAV)
			expect(settingsLoginRedirect(item.category)).not.toBe(
				MOBILE_SETTINGS_ACCOUNT_LINK.route,
			);
	});

	/** Every category in the list has an answer; a growing vocabulary shows up here first. */
	it("every category has its own address", () => {
		for (const item of MOBILE_SETTINGS_NAV)
			expect(settingsLoginRedirect(item.category)).toBe(item.route);
	});
});
