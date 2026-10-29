import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FileRouteTypes } from "#/routeTree.gen";
import {
	SETTINGS_ACCOUNT_LINK,
	SETTINGS_NAV,
	settingsNavLabel,
} from "./settings-nav.ts";

/**
 * Checks the settings navigation list without rendering. What matters is policy, not markup: the
 * list holds only screens that exist, destinations are real routes, the account screen is not mixed
 * in as a settings category, and the two containers split the active-indicator name. The failures
 * are quiet: a dead entry, a destination that disappears only at narrow widths, or an indicator
 * flying across the screen.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const NAVIGATION = readFileSync(join(HERE, "settings-navigation.tsx"), "utf8");

describe("settings navigation list", () => {
	/**
	 * Destinations are real routes. Typing them against the generated route type means that moving a
	 * file or deleting a route makes the typecheck reject them. Only the type is imported, so the
	 * route module is not loaded (same approach as shell-route.test.ts).
	 */
	it("every item points at a real route", () => {
		const destinations: FileRouteTypes["to"][] = [
			...SETTINGS_NAV.map((item) => item.to),
			SETTINGS_ACCOUNT_LINK.to,
		];
		expect(destinations).toEqual([
			"/settings",
			"/settings/ai",
			"/settings/personas",
			"/account",
		]);
	});

	/**
	 * `/settings` is in the list. The only way into this screen is the gear in the header, and its
	 * address is /settings. If the list held only other addresses such as /settings/general, arriving
	 * visitors would find no active entry.
	 */
	it("the default screen's address is /settings as is", () => {
		const general = SETTINGS_NAV.find((item) => item.category === "general");
		expect(general?.to).toBe("/settings");
	});

	/**
	 * No placeholders. The navigation list is justified by structure, not by filling empty slots. If
	 * terms such as notifications, language or accessibility entered the vocabulary, the screen would
	 * draw them as disabled items, and users would read them as features coming soon. New categories
	 * arrive in the same commit as the screen they point to.
	 */
	it("holds only screens that exist now", () => {
		expect(SETTINGS_NAV.map((item) => item.category)).toEqual([
			"general",
			"ai",
			"persona",
		]);
	});

	/**
	 * Personas belong here. Saved personas are account assets, not children of any conversation
	 * (persona.ts in @rowcat/chat), so they form a global settings category. Their canonical address
	 * is /settings/personas alone. The old address (/personas) survives only as a redirect with no
	 * screen, so it does not qualify for this list.
	 */
	it("personas are a settings category", () => {
		const persona = SETTINGS_NAV.find((item) => item.category === "persona");
		expect(settingsNavLabel("persona")).toBe("Personas");
		expect(persona?.to).toBe("/settings/personas");
	});

	/**
	 * Account management is not a category. Placing it in the same group would imply that account
	 * settings live under /settings. The boundary between the two screens would then blur in the
	 * navigation list.
	 */
	it("account management is outside the category list", () => {
		expect(
			SETTINGS_NAV.some(
				(item) => (item.to as string) === SETTINGS_ACCOUNT_LINK.to,
			),
		).toBe(false);
	});
});

describe("two containers", () => {
	/**
	 * The wide-screen left column and the narrow-screen horizontal row are both always in the DOM, and
	 * CSS hides one of them. If the active indicator uses the same name in both, Motion treats them as
	 * siblings and the indicator flies between the two containers. Type checks and rendering both
	 * pass, so this test checks the value. Collisions across files are covered by
	 * lib/motion/active-indicator.test.ts; this assertion covers two surfaces within a single file.
	 */
	it("the active indicator names differ", () => {
		const groups = [...NAVIGATION.matchAll(/group="([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(groups).toEqual(["settings-nav-side", "settings-nav-compact"]);
	});

	/**
	 * Do not hand-write the list a second time. Two containers, each with its own array, mean that
	 * when a category is added only one side grows, and the omission would show only at narrow widths.
	 */
	it("both containers draw from the same list", () => {
		expect(
			[...NAVIGATION.matchAll(/SETTINGS_NAV\.map/g)].length,
		).toBeGreaterThanOrEqual(2);
		expect(NAVIGATION).not.toMatch(/>General</);
		expect(NAVIGATION).not.toMatch(/>AI</);
		expect(NAVIGATION).not.toMatch(/>Personas</);
	});
});
