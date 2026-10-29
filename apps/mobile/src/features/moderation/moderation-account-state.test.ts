import {
	CAPABILITY_LABEL,
	type MyModerationStatusDto,
} from "@rowcat/contracts";
import { describe, expect, it } from "vitest";
import {
	accountModerationView,
	appealSlotFor,
	collectRestrictionItems,
} from "./moderation-account-state.ts";

/**
 * Verifies the rules of the `Restrictions` section by value: collection, visibility and the appeal cell.
 *
 * This app's tests do not render screens, so if these rules lived inside components, the only way
 * to check them would be by hand. Visibility especially: a regression where the whole section
 * disappears for an account whose restriction was lifted by an accepted appeal compiles, and the
 * screen looks fine.
 */

const EMPTY: MyModerationStatusDto = {
	status: "approved",
	accountActions: [],
	restrictions: [],
	hiddenStories: [],
	appeals: [],
	appealableActionIds: [],
};

const at = "2026-08-01T00:00:00.000Z";

describe("three categories fold into one list", () => {
	it("account actions get product labels", () => {
		const items = collectRestrictionItems({
			...EMPTY,
			status: "suspended",
			accountActions: [
				{
					actionId: "a1",
					kind: "suspend_member",
					publicReason: "",
					createdAt: at,
				},
				{ actionId: "a2", kind: "ban_member", publicReason: "", createdAt: at },
			],
		});
		expect(items.map((item) => item.subject)).toEqual([
			"Account suspended",
			"Account banned",
		]);
	});

	/** The capability label's source is the contract; re-writing the Korean here would leave only this app stale when the vocabulary grows. */
	it("capability restrictions are the contract label + restricted", () => {
		const items = collectRestrictionItems({
			...EMPTY,
			restrictions: [
				{
					capability: "comment.write",
					actionId: "a3",
					publicReason: "",
					createdAt: at,
					expiresAt: "2026-09-01T00:00:00.000Z",
				},
			],
		});
		expect(items[0]?.subject).toBe(
			`${CAPABILITY_LABEL["comment.write"]} restricted`,
		);
	});

	it("hiding a story becomes one row", () => {
		const items = collectRestrictionItems({
			...EMPTY,
			hiddenStories: [
				{ actionId: "a4", storyId: "s1", publicReason: "", createdAt: at },
			],
		});
		expect(items[0]?.subject).toBe("Story hidden");
	});

	/**
	 * Values are preserved: the public reason stays as-is, an empty reason stays empty, and expiry,
	 * applied time and the action reference also pass through unchanged. **Empty reasons are not
	 * filled with sentences:** that slot is one the operator did not write, and filling it would put
	 * words the operator never wrote on screen.
	 */
	it("public reason, expiry and reference are kept without invented values", () => {
		const items = collectRestrictionItems({
			...EMPTY,
			restrictions: [
				{
					capability: "social.write",
					actionId: "action-opaque",
					publicReason: "Community guideline violation",
					createdAt: at,
					expiresAt: "2026-09-01T00:00:00.000Z",
				},
			],
			hiddenStories: [
				{ actionId: "a5", storyId: "s1", publicReason: "", createdAt: at },
			],
		});

		expect(items[0]).toEqual({
			actionId: "action-opaque",
			subject: `${CAPABILITY_LABEL["social.write"]} restricted`,
			publicReason: "Community guideline violation",
			createdAt: at,
			expiresAt: "2026-09-01T00:00:00.000Z",
		});
		/** An empty reason stays empty; there is no substitute sentence such as "policy violation". */
		expect(items[1]?.publicReason).toBe("");
		/** Account actions and story hiding have no expiry axis: null, not an invented date. */
		expect(items[1]?.expiresAt).toBeNull();
	});
});

describe("section visibility", () => {
	it("no restrictions and no past appeals means no section", () => {
		expect(accountModerationView(EMPTY)).toBeNull();
	});

	it("an active restriction means a section", () => {
		const view = accountModerationView({
			...EMPTY,
			restrictions: [
				{
					capability: "story.publish",
					actionId: "a1",
					publicReason: "",
					createdAt: at,
					expiresAt: null,
				},
			],
		});
		expect(view?.items).toHaveLength(1);
	});

	/**
	 * **This is why an accepted appeal keeps the section.** When an appeal is accepted the restriction
	 * disappears, and looking only at active restrictions would remove the section at that moment,
	 * leaving the user no way to check what happened to their appeal.
	 */
	it.each([
		"accepted",
		"rejected",
	] as const)("even without an active restriction, a %s appeal alone means a section", (status) => {
		const view = accountModerationView({
			...EMPTY,
			appeals: [
				{
					id: "p1",
					actionId: "a1",
					status,
					createdAt: at,
					resolvedAt: "2026-08-02T00:00:00.000Z",
				},
			],
		});
		expect(view).not.toBeNull();
		expect(view?.items).toEqual([]);
		expect(view?.resolvedAppeals.map((row) => row.id)).toEqual(["p1"]);
	});

	/**
	 * **An open appeal is not a past appeal.** It is stated beside its own restriction row and does
	 * not enter the history list. A state with an open appeal and no active restriction is a
	 * combination the server never produces, so there is no section for it either.
	 */
	it("an open appeal isn't a past appeal", () => {
		const view = accountModerationView({
			...EMPTY,
			restrictions: [
				{
					capability: "comment.write",
					actionId: "a1",
					publicReason: "",
					createdAt: at,
					expiresAt: null,
				},
			],
			appeals: [
				{
					id: "p1",
					actionId: "a1",
					status: "open",
					createdAt: at,
					resolvedAt: null,
				},
			],
		});
		expect(view?.resolvedAppeals).toEqual([]);
		expect(view?.openAppealActionIds.has("a1")).toBe(true);
	});
});

describe("appeal cell — a mapping of the value the server answered", () => {
	/**
	 * What is verified here is only the **mapping from server value to cell**. The algorithm for which
	 * action is appealable belongs to the server; reproducing it here would eventually diverge from
	 * the server.
	 */
	const view = {
		openAppealActionIds: new Set(["a-open"]),
		appealableActionIds: new Set(["a-open", "a-can"]),
	};

	it("an open appeal means under review — no second button", () => {
		expect(appealSlotFor("a-open", view)).toBe("open");
	});

	it("in the appealable list it's a button", () => {
		expect(appealSlotFor("a-can", view)).toBe("appealable");
	});

	it("neither means a sentence — not a disabled button", () => {
		expect(appealSlotFor("a-none", view)).toBe("unavailable");
	});
});
