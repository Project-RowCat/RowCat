import type { Rev } from "@rowcat/contracts/sync";
import { describe, expect, it } from "vitest";
import {
	AUTHORING_SCHEMA_VERSION,
	type DraftLoreEntry,
	type StoryDraft,
} from "./model.ts";
import { createDraftRuntimeAssetRecord } from "./runtime.ts";
import {
	AUTHORING_MERGE_NOTE,
	authoringSyncCodecs,
	draftLoreSyncCodec,
	draftRuntimeAssetSyncCodec,
	storyDraftSyncCodec,
} from "./sync-codec.ts";

/**
 * Authoring codec: field-group merge for the draft.
 *
 * In this repo, only the draft root merges field by field. The reason is something that really
 * happens: device A edits the title offline on a phone while device B edits the prompt on a laptop.
 * Record-level LWW would silently delete one of the two edits.
 */

const rev = (t: number, d = "device-a"): Rev => ({ t, c: 0, d });

const fieldRev = (base: Rev, patch: Partial<Record<string, Rev>> = {}) => ({
	meta: base,
	rating: base,
	body: base,
	defaults: base,
	publication: base,
	...patch,
});

const draft = (patch: Partial<StoryDraft> = {}): StoryDraft => ({
	id: "draft-1",
	schemaVersion: AUTHORING_SCHEMA_VERSION,
	title: "Title",
	tagline: "",
	description: "",
	tags: [],
	orientation: null,
	adult: false,
	visibility: "private",
	promptProtected: false,
	prompt: "prompt",
	defaultStartSceneId: null,
	publishedStoryId: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 1,
	rev: rev(1000),
	fieldRev: fieldRev(rev(1000)),
	...patch,
});

const lore = (patch: Partial<DraftLoreEntry> = {}): DraftLoreEntry => ({
	id: "lore-1",
	draftId: "draft-1",
	positionIndex: 0,
	keys: ["library"],
	content: "setting",
	constant: false,
	position: "system_bottom",
	order: 0,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 1,
	rev: rev(1000),
	...patch,
});

/**
 * Collects both merge channels together. Keeping them apart would create tests that check only one
 * side.
 *
 * `recovered` carries only the candidates the codec reports. Actually writing them to a log (dedup
 * and atomicity) is the store's job, and the app-side tests check that.
 */
const context = () => {
	const notes: string[] = [];
	const recovered: Array<{ scope: string; losingRev: Rev; payload: unknown }> =
		[];
	return {
		notes,
		recovered,
		ctx: {
			note: (code: string) => {
				notes.push(code);
			},
			recover: (candidate: {
				scope: string;
				losingRev: Rev;
				payload: unknown;
			}) => {
				recovered.push(candidate);
			},
		},
	};
};

describe("all six types are present", () => {
	it("registration order is parent → child", () => {
		/**
		 * This order is the outbound order, so a parent is sent before its children.
		 *
		 * The runtime set comes after. The project before files and assets follows the same rule: draft,
		 * then project, then (files and assets) is the real parent relationship. With this order there is
		 * no window in which a file exists without its project. Files and assets are siblings, so their
		 * relative order has no meaning.
		 */
		expect(authoringSyncCodecs.map((codec) => codec.type)).toEqual([
			"authoring.draft",
			"authoring.lore",
			"authoring.scene",
			"authoring.sceneImage",
			"authoring.runtimeProject",
			"authoring.runtimeFile",
			"authoring.runtimeAsset",
		]);
	});

	it("`authoring.character` is **absent**", () => {
		/**
		 * A type without a codec is ignored by the engine, which only advances the cursor. So a person
		 * record uploaded by a device not yet updated passes through this device silently. Its content is
		 * folded into the body by the local migration on the device that actually held that record.
		 */
		expect(authoringSyncCodecs.map((codec) => codec.type)).not.toContain(
			"authoring.character",
		);
	});
});

