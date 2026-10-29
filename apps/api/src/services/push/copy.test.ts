import { NotificationKind } from "@rowcat/contracts";
import { describe, expect, test } from "vitest";
import { PUSH_TITLE, pushCopyFor } from "./copy.ts";

/**
 * Lock-screen copy, a surface non-owners can read. What is pinned is not wording taste but what is
 * absent: some things the inbox DTO carries (actor nickname, story title) must not appear here.
 */

describe("the vocabulary pairs exactly with the notification kinds", () => {
	test("every kind in the vocabulary has copy", () => {
		for (const kind of NotificationKind.options)
			expect(pushCopyFor(kind), kind).not.toBeNull();
	});

	/** No invented sentence for an unknown kind; the inbox still has the row. */
	test("an unknown kind has no copy", () => {
		expect(pushCopyFor("update_note")).toBeNull();
		expect(pushCopyFor("")).toBeNull();
	});
});

describe("the title doesn't name the kind", () => {
	/** A per-kind title would itself classify the notification (a `Moderation action` banner reveals account state). */
	test("all of them are just the app name", () => {
		for (const kind of NotificationKind.options)
			expect(pushCopyFor(kind)?.title).toBe(PUSH_TITLE);
		expect(PUSH_TITLE).toBe("RowCat");
	});
});

describe("what doesn't appear on the lock screen", () => {
	const bodies = NotificationKind.options.map(
		(kind) => pushCopyFor(kind)?.body ?? "",
	);

	/** Any placeholder would mean the copy takes values, which are user data; none means body, name and title cannot appear. */
	test("the copy has no placeholders", () => {
		for (const body of bodies) {
			expect(body).not.toMatch(/\{\{|\$\{|%s|%\d/);
			expect(body.length).toBeGreaterThan(0);
		}
	});

	test("doesn't tell operations or report details", () => {
		for (const body of bodies)
			for (const forbidden of [
				/reason/i,
				/operator/i,
				/reported content/i,
				/block|suspend|hid/i,
				/@/,
			])
				expect(body, `${body} — ${forbidden}`).not.toMatch(forbidden);
	});

	/** The lock screen is seen by people who have not unlocked the device and stored by the OS, so a name there goes where we cannot erase it. */
	test("no words pointing at the actor or the story", () => {
		for (const body of bodies) {
			expect(body).not.toMatch(/'s\b/);
			expect(body).not.toMatch(/「|」|“|”/);
		}
	});
});

/**
 * New public story: neither the creator nor the story is named. Kept separate although the loop
 * above covers every kind, so a failure names which kind broke the rule.
 */
describe("a followed creator's new story", () => {
	const copy = pushCopyFor("creator_story_published");

	test("has copy, and the title is the app name", () => {
		expect(copy).not.toBeNull();
		expect(copy?.title).toBe(PUSH_TITLE);
	});

	/** Whom someone follows must not stand on a surface the OS stores. */
	test("neither the creator's name nor the story title appears", () => {
		const body = copy?.body ?? "";
		expect(body).not.toMatch(/'s\b/);
		expect(body).not.toMatch(/「|」|"|"|"/);
		expect(body).not.toMatch(/\{\{|\$\{|%s/);
	});
});
