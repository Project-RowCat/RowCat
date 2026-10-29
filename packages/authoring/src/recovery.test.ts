import type { Rev } from "@rowcat/contracts/sync";
import { describe, expect, it } from "vitest";
import {
	AUTHORING_SCHEMA_VERSION,
	DRAFT_GROUP_FIELDS,
	type DraftFieldRev,
	type StoryDraft,
	type StoryDraftPatch,
} from "./model.ts";
import {
	DRAFT_RECOVERY_COPY,
	DRAFT_RECOVERY_FIELD_LABEL,
	DRAFT_RECOVERY_GROUP_LABEL,
	type DraftConflictRecovery,
	draftGroupValues,
	draftRecoveryDifferences,
	draftRecoveryPayload,
	draftRecoveryRestoreConfirm,
	draftRecoveryValueText,
	parseDraftConflictRecovery,
	RECOVERABLE_DRAFT_FIELD_GROUPS,
	restoreDraftConflict,
	summarizeDraftRecoveries,
} from "./recovery.ts";

/**
 * Pure rules for recovery copies, with no storage or UI involved. Two things are checked: what gets
 * kept (only one group's values), and what restore does (it makes a new edit rather than reviving
 * an old revision). A mistake in either shows no symptom on screen. It appears only when a restored
 * value disappears again on another device.
 */

const rev = (t: number, d = "device-a"): Rev => ({ t, c: 0, d });

const fieldRev = (base: Rev, overrides: Partial<DraftFieldRev> = {}) => ({
	meta: base,
	rating: base,
	body: base,
	defaults: base,
	publication: base,
	...overrides,
});

const draft = (overrides: Partial<StoryDraft> = {}): StoryDraft => ({
	id: "draft-1",
	schemaVersion: AUTHORING_SCHEMA_VERSION,
	title: "Title",
	tagline: "one line",
	description: "description",
	tags: ["tag"],
	orientation: null,
	adult: false,
	visibility: "private",
	promptProtected: false,
	prompt: "body",
	defaultStartSceneId: null,
	publishedStoryId: null,
	fieldRev: fieldRev(rev(1000)),
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 0,
	rev: rev(1000),
	...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
	id: "authoring.draft:draft-1:body:1000.0.device-a",
	type: "authoring.draft",
	recordId: "draft-1",
	scope: "body",
	losingRev: rev(1000),
	payload: {
		draftId: "draft-1",
		group: "body",
		values: { prompt: "lost body" },
	},
	observedAt: "2026-02-01T00:00:00.000Z",
	...overrides,
});

describe("recoverable groups", () => {
	it("four, without `publication`", () => {
		expect([...RECOVERABLE_DRAFT_FIELD_GROUPS]).toEqual([
			"meta",
			"rating",
			"body",
			"defaults",
		]);
	});

	it("the publish link can ride in no copy", () => {
		/**
		 * Removing it from the vocabulary is not enough. The value is a `StoryDraftPatch`, which has no
		 * slot for `publishedStoryId` at all. The group table is checked to confirm that as a value.
		 */
		for (const group of RECOVERABLE_DRAFT_FIELD_GROUPS)
			expect(DRAFT_GROUP_FIELDS[group]).not.toContain("publishedStoryId");
	});

	it("the four groups and every field have user vocabulary", () => {
		for (const group of RECOVERABLE_DRAFT_FIELD_GROUPS) {
			expect(DRAFT_RECOVERY_GROUP_LABEL[group]).toBeTruthy();
			for (const field of DRAFT_GROUP_FIELDS[group])
				expect(
					DRAFT_RECOVERY_FIELD_LABEL[field as keyof StoryDraftPatch],
				).toBeTruthy();
		}
	});
});

describe("kept values", () => {
	it("holds only the fields that group owns", () => {
		const values = draftGroupValues(draft(), "meta");
		expect(Object.keys(values).sort()).toEqual([
			"description",
			"orientation",
			"tagline",
			"tags",
			"title",
		]);
		expect(values).not.toHaveProperty("prompt");
	});

	it("the payload carries the draft identity and the group together", () => {
		const payload = draftRecoveryPayload(
			draft({ prompt: "lost body" }),
			"body",
		);
		expect(payload).toEqual({
			draftId: "draft-1",
			group: "body",
			values: { prompt: "lost body" },
		});
	});
});

