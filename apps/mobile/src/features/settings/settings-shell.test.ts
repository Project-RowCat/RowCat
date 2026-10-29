import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	MOBILE_SETTINGS_NAV,
	settingsCategoryForPath,
} from "./settings-nav.ts";

/**
 * **The settings navigation row outlives the categories.** This is the only condition under which
 * the active indicator can slide between siblings.
 *
 * This file exists because of something seen on a device. Categories used to be separate stack
 * screens (`<SettingsScreen category="ai">`), so `General` → `AI` was **a whole-screen push from the
 * right**. The row and the indicator were both built fresh, so the indicator had no sibling to
 * slide from and simply appeared at the new position. On the web the same move keeps the shell and
 * moves only the indicator.
 *
 * That difference was once recorded as an **intended difference**, but what blocked it was not a
 * platform constraint. It was this app's route structure. Nested expo-router layouts and `<Slot />`
 * already provide that axis.
 *
 * **This file proves structure only.** Whether the indicator really slides requires rendering the
 * screen, and this app's tests do not render screens (`vitest.config.ts`). That observation belongs
 * to the runtime QA in `docs/motion/ARCHITECTURE.md`. What is locked here is **a structure in which
 * the sliding is possible**.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

const read = (...parts: string[]): string =>
	readFileSync(join(SRC, ...parts), "utf8");

/** Source with comments stripped. Comments in this repository name a rule by the rule's own name. */
const code = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const layout = code(read("app", "settings", "_layout.tsx"));
const shell = code(read("features", "settings", "settings-shell.tsx"));
const nav = code(read("features", "settings", "settings-navigation.tsx"));

const CATEGORY_SCREENS = [
	"settings-general-screen.tsx",
	"settings-ai-screen.tsx",
	"settings-persona-screen.tsx",
] as const;

const CATEGORY_ROUTES = ["index.tsx", "ai.tsx", "personas.tsx"] as const;

describe("the layout route owns the shell", () => {
	/**
	 * **`<Slot />`, not `<Stack />`.** Adding another stack here would turn category switches back
	 * into screen transitions (push, transition, their own motion), and what this file protects would
	 * be lost.
	 */
	it("the layout stands the shell and draws one child cell", () => {
		expect(layout).toContain("<SettingsShell");
		expect(layout).toContain("<Slot />");
		expect(layout).not.toContain("<Stack");
		expect(layout).not.toContain("<Tabs");
	});

	/**
	 * **The address still owns the category.** Do not build a shape that passes a `useState` category
	 * into the navigation row and calls `router.replace` beside it. Deep links, back navigation and
	 * state restoration would then have to follow a second source of truth, and the moment the two
	 * diverge the indicator shows A while the screen shows B.
	 */
	it("the layout doesn't create a second navigation state", () => {
		expect(layout).toContain("settingsCategoryForPath");
		expect(layout).toContain("usePathname");
		expect(layout).not.toMatch(/useState|useReducer/);
		expect(layout).not.toMatch(/selectedCategory|activeTab|visualSelected/);
	});

	/**
	 * **The navigation row is drawn in one place.** If each category screen draws it, the row is
	 * rebuilt for every category and the indicator has no sibling to move between. This is exactly the
	 * structure this slice fixed.
	 */
	it("the navigation row is drawn in one shell only", () => {
		expect(shell).toContain("<SettingsNavigation");
		for (const screen of CATEGORY_SCREENS) {
			const text = code(read("features", "settings", screen));
			expect(text, screen).not.toContain("SettingsNavigation");
			expect(text, screen).not.toContain("<AppBar");
			expect(text, screen).not.toContain("<Screen>");
		}
	});

	/**
	 * **The entrance is not in the shell.** While the shell survives, an arrival animation here would
	 * make the navigation row re-enter on every category, which would blink the whole row and undo the
	 * sliding indicator. The web's page owns its entrance too (`settings-general-page.tsx`).
	 */
	it("the category body owns the arrival", () => {
		expect(shell).not.toContain("PageEnter");
		for (const screen of CATEGORY_SCREENS) {
			const text = code(read("features", "settings", screen));
			expect(text, screen).toContain("<PageEnter>");
		}
	});
});

describe("the indicator can move between them structurally", () => {
	/**
	 * **The group belongs to the shell.** If the layer holding the measured frames unmounts with the
	 * category, the indicator is always in its "first placement" state and cannot slide. (Keeping that
	 * first placement silent is the rule of `active-indicator.tsx`.)
	 */
	it("the active indicator group is inside the navigation row, and that row is the shell's", () => {
		expect(nav).toContain("<MotionIndicatorGroup");
		expect(nav).toContain("<MotionIndicatorItem");
		expect(shell).toContain("<SettingsNavigation");
	});

	/** The group does not choose which sibling is active; it receives the value passed down from the route. */
	it("the group doesn't pick the active sibling itself", () => {
		expect(nav).toMatch(/activeKey=\{category\}/);
		expect(nav).not.toMatch(/useState|usePathname/);
	});
});

describe("the addresses didn't change by a character", () => {
	/** The three categories are still separate files; deep links, back navigation and state restoration come from there. */
	it("every category has its own route file", () => {
		for (const route of CATEGORY_ROUTES)
			expect(() => read("app", "settings", route)).not.toThrow();
	});

	/** The navigation model's three addresses are unchanged. */
	it("the navigation model's addresses stay three", () => {
		expect(MOBILE_SETTINGS_NAV.map((item) => item.route)).toEqual([
			"/settings",
			"/settings/ai",
			"/settings/personas",
		]);
	});
});

describe("address → category", () => {
	it("the three addresses answer their categories", () => {
		expect(settingsCategoryForPath("/settings")).toBe("general");
		expect(settingsCategoryForPath("/settings/ai")).toBe("ai");
		expect(settingsCategoryForPath("/settings/personas")).toBe("persona");
	});

	/** A trailing slash is the same screen; the difference does not switch off the navigation row. */
	it("a trailing slash doesn't change the answer", () => {
		expect(settingsCategoryForPath("/settings/")).toBe("general");
		expect(settingsCategoryForPath("/settings/ai/")).toBe("ai");
	});

	/**
	 * **Unknown addresses do not throw.** This function runs under `/settings` already, and an unknown
	 * tail there is a non-existent screen that the router already answers. Throwing here would make
	 * the whole navigation row disappear.
	 */
	it("an unknown address folds to the default category", () => {
		expect(settingsCategoryForPath("/settings/nope")).toBe("general");
		expect(settingsCategoryForPath("")).toBe("general");
	});
});