describe("authoring.draft: field groups", () => {
	it("round-trips", () => {
		const source = draft({ title: "Manuscript", tags: ["tag"] });
		const decoded = storyDraftSyncCodec.decode({
			id: "draft-1",
			schemaVersion: AUTHORING_SCHEMA_VERSION,
			rev: source.rev,
			deletedAt: null,
			data: storyDraftSyncCodec.encode(source),
		});
		expect(decoded).toEqual({ ...source, dirty: 0, serverVersion: 0 });
	});

	it("a v1 payload arrives with the authored body **folded**", () => {
		/**
		 * This is the shape a device that has not updated still sends. Treating a decode failure as an
		 * error would make the record look like a manuscript that vanished from the screen.
		 */
		const decoded = storyDraftSyncCodec.decode({
			id: "draft-1",
			schemaVersion: 1,
			rev: rev(1),
			deletedAt: null,
			data: {
				...(storyDraftSyncCodec.encode(draft({ prompt: "" })) as Record<
					string,
					unknown
				>),
				bodyMode: "structured",
				scenario: "A library where books talk.",
				playGuide: "Write in second person.",
				suggestedPersona: { name: "Visitor", description: "a late guest" },
				fieldRev: fieldRev(rev(1000), { persona: rev(1000) }),
			},
		});

		expect(decoded?.prompt).toBe(
			[
				"A library where books talk.",
				"## \uc9c4\ud589 \uc9c0\uce68\nWrite in second person.",
				"## \uc0c1\ub300\uc5ed\n### Visitor\na late guest",
			].join("\n\n"),
		);
	});

	it("the folded body's `body` revision is **the later** of the old two groups", () => {
		/**
		 * The folded body carries the content of both `body` and `persona`. Sending only the earlier one
		 * would let a newer persona edit on the other device win this record, reverting it to the
		 * pre-fold state.
		 */
		const decoded = storyDraftSyncCodec.decode({
			id: "draft-1",
			schemaVersion: 1,
			rev: rev(1),
			deletedAt: null,
			data: {
				...(storyDraftSyncCodec.encode(draft()) as Record<string, unknown>),
				bodyMode: "structured",
				scenario: "body",
				playGuide: "",
				suggestedPersona: null,
				fieldRev: fieldRev(rev(1000), {
					body: rev(2000),
					persona: rev(4000),
				}),
			},
		});

		expect(decoded?.fieldRev.body).toEqual(rev(4000));
		expect(decoded?.fieldRev).not.toHaveProperty("persona");
	});

	it("does not apply when any of the five groups is missing", () => {
		// A missing group has nothing to merge against. Inventing one would silently overwrite that
		// group's edits.
		const data = storyDraftSyncCodec.encode(draft()) as Record<string, unknown>;
		const broken = {
			...data,
			fieldRev: { meta: rev(1), rating: rev(1), body: rev(1) },
		};
		expect(
			storyDraftSyncCodec.decode({
				id: "draft-1",
				schemaVersion: 1,
				rev: rev(1),
				deletedAt: null,
				data: broken,
			}),
		).toBeNull();
	});

	it("**both the title and the prompt survive**", () => {
		const local = draft({
			title: "title edited on the phone",
			prompt: "original",
			fieldRev: fieldRev(rev(1000), { meta: rev(3000) }),
			rev: rev(3000),
		});
		const remote = draft({
			title: "original",
			prompt: "prompt written on the laptop",
			fieldRev: fieldRev(rev(1000), { body: rev(2000, "device-b") }),
			rev: rev(2000, "device-b"),
		});
		const merged = storyDraftSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.title).toBe("title edited on the phone");
		expect(merged.record.prompt).toBe("prompt written on the laptop");
		// The local side contributed, so its change has to go back up.
		expect(merged.remoteWins).toBe(false);
	});

	it("the result revision is the max of record revisions, **not** `max(fieldRev)`", () => {
		/**
		 * `rev` also advances on child activity, even when no authoring group changed. Deriving it as
		 * `max(fieldRev)` would erase that activity revision, so the next merge would treat an
		 * already-seen version as unseen.
		 */
		const local = draft({
			rev: rev(9000),
			fieldRev: fieldRev(rev(1000)),
		});
		const remote = draft({
			rev: rev(2000, "device-b"),
			fieldRev: fieldRev(rev(1000)),
		});
		const merged = storyDraftSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.rev).toEqual(rev(9000));
	});

	it("when the same group diverges a diagnostic remains **whoever wins**", () => {
		const local = draft({
			prompt: "A",
			dirty: 1,
			fieldRev: fieldRev(rev(1000), { body: rev(3000) }),
			rev: rev(3000),
		});
		const remote = draft({
			prompt: "B",
			fieldRev: fieldRev(rev(1000), { body: rev(2000, "device-b") }),
			rev: rev(2000, "device-b"),
		});
		const first = context();
		storyDraftSyncCodec.merge(local, remote, first.ctx);
		expect(first.notes).toContain(AUTHORING_MERGE_NOTE.draftGroupConflict);
		const second = context();
		storyDraftSyncCodec.merge(
			{ ...remote, dirty: 1 },
			{ ...local, dirty: 0 },
			second.ctx,
		);
		expect(second.notes).toContain(AUTHORING_MERGE_NOTE.draftGroupConflict);
	});

	it("the losing group's value is kept **in both directions**", () => {
		/**
		 * Keeping the record only on the winning side would let half of the losses vanish. Each device
		 * needs to hold the version it lost on its own side, so the user can find the lost values from
		 * whichever device they open.
		 */
		const local = draft({
			prompt: "A's prompt",
			dirty: 1,
			fieldRev: fieldRev(rev(1000), { body: rev(3000) }),
			rev: rev(3000),
		});
		const remote = draft({
			prompt: "B's prompt",
			fieldRev: fieldRev(rev(1000), { body: rev(2000, "device-b") }),
			rev: rev(2000, "device-b"),
		});

		// Local wins, so the remote value is lost.
		const first = context();
		storyDraftSyncCodec.merge(local, remote, first.ctx);
		expect(first.recovered).toEqual([
			{
				scope: "body",
				losingRev: rev(2000, "device-b"),
				payload: {
					draftId: "draft-1",
					group: "body",
					values: { prompt: "B's prompt" },
				},
			},
		]);

		// Remote wins, so the local value is lost.
		const second = context();
		storyDraftSyncCodec.merge(
			{ ...remote, dirty: 1 },
			{ ...local, dirty: 0 },
			second.ctx,
		);
		expect(second.recovered).toEqual([
			{
				scope: "body",
				losingRev: rev(2000, "device-b"),
				payload: {
					draftId: "draft-1",
					group: "body",
					values: { prompt: "B's prompt" },
				},
			},
		]);
	});

	it("groups that did not diverge are not kept", () => {
		/**
		 * If the groups differ, both values survive. Nothing was lost, so there is nothing to keep.
		 * Creating a copy here would show the user a notice about edits they never lost.
		 */
		const local = draft({
			title: "title edited on the phone",
			dirty: 1,
			fieldRev: fieldRev(rev(1000), { meta: rev(3000) }),
			rev: rev(3000),
		});
		const remote = draft({
			prompt: "prompt written on the laptop",
			fieldRev: fieldRev(rev(1000), { body: rev(2000, "device-b") }),
			rev: rev(2000, "device-b"),
		});
		const { ctx, recovered } = context();
		storyDraftSyncCodec.merge(local, remote, ctx);
		expect(recovered).toEqual([]);
	});

	it("does not keep anything when local is clean: it is not a divergent edit", () => {
		const local = draft({
			prompt: "old value",
			dirty: 0,
			fieldRev: fieldRev(rev(1000)),
		});
		const remote = draft({
			prompt: "new value",
			fieldRev: fieldRev(rev(1000), { body: rev(2000, "device-b") }),
			rev: rev(2000, "device-b"),
		});
		const { ctx, recovered } = context();
		storyDraftSyncCodec.merge(local, remote, ctx);
		expect(recovered).toEqual([]);
	});

	it("several diverged groups in one merge are kept **each**", () => {
		const local = draft({
			title: "A's title",
			prompt: "A's prompt",
			dirty: 1,
			fieldRev: fieldRev(rev(1000), { meta: rev(3000), body: rev(3000) }),
			rev: rev(3000),
		});
		const remote = draft({
			title: "B's title",
			prompt: "B's prompt",
			fieldRev: fieldRev(rev(1000), {
				meta: rev(2000, "device-b"),
				body: rev(4000, "device-b"),
			}),
			rev: rev(4000, "device-b"),
		});
		const { ctx, recovered } = context();
		storyDraftSyncCodec.merge(local, remote, ctx);
		expect(recovered.map((candidate) => candidate.scope)).toEqual([
			"meta",
			"body",
		]);
		// `meta` is won by local, so the remote meta value is lost. `body` is won by remote, so the local
		// body value is lost.
		expect(recovered[0].payload).toMatchObject({
			values: { title: "B's title" },
		});
		expect(recovered[1].payload).toMatchObject({
			values: { prompt: "A's prompt" },
		});
	});

	it("makes no copy even when `publication` diverges", () => {
		/**
		 * This group is monotonic, so it is not the kind of conflict in which a losing version
		 * disappears. Also, if the restore button's job became 'point this draft at a different work',
		 * that would not be a recovery.
		 */
		const local = draft({
			publishedStoryId: "story-1",
			dirty: 1,
			fieldRev: fieldRev(rev(1000), { publication: rev(3000) }),
			rev: rev(3000),
		});
		const remote = draft({
			publishedStoryId: "story-2",
			fieldRev: fieldRev(rev(1000), { publication: rev(5000, "device-b") }),
			rev: rev(5000, "device-b"),
		});
		const { ctx, recovered, notes } = context();
		storyDraftSyncCodec.merge(local, remote, ctx);
		expect(recovered).toEqual([]);
		expect(notes).toContain(AUTHORING_MERGE_NOTE.publicationDivergence);
	});

	it("kept values carry no sync metadata", () => {
		const local = draft({
			prompt: "A",
			dirty: 1,
			fieldRev: fieldRev(rev(1000), { body: rev(3000) }),
			rev: rev(3000),
		});
		const remote = draft({
			prompt: "B",
			fieldRev: fieldRev(rev(1000), { body: rev(4000, "device-b") }),
			rev: rev(4000, "device-b"),
		});
		const { ctx, recovered } = context();
		storyDraftSyncCodec.merge(local, remote, ctx);
		const values = (recovered[0].payload as { values: Record<string, unknown> })
			.values;
		for (const key of [
			"rev",
			"fieldRev",
			"dirty",
			"serverVersion",
			"updatedAt",
			"createdAt",
			"deletedAt",
			"id",
			"publishedStoryId",
		])
			expect(values).not.toHaveProperty(key);
	});

	it("`publishedStoryId` **never returns to null**", () => {
		const local = draft({
			publishedStoryId: "story-99",
			fieldRev: fieldRev(rev(1000), { publication: rev(1000) }),
		});
		const remote = draft({
			publishedStoryId: null,
			fieldRev: fieldRev(rev(1000), { publication: rev(5000, "device-b") }),
			rev: rev(5000, "device-b"),
		});
		const { ctx, notes } = context();
		const merged = storyDraftSyncCodec.merge(local, remote, ctx);
		expect(merged.record.publishedStoryId).toBe("story-99");
		expect(merged.remoteWins).toBe(false);
		expect(notes).toContain(AUTHORING_MERGE_NOTE.publicationRollbackBlocked);
	});

	it("when both are non-null and differ, folds deterministically and leaves a warning", () => {
		const local = draft({
			publishedStoryId: "story-1",
			fieldRev: fieldRev(rev(1000), { publication: rev(1000) }),
		});
		const remote = draft({
			publishedStoryId: "story-2",
			fieldRev: fieldRev(rev(1000), { publication: rev(5000, "device-b") }),
			rev: rev(5000, "device-b"),
		});
		const { ctx, notes } = context();
		const merged = storyDraftSyncCodec.merge(local, remote, ctx);
		expect(merged.record.publishedStoryId).toBe("story-2");
		expect(notes).toContain(AUTHORING_MERGE_NOTE.publicationDivergence);
	});

	it("null is **explicitly unset**, so it does not fold to the default", () => {
		const source = draft({ orientation: null });
		const data = storyDraftSyncCodec.encode(source) as Record<string, unknown>;
		expect(data.orientation).toBeNull();
	});
});

