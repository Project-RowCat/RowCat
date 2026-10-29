import type { StoryDraft } from "@rowcat/authoring";
import { type CreatorWork, isOwnWorkViewable } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import { creatorWorkRows, draftIdIndex } from "./work.ts";

/**
 * Connection between server works and local drafts, verified without rendering.
 *
 * Wrong answers here are silent. `Edit draft` becomes a dead link to a deleted draft; `Not found` appears
 * although the draft exists; or `View story` renders for a work
 * the viewer cannot open, which always ends in a 404. All three look correct when the screen is
 * opened and show up only on click.
 */

const work = (patch: Partial<CreatorWork> = {}): CreatorWork => ({
	id: "story-1",
	originDraftId: "draft-1",
	title: "Story",
	visibility: "private",
	adult: false,
	promptProtected: false,
	hidden: false,
	coverUrl: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-02T00:00:00.000Z",
	...patch,
});

const draft = (id: string): StoryDraft => ({ id }) as StoryDraft;

describe("draft index", () => {
	it("holds only live draft ids", () => {
		expect(draftIdIndex([draft("a"), draft("b")])).toEqual(new Set(["a", "b"]));
	});

	it("no drafts gives an empty set", () => {
		expect(draftIdIndex([]).size).toBe(0);
	});
});

describe("story row mapping", () => {
	/**
	 * Locks in that the two identities stay separate. Work id and draft id are different values, and
	 * the only link between them is `originDraftId`.
	 */
	it("with the draft on this device, the edit target is that draft id", () => {
		const rows = creatorWorkRows(
			[work({ id: "story-1", originDraftId: "d1" })],
			draftIdIndex([draft("d1")]),
		);
		expect(rows[0]?.editableDraftId).toBe("d1");
		expect(rows[0]?.editableDraftId).not.toBe(rows[0]?.work.id);
	});

	/**
	 * The server knows the source draft, but this device does not have it. Either it was deleted here,
	 * or it was published from another device and sync has not arrived yet. Never fabricate a draft.
	 */
	it("without the original draft on this device there is no edit target", () => {
		const rows = creatorWorkRows(
			[
				work({ id: "w1", originDraftId: "d1" }),
				work({ id: "w2", originDraftId: "d9" }),
			],
			draftIdIndex([draft("d1"), draft("d2")]),
		);
		expect(rows.map((r) => r.editableDraftId)).toEqual(["d1", null]);
	});

	/** A work imported or seeded has no source draft at all. It still gets a row. */
	it("a story with no source draft at all still stays in the list", () => {
		const rows = creatorWorkRows(
			[work({ originDraftId: null })],
			draftIdIndex([draft("d1")]),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.editableDraftId).toBeNull();
	});

	/**
	 * Keep the server's order. Re-sorting here would shift page boundaries across `Show more` pages, and
	 * the shift shows up as the same work appearing twice.
	 */
	it("does not change the server's order", () => {
		const rows = creatorWorkRows(
			[work({ id: "c" }), work({ id: "a" }), work({ id: "b" })],
			draftIdIndex([]),
		);
		expect(rows.map((r) => r.work.id)).toEqual(["c", "a", "b"]);
	});

	/**
	 * The server constraint (unique per member) prevents one draft id from attaching to another
	 * member's work. This function judges only within the list it receives, so an id missing from the
	 * index always yields null.
	 */
	it("a draft id not in the index never becomes an edit target", () => {
		const rows = creatorWorkRows(
			[work({ originDraftId: "someone-elses-draft" })],
			draftIdIndex([draft("my-draft")]),
		);
		expect(rows[0]?.editableDraftId).toBeNull();
	});
});

describe("can it be opened", () => {
	it("the owner opens private and public stories", () => {
		expect(isOwnWorkViewable(work({ visibility: "private" }))).toBe(true);
		expect(isOwnWorkViewable(work({ visibility: "public" }))).toBe(true);
	});

	/**
	 * The detail fetch goes through the same visibility boundary as the list (`galleryWhere`).
	 * Moderation-hidden and archived works return 404 even to the owner, so a link rendered for them
	 * always ends in `Not found` (not found).
	 */
	it("even the owner can't open a story hidden by operators", () => {
		expect(isOwnWorkViewable(work({ hidden: true }))).toBe(false);
	});

	it("archived stories can't be opened either", () => {
		expect(isOwnWorkViewable(work({ visibility: "archived" }))).toBe(false);
	});

	/** Hidden and archived are independent axes, so the answer is the same even when both apply. */
	it("the result is the same when hidden and archived overlap", () => {
		expect(
			isOwnWorkViewable(work({ hidden: true, visibility: "archived" })),
		).toBe(false);
	});
});
