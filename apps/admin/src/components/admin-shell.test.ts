import { describe, expect, test } from "vitest";
import { isNavActive } from "./admin-shell.tsx";

/**
 * `/moderation` and `/moderation/appeals` overlap by prefix; with plain prefix matching both carry
 * `aria-current` on the appeals screen. Only one looks highlighted, so review misses it and only
 * screen reader users hear "in two places at once" (same class of bug as the creation tabs'
 * `activeOptions`).
 */

const nav = (to: string, exact?: boolean) => ({
	to,
	label: to,
	icon: (() => null) as never,
	exact,
});

describe("isNavActive", () => {
	test("exact destinations do not light up on subpaths", () => {
		const moderation = nav("/moderation", true);
		expect(isNavActive(moderation, "/moderation")).toBe(true);
		expect(isNavActive(moderation, "/moderation/appeals")).toBe(false);
		expect(isNavActive(moderation, "/moderation/reports/abc")).toBe(false);
	});

	/**
	 * The most important case here: add a line whenever another destination shares a prefix.
	 */
	test("on the appeals screen only appeals lights up", () => {
		const items = [nav("/moderation", true), nav("/moderation/appeals", true)];
		const active = items.filter((item) =>
			isNavActive(item, "/moderation/appeals"),
		);
		expect(active.map((i) => i.to)).toEqual(["/moderation/appeals"]);
	});

	test("prefix destinations light up on detail pages too", () => {
		const members = nav("/members");
		expect(isNavActive(members, "/members")).toBe(true);
		expect(isNavActive(members, "/members/abc123")).toBe(true);
	});

	/** `startsWith(item.to)` would wrongly light `/members` on `/membersomething`. */
	test("prefixes break at path boundaries", () => {
		expect(isNavActive(nav("/members"), "/membersomething")).toBe(false);
	});

	test("the root does not light up on other screens", () => {
		const overview = nav("/", true);
		expect(isNavActive(overview, "/")).toBe(true);
		expect(isNavActive(overview, "/members")).toBe(false);
	});
});