describe("children: record-level HLC", () => {
	it("the higher revision wins", () => {
		/**
		 * Child codecs do not receive a diagnostic context, because there is no signal to record. With no
		 * group merge, the question 'which field of the losing side disappeared' does not apply. What is
		 * lost is one whole revision of a single item.
		 */
		const local = lore({ content: "local", rev: rev(1000) });
		const remote = lore({ content: "remote", rev: rev(2000, "device-b") });
		expect(draftLoreSyncCodec.merge(local, remote).record.content).toBe(
			"remote",
		);
		expect(draftLoreSyncCodec.merge(remote, local).record.content).toBe(
			"remote",
		);
	});

	it("round-trips", () => {
		const source = lore({ constant: true, position: "system_top" });
		expect(
			draftLoreSyncCodec.decode({
				id: "lore-1",
				schemaVersion: AUTHORING_SCHEMA_VERSION,
				rev: source.rev,
				deletedAt: null,
				data: draftLoreSyncCodec.encode(source),
			}),
		).toEqual({ ...source, dirty: 0, serverVersion: 0 });
	});

	it("does not apply an unknown injection position", () => {
		const data = draftLoreSyncCodec.encode(lore()) as Record<string, unknown>;
		expect(
			draftLoreSyncCodec.decode({
				id: "lore-1",
				schemaVersion: 1,
				rev: rev(1),
				deletedAt: null,
				data: { ...data, position: "future-position" },
			}),
		).toBeNull();
	});
});