describe("reading stored rows", () => {
	it("reads a valid row as a typed copy", () => {
		const parsed = parseDraftConflictRecovery(row());
		expect(parsed).toMatchObject({
			draftId: "draft-1",
			group: "body",
			values: { prompt: "lost body" },
		});
	});

	it("does not read rows of other sync types", () => {
		expect(parseDraftConflictRecovery(row({ type: "chat.room" }))).toBeNull();
	});

	it("the `publication` scope is never read in the first place", () => {
		expect(
			parseDraftConflictRecovery(
				row({
					scope: "publication",
					payload: {
						draftId: "draft-1",
						group: "publication",
						values: {},
					},
				}),
			),
		).toBeNull();
	});

	it("refuses when the envelope's scope and the payload's group differ", () => {
		/**
		 * Restoring from a row whose scope and group disagree would overwrite a group the user did not
		 * choose. There is no basis to decide which side is right, so the row is not read.
		 */
		expect(
			parseDraftConflictRecovery(
				row({
					payload: {
						draftId: "draft-1",
						group: "meta",
						values: { title: "another group" },
					},
				}),
			),
		).toBeNull();
	});

	it("refuses when fields the group does not own are mixed in", () => {
		expect(
			parseDraftConflictRecovery(
				row({
					payload: {
						draftId: "draft-1",
						group: "body",
						values: { prompt: "body", title: "Title" },
					},
				}),
			),
		).toBeNull();
	});

	it("refuses when the draft identity differs from the envelope", () => {
		expect(
			parseDraftConflictRecovery(
				row({
					payload: {
						draftId: "draft-2",
						group: "body",
						values: { prompt: "body" },
					},
				}),
			),
		).toBeNull();
	});

	it("a corrupt payload is `null` rather than throwing", () => {
		expect(parseDraftConflictRecovery(row({ payload: null }))).toBeNull();
		expect(parseDraftConflictRecovery(row({ payload: "garbage" }))).toBeNull();
	});
});

describe("showing differences", () => {
	it("picks only fields that differ from the current value", () => {
		const recovery = parseDraftConflictRecovery(
			row({
				scope: "meta",
				payload: {
					draftId: "draft-1",
					group: "meta",
					values: {
						title: "lost title",
						tagline: "one line",
						description: "description",
						tags: ["tag"],
						orientation: null,
					},
				},
			}),
		);
		if (!recovery) throw new Error("could not read");
		expect(draftRecoveryDifferences(recovery, draft())).toEqual(["title"]);
	});

	it("compares arrays by content, not by reference", () => {
		const recovery = parseDraftConflictRecovery(
			row({
				scope: "meta",
				payload: {
					draftId: "draft-1",
					group: "meta",
					values: { tags: ["tag"] },
				},
			}),
		);
		if (!recovery) throw new Error("could not read");
		expect(draftRecoveryDifferences(recovery, draft())).toEqual([]);
	});
});

describe("showing values", () => {
	it("does not draw raw values as is", () => {
		expect(draftRecoveryValueText("adult", true)).toBe("On");
		expect(draftRecoveryValueText("adult", false)).toBe("Off");
		expect(draftRecoveryValueText("orientation", null)).toBe("Not set");
		expect(draftRecoveryValueText("tags", ["a", "b"])).toBe("a, b");
		expect(draftRecoveryValueText("defaultStartSceneId", null)).toBe("None");
		expect(draftRecoveryValueText("prompt", "")).toBe("(empty)");
	});
});

/* ─────────────────────────────────────────────────────────────────────────── */

const recoveryOf = (
	group: DraftConflictRecovery["group"],
	values: StoryDraftPatch,
	id = "recovery-1",
): DraftConflictRecovery => ({
	id,
	draftId: "draft-1",
	group,
	values,
	losingRev: rev(1000),
	observedAt: "2026-02-01T00:00:00.000Z",
});

