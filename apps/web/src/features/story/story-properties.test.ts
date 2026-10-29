import type { Story } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import { formatStorySize, storyPropertyRows } from "./story-properties.ts";

/**
 * This table guards absence, not layout: every assertion checks that a row is missing. A row that
 * wrongly appears raises no error; it repeats a fact or shows a meaningless value.
 */

/**
 * These timestamps are chosen so that same-day and different-day cases hold in product time (KST).
 */
const AUG_21_MORNING = "2026-08-21T00:30:00.000Z"; // KST 09:30
const AUG_21_EVENING = "2026-08-21T09:30:00.000Z"; // KST 18:30
const AUG_22 = "2026-08-22T01:00:00.000Z";

const story = (overrides: Partial<Story> = {}): Story => ({
	id: "story-1",
	title: "Night Library",
	description: "The Strange Library Where Books Talk",
	author: "",
	coverUrl: null,
	orientation: "female",
	adult: false,
	visibility: "public",
	promptProtected: false,
	tags: [],
	favorites: 0,
	creator: { id: "member-1", nickname: "Rain" },
	playMode: "chat",
	createdAt: AUG_21_MORNING,
	updatedAt: AUG_21_MORNING,
	sizeBytes: 18_842,
	...overrides,
});

const labels = (s: Story) => storyPropertyRows(s).map((row) => row.label);
const propertyValue = (s: Story, label: string) =>
	storyPropertyRows(s).find((row) => row.label === label)?.value;

describe("storyPropertyRows", () => {
	it("a never-edited story has no updated row", () => {
		expect(labels(story())).toEqual(["Posted", "Size"]);
	});

	it("a story edited the same day has no updated row — this table speaks in dates", () => {
		expect(labels(story({ updatedAt: AUG_21_EVENING }))).toEqual([
			"Posted",
			"Size",
		]);
	});

	it("an edit on another day adds the updated row", () => {
		expect(labels(story({ updatedAt: AUG_22 }))).toContain("Updated");
	});

	it("the author credit is hidden when it equals the creator nickname", () => {
		expect(labels(story({ author: "Rain" }))).not.toContain("Author credit");
	});

	it("a different author credit is shown", () => {
		expect(
			propertyValue(story({ author: "Nameless Librarian" }), "Author credit"),
		).toBe("Nameless Librarian");
	});

	it("the author credit stays for a story without a creator (deleted account)", () => {
		expect(
			propertyValue(story({ author: "Rain", creator: null }), "Author credit"),
		).toBe("Rain");
	});

	it("no body row unless protected — it never writes No", () => {
		expect(labels(story())).not.toContain("Body");
		expect(labels(story({ promptProtected: true }))).toContain("Body");
	});

	it("an unreadable time makes no empty row", () => {
		const rows = labels(story({ createdAt: "not-a-date", updatedAt: AUG_22 }));
		expect(rows).not.toContain("Posted");
		// Failing to read the registration date must not also drop the edit row.
		expect(rows).toContain("Updated");
	});

	it("only size uses aligned digits", () => {
		const numeric = storyPropertyRows(story())
			.filter((row) => row.numeric)
			.map((row) => row.label);
		expect(numeric).toEqual(["Size"]);
	});

	it("internal ids and metrics never reach the table in any combination", () => {
		const rows = storyPropertyRows(
			story({
				author: "Nameless Librarian",
				updatedAt: AUG_22,
				promptProtected: true,
				favorites: 128,
			}),
		);
		const flat = rows.map((row) => `${row.label}:${row.value}`).join("|");
		expect(flat).not.toContain("story-1");
		expect(flat).not.toContain("member-1");
		expect(flat).not.toContain("128");
	});
});

describe("formatStorySize", () => {
	it("under 1KiB stays in bytes", () => {
		expect(formatStorySize(0)).toBe("0 B");
		expect(formatStorySize(1023)).toBe("1023 B");
	});

	it("keeps a decimal only under 10", () => {
		expect(formatStorySize(1024)).toBe("1.0 KB");
		expect(formatStorySize(18_842)).toBe("18 KB");
		expect(formatStorySize(9.7 * 1024 * 1024)).toBe("9.7 MB");
	});

	it("stops at the largest unit", () => {
		expect(formatStorySize(5 * 1024 ** 4)).toBe("5.0 TB");
	});
});