describe("managed asset codecs", () => {
	const stamp = (id: string) => ({
		id,
		now: "2026-01-01T00:00:00.000Z",
		rev: rev(1),
	});

	const image = createDraftRuntimeAssetRecord(
		{
			draftId: "draft-1",
			path: "characters/sena/smile",
			kind: "image",
			assetId: "media-A",
			mime: "image/webp",
			width: 640,
			height: 480,
		},
		stamp("asset-image"),
	);

	const audio = createDraftRuntimeAssetRecord(
		{
			draftId: "draft-1",
			path: "audio/bgm/main",
			kind: "audio",
			assetId: "media-B",
			mime: "audio/mpeg",
			durationMs: 102_000,
		},
		stamp("asset-audio"),
	);

	const roundTrip = (record: typeof image) =>
		draftRuntimeAssetSyncCodec.decode({
			id: record.id,
			schemaVersion: AUTHORING_SCHEMA_VERSION,
			rev: record.rev,
			deletedAt: null,
			data: draftRuntimeAssetSyncCodec.encode(record),
		});

	it("pictures round-trip", () => {
		expect(roundTrip(image)).toEqual({
			...image,
			dirty: 0,
			serverVersion: 0,
		});
	});

	it("sounds round-trip: duration stays and dimensions are empty", () => {
		expect(roundTrip(audio)).toEqual({
			...audio,
			dirty: 0,
			serverVersion: 0,
		});
	});

	/**
	 * This is the most expensive line in this file. Records synced before this axis existed have no
	 * `kind`. Making it required would fail decoding, and in this codec a failure means the asset
	 * never reaches this device. An image bound on the Mac would vanish on the phone, and the phone's
	 * next push would upload the draft without that asset.
	 */
	it("old envelopes (no kind) read as image", () => {
		const legacy = {
			draftId: "draft-1",
			path: "characters/sena/smile",
			assetId: "media-A",
			mime: "image/webp",
			width: 640,
			height: 480,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		const decoded = draftRuntimeAssetSyncCodec.decode({
			id: "asset-image",
			schemaVersion: AUTHORING_SCHEMA_VERSION,
			rev: rev(1),
			deletedAt: null,
			data: legacy,
		});
		expect(decoded?.kind).toBe("image");
		expect(decoded?.width).toBe(640);
		expect(decoded?.durationMs).toBeNull();
	});

	/**
	 * A combination we never create (audio with dimensions) is folded away. Storing it as is would
	 * make this device's list state a different fact, and the mismatch would only show up when two
	 * devices are compared side by side.
	 */
	it("cells that do not fit the kind are cleared", () => {
		const confused = {
			draftId: "draft-1",
			path: "audio/bgm/main",
			kind: "audio" as const,
			assetId: "media-B",
			mime: "audio/mpeg",
			width: 640,
			height: 480,
			durationMs: 1000,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		const decoded = draftRuntimeAssetSyncCodec.decode({
			id: "asset-audio",
			schemaVersion: AUTHORING_SCHEMA_VERSION,
			rev: rev(1),
			deletedAt: null,
			data: confused,
		});
		expect(decoded?.width).toBeNull();
		expect(decoded?.height).toBeNull();
		expect(decoded?.durationMs).toBe(1000);
	});

	/**
	 * An unknown kind is dropped, not folded into an image. Folding it into an image would later let a
	 * non-image take an image's slot.
	 */
	it("unknown kinds do not decode", () => {
		expect(
			draftRuntimeAssetSyncCodec.decode({
				id: "asset-x",
				schemaVersion: AUTHORING_SCHEMA_VERSION,
				rev: rev(1),
				deletedAt: null,
				data: {
					...(draftRuntimeAssetSyncCodec.encode(image) as object),
					kind: "video",
				},
			}),
		).toBeNull();
	});

	/**
	 * The kind is written for images too. Old-device records and new-device images must not end up
	 * with the same shape.
	 */
	it("encoding carries kind for pictures too", () => {
		expect(draftRuntimeAssetSyncCodec.encode(image)).toMatchObject({
			kind: "image",
		});
	});
});