describe("restore", () => {
	it("passes **the ordinary authoring write path**: does not roll back revisions", async () => {
		const patches: StoryDraftPatch[] = [];
		const discarded: string[] = [];
		const outcome = await restoreDraftConflict(
			{
				authoring: {
					updateDraft: async (_id, patch) => {
						patches.push(patch);
						return draft();
					},
				},
				recovery: {
					discard: async (id) => {
						discarded.push(id);
					},
				},
			},
			recoveryOf("body", { prompt: "lost body" }),
		);

		expect(outcome.status).toBe("restored");
		expect(patches).toEqual([{ prompt: "lost body" }]);
		/**
		 * The point of this test is that only the patch is carried over. `rev`, `fieldRev`, `dirty`,
		 * `serverVersion`, and `updatedAt` are not on that object, so there is no way to express
		 * restoring an old version.
		 */
		for (const key of [
			"rev",
			"fieldRev",
			"dirty",
			"serverVersion",
			"updatedAt",
		])
			expect(patches[0]).not.toHaveProperty(key);
		expect(discarded).toEqual(["recovery-1"]);
	});

	it("only a successful restore clears the copy", async () => {
		const discarded: string[] = [];
		const outcome = await restoreDraftConflict(
			{
				authoring: { updateDraft: async () => null },
				recovery: {
					discard: async (id) => {
						discarded.push(id);
					},
				},
			},
			recoveryOf("body", { prompt: "lost body" }),
		);
		expect(outcome.status).toBe("missing");
		// Even with nowhere to restore to, the content is kept. It must still be readable.
		expect(discarded).toEqual([]);
	});

	it("the copy stays when the write fails", async () => {
		const discarded: string[] = [];
		await expect(
			restoreDraftConflict(
				{
					authoring: {
						updateDraft: async () => {
							throw new Error("the disk died");
						},
					},
					recovery: {
						discard: async (id) => {
							discarded.push(id);
						},
					},
				},
				recoveryOf("body", { prompt: "lost body" }),
			),
		).rejects.toThrow();
		expect(discarded).toEqual([]);
	});
});

describe("summary", () => {
	it("folds per draft and orders by most recent observation", () => {
		const summary = summarizeDraftRecoveries([
			{ ...recoveryOf("body", { prompt: "a" }, "r1") },
			{
				...recoveryOf("meta", { title: "b" }, "r2"),
				observedAt: "2026-03-01T00:00:00.000Z",
			},
			{
				...recoveryOf("body", { prompt: "c" }, "r3"),
				draftId: "draft-2",
				observedAt: "2026-04-01T00:00:00.000Z",
			},
		]);
		expect(summary.total).toBe(3);
		expect(summary.drafts.map((entry) => entry.draftId)).toEqual([
			"draft-2",
			"draft-1",
		]);
		expect(summary.drafts[1]).toMatchObject({
			count: 2,
			groups: ["body", "meta"],
			observedAt: "2026-03-01T00:00:00.000Z",
		});
	});
});

describe("user vocabulary", () => {
	const copy = Object.values(DRAFT_RECOVERY_COPY);

	it("internal vocabulary does not leak into screen copy", () => {
		/**
		 * These words are all internal and mean nothing to users. If they reached the screen, the user
		 * would read our implementation instead of what they are restoring.
		 */
		const internal = [
			"fieldRev",
			"HLC",
			"serverVersion",
			"authoring_draft_group_conflict",
			"dirty",
			"rev",
			"tombstone",
			"tombstoned",
			"revision",
		];
		for (const text of [...copy, ...Object.values(DRAFT_RECOVERY_GROUP_LABEL)])
			for (const word of internal) expect(text).not.toContain(word);
	});

	it("group names are not internal vocabulary", () => {
		for (const group of RECOVERABLE_DRAFT_FIELD_GROUPS)
			expect(DRAFT_RECOVERY_GROUP_LABEL[group]).not.toBe(group);
	});

	it("the two column names differ: the screen does not invent which is which", () => {
		expect(DRAFT_RECOVERY_COPY.preservedColumn).not.toBe(
			DRAFT_RECOVERY_COPY.currentColumn,
		);
	});

	it("the restore confirmation says **what is overwritten** and **what stays** together", () => {
		const text = draftRecoveryRestoreConfirm("body");
		expect(text).toContain(DRAFT_RECOVERY_GROUP_LABEL.body);
		expect(text).toContain("Everything else stays");
	});

	it("the delete confirmation says the canonical draft stays", () => {
		expect(DRAFT_RECOVERY_COPY.discardConfirm).toContain("permanently");
		expect(DRAFT_RECOVERY_COPY.discardConfirm).toContain(
			"current draft doesn't change",
		);
	});
});
