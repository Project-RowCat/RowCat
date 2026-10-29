import {
	type AuthoringStore,
	type CreateStoryDraftInput,
	compareDraftsByRecency,
	createDraftLoreEntryRecord,
	createDraftRuntimeAssetRecord,
	createDraftRuntimeFileRecord,
	createDraftRuntimeProjectRecord,
	createDraftSceneImageRecord,
	createDraftStartSceneRecord,
	createStoryDraftRecord,
	type DraftLoreEntry,
	type DraftLoreEntryPatch,
	type DraftRuntimeAsset,
	type DraftRuntimeAssetPatch,
	type DraftRuntimeFile,
	type DraftRuntimeFilePatch,
	type DraftRuntimeProject,
	type DraftSceneImage,
	type DraftSceneImagePatch,
	type DraftStartScene,
	type DraftStartScenePatch,
	defaultRuntimeStarter,
	isLiveRecord,
	markAuthoringDeleted,
	markAuthoringUpdate,
	markDraftFieldUpdate,
	markDraftPublished,
	type NewDraftLoreEntry,
	type NewDraftRuntimeAsset,
	type NewDraftSceneImage,
	type NewDraftStartScene,
	type RuntimeStarter,
	runtimeProjectIdFor,
	type StoryDraft,
	type StoryDraftPatch,
	type StoryPublicationSource,
	sortLore,
	sortRuntimeAssets,
	sortRuntimeFiles,
	sortSceneImages,
	sortStartScenes,
	touchDraftActivity,
} from "@rowcat/authoring";
import type { Rev } from "@rowcat/contracts/sync";
import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import type { Table } from "dexie";
import { newLocalId, nowIso } from "#/lib/local-data/clock.ts";
import type { LocalDb } from "#/lib/local-data/db.ts";
import { nextRev, nextRevs } from "#/lib/local-data/hlc.ts";

/**
 * IndexedDB implementation of `AuthoringStore`.
 *
 * The port's contract points that this file must honor directly:
 * - Deleted records are invisible. Deletes are soft, so rows remain (future sync must propagate
 *   the fact), and every query filters them out in this file. One missed query makes a deleted item
 *   look like it was not deleted.
 * - Multi-record changes are one transaction: reordering, draft deletion (with its children), and
 *   deleting the scene that is the default opening. Split apart, a crash can leave a half-reordered
 *   list, or a draft pointing at a scene that no longer exists.
 * - Sorting is stable. Equal order values still produce a fixed result (the comparison from
 *   @rowcat/authoring is used as-is).
 * - One revision per changed record. A transaction that edits several records (a child and its
 *   parent, or every reordered sibling) gives each its own revision, and the clock state that
 *   issued them is saved to `syncState` in the same transaction. So every write transaction also
 *   locks that table. Split apart, records would be saved while the clock stays unchanged, and the
 *   next write would issue the same revision again, making two versions indistinguishable.
 *
 * The rest is transcription of Dexie calls. If this file grows, rules have usually leaked in.
 * Validation, normalization, and publish assembly all live in the shared packages.
 */

/**
 * Index names used to scan child lists.
 *
 * Scanning by the compound index `[draftId+<order>]` returns a draft's children already sorted, so
 * nothing is sorted in memory. The result still passes through the comparison once more, because
 * the index does not break ties between items with the same order value, and the comparison makes
 * their order deterministic.
 */
const LORE_ORDER = "[draftId+positionIndex]";
const START_SCENE_ORDER = "[draftId+position]";
const SCENE_IMAGE_ORDER = "[draftId+position]";
/**
 * Only runtime files use a path as their order axis. The other three child types are ordered by the
 * author's position number, but in a code project the file order is already defined by path.
 * Scanning this index returns files in exactly the order the explorer draws them.
 */
const RUNTIME_FILE_ORDER = "[draftId+path]";
/**
 * Lookup axis for managed images. Same shape as files: a logical name is unique within its project.
 */
const RUNTIME_ASSET_ORDER = "[draftId+path]";

/**
 * Upper bound for 'all children of this draft' in a compound key.
 *
 * IndexedDB key order is number < date < string < binary < array. An empty array is therefore
 * larger than any number, so `[draftId, []]` sits above every `[draftId, <order value>]`. The lower
 * bound needs only `[draftId]`, because a shorter array precedes a longer one with the same prefix.
 *
 * `Dexie.minKey` and `maxKey` are not used, as in the chat store: some engines reject them as
 * components of a compound key (fake-indexeddb does). Relying on the key order rule behaves the
 * same in every engine.
 */
const MAX_COMPONENT: unknown[] = [];

/**
 * The shape children share: the minimum the shared helpers require.
 *
 * The three child types are described structurally rather than as a union, because the helpers
 * never inspect a child's content. They need only the parent, the deletion state, and the last-edit
 * time. Knowing more would leak domain rules into the storage helpers.
 */
interface AuthoringChild {
	id: string;
	draftId: string;
	deletedAt: string | null;
	updatedAt: string;
	dirty: 0 | 1;
	serverVersion: number;
	rev: Rev;
}

/** Fixes the issue order for multi-record edits: sorted by id, ascending. */
const byId = (a: { id: string }, b: { id: string }): number =>
	a.id < b.id ? -1 : 1;

export function createAuthoringStore(db: LocalDb): AuthoringStore {
	/**
	 * Returns a live draft. Call only inside a transaction.
	 *
	 * Never revives a deleted draft. Every path that adds a child goes through this function, so a
	 * child cannot attach to a draft another tab just deleted.
	 */
	async function liveDraft(id: string): Promise<StoryDraft | null> {
		const draft = await db.storyDrafts.get(id);
		return draft && isLiveRecord(draft) ? draft : null;
	}

	/** The full child list, excluding deleted items. If the parent was deleted, the list is empty. */
	async function liveChildren<T extends AuthoringChild>(
		table: Table<T, string>,
		index: string,
		draftId: string,
	): Promise<T[]> {
		if (!(await liveDraft(draftId))) return [];
		const rows = await table
			.where(index)
			.between([draftId], [draftId, MAX_COMPONENT])
			.toArray();
		return rows.filter(isLiveRecord);
	}

	/**
	 * Soft-deletes one child and touches the parent.
	 *
	 * The parent's modification time is bumped too. The draft list sorts by `updatedAt`, so editing
	 * only a child would leave the just-edited draft lower in the list. To the user, these two are one
	 * action.
	 *
	 * The parent receives an activity touch; group revisions stay as they are. Deleting a child does
	 * not change the draft's title or scenario, and bumping the groups here would make the next merge
	 * overwrite fields other devices edited without any real change.
	 */
	async function softDeleteChild<T extends AuthoringChild>(
		table: Table<T, string>,
		id: string,
	): Promise<void> {
		const current = await table.get(id);
		if (!current || !isLiveRecord(current)) return;
		const now = nowIso();
		const [childRev, parentRev] = await nextRevs(db, 2);
		await table.put(markAuthoringDeleted(current, now, childRev));
		await touchDraftInTx(current.draftId, now, parentRev);
	}

	/**
	 * Soft-deletes every child of one draft. Call only inside the parent's deletion transaction.
	 *
	 * Unlike chat, each child gets its own revision. Draft children number in the dozens, so per-child
	 * tombstones add no wire cost, and a receiving device that has not yet seen the parent's tombstone
	 * still deletes the children itself (§20.4). Chat message counts are a different scale, so chat
	 * made the opposite decision.
	 *
	 * Issue order is fixed by id. Relying on the order the store returns would make the same deletion
	 * produce different revision assignments on different engines, a difference that cannot be pinned
	 * down by tests.
	 */
	async function softDeleteChildrenOf<T extends AuthoringChild>(
		table: Table<T, string>,
		draftId: string,
		now: string,
	): Promise<void> {
		const rows = await table.where("draftId").equals(draftId).toArray();
		const children = rows.filter(isLiveRecord).sort(byId);
		if (children.length === 0) return;
		const revs = await nextRevs(db, children.length);
		await table.bulkPut(
			children.map((child, index) =>
				markAuthoringDeleted(child, now, revs[index]),
			),
		);
	}

	/**
	 * Bumps the draft's activity time. Call only inside an already-open transaction.
	 *
	 * Does nothing if the draft is missing or deleted. It must not revive one, because another tab may
	 * have cleaned it up.
	 */
	async function touchDraftInTx(
		draftId: string,
		now: string,
		rev: Rev,
	): Promise<void> {
		const draft = await liveDraft(draftId);
		if (!draft) return;
		await db.storyDrafts.put(touchDraftActivity(draft, now, rev));
	}

	/**
	 * Next position number, placing the item at the end of the list.
	 *
	 * Counts the positions of deleted items too (max + 1). Numbering by live count would reuse a
	 * deleted item's position, so a revived item (from future sync) and a new item would share a slot.
	 */
	async function nextPosition<T>(
		table: Table<T, string>,
		index: string,
		draftId: string,
		read: (row: T) => number,
	): Promise<number> {
		const rows = await table
			.where(index)
			.between([draftId], [draftId, MAX_COMPONENT])
			.toArray();
		return rows.reduce((max, row) => Math.max(max, read(row) + 1), 0);
	}

	/**
	 * Reorder: reassigns positions in the given order.
	 *
	 * Ids not in the list are ignored, and items missing from the given order stay at the end. The
	 * screen's list may differ from the store (another tab may have added one). Sorting what is known
	 * is better than failing outright, and the user's drag result is still reflected.
	 */
	async function reorderInTx<T extends AuthoringChild>(
		table: Table<T, string>,
		index: string,
		draftId: string,
		orderedIds: string[],
		write: (row: T, position: number) => T,
	): Promise<void> {
		const rows = await table
			.where(index)
			.between([draftId], [draftId, MAX_COMPONENT])
			.toArray();
		const lookup = new Map(rows.map((row) => [row.id, row]));
		const now = nowIso();

		/**
		 * Only live items are renumbered. Including deleted ones would leave their slots as gaps,
		 * creating invisible spacing between two items on screen.
		 */
		const live = rows.filter(isLiveRecord);
		const ordered = orderedIds
			.map((id) => lookup.get(id))
			.filter((row): row is T => row !== undefined && isLiveRecord(row));
		const rest = live.filter((row) => !ordered.includes(row));
		const result = [...ordered, ...rest];

		/**
		 * One revision per sibling, and one share for the parent at the end.
		 *
		 * Issue order is the result order. Relying on the order the store returned rows, or on Map
		 * iteration order, would make the same drag produce different revision assignments on each run,
		 * so two devices doing the same reorder would pick different winners. Siblings are separate
		 * records that sync independently, so they cannot share a revision.
		 */
		const revs = await nextRevs(db, result.length + 1);
		await table.bulkPut(
			result.map((row, position) =>
				markAuthoringUpdate(write(row, position), now, revs[position]),
			),
		);
		await touchDraftInTx(draftId, now, revs[result.length]);
	}

	return {
		async listDrafts(): Promise<StoryDraft[]> {
			/**
			 * Scans the index in reverse, with no in-memory sort. Drafts saved within the same millisecond
			 * need a deterministic order, so the comparison runs again after deleted items are filtered (the
			 * index does not break those ties).
			 */
			const rows = await db.storyDrafts
				.orderBy("updatedAt")
				.reverse()
				.toArray();
			return rows.filter(isLiveRecord).sort(compareDraftsByRecency);
		},

		getDraft: (id) => liveDraft(id),

		async createDraft(input?: CreateStoryDraftInput): Promise<StoryDraft> {
			return db.transaction("rw", [db.storyDrafts, db.syncState], async () => {
				const draft = createStoryDraftRecord(input, {
					id: newLocalId(),
					now: nowIso(),
					rev: await nextRev(db),
				});
				/**
				 * Uses `add`, not `put`. A freshly generated UUID that already exists is a bug, not a
				 * collision, and silently overwriting it would erase someone else's manuscript.
				 */
				await db.storyDrafts.add(draft);
				return draft;
			});
		},

		async updateDraft(
			id: string,
			patch: StoryDraftPatch,
		): Promise<StoryDraft | null> {
			return db.transaction("rw", [db.storyDrafts, db.syncState], async () => {
				const current = await liveDraft(id);
				// Never revives a deleted draft: autosave can arrive late, and that path really exists.
				if (!current) return null;
				/**
				 * Only the `fieldRev` of the groups the patch touches is bumped. A single table in
				 * @rowcat/authoring decides which field belongs to which group. If the store started
				 * making its own decisions, they would diverge from the screen's, and an edit saved without a
				 * group revision would be silently overwritten at the next merge.
				 */
				const next = markDraftFieldUpdate(
					current,
					patch,
					nowIso(),
					await nextRev(db),
				);
				await db.storyDrafts.put(next);
				return next;
			});
		},

		async deleteDraft(id: string): Promise<void> {
			/**
			 * Children are part of the same transaction. If only the parent were deleted and the process
			 * died, orphaned children would remain, and when sync is added later the receiving side could
			 * not tell which draft they belong to.
			 */
			await db.transaction(
				"rw",
				[
					db.storyDrafts,
					db.draftLoreEntries,
					db.draftStartScenes,
					db.draftSceneImages,
					db.draftRuntimeProjects,
					db.draftRuntimeFiles,
					db.draftRuntimeAssets,
					db.draftCovers,
					db.syncState,
				],
				async () => {
					const draft = await liveDraft(id);
					if (!draft) return;
					const now = nowIso();
					await db.storyDrafts.put(
						markAuthoringDeleted(draft, now, await nextRev(db)),
					);

					/**
					 * Each table is written separately. Putting them in an array and looping over it would give
					 * the two tables a combined union type, so `bulkPut` could not tell from the types which
					 * record it accepts, and a write to the wrong table would slip past the compiler.
					 */
					await softDeleteChildrenOf(db.draftLoreEntries, id, now);
					await softDeleteChildrenOf(db.draftStartScenes, id, now);
					/**
					 * Scene images also leave tombstones. The server's images are not deleted: what is removed is
					 * only this draft's use of that image under that word. The bytes may still be referenced by a
					 * published work's snapshot.
					 */
					await softDeleteChildrenOf(db.draftSceneImages, id, now);

					/**
					 * Runtime projects and their files are children too.
					 *
					 * The project row has the same shape as the other children, so it goes through the same helper
					 * even though a draft has only one. Writing `get` and `put` by hand here would leave this spot
					 * in a different shape the day another child type is added (the conversation summary made the
					 * same decision for the same reason).
					 */
					await softDeleteChildrenOf(db.draftRuntimeProjects, id, now);
					await softDeleteChildrenOf(db.draftRuntimeFiles, id, now);
					/**
					 * Managed images also leave tombstones. The server's images are not deleted. Same rule as
					 * scene images: only this draft's use of the image under its logical name is removed, and the
					 * bytes may still be referenced by a published work's snapshot.
					 */
					await softDeleteChildrenOf(db.draftRuntimeAssets, id, now);

					/**
					 * Pre-publish covers are hard-deleted. They are the only child that differs from the two
					 * above.
					 *
					 * There is no tombstone because nothing reads one. This table does not sync
					 * (`draft-cover.ts`), so there is no device to tell about the deletion. Keeping a tombstone
					 * would leave image bytes on the device forever that nobody reads. Keeping the cover of a
					 * manuscript the user deleted is not a saving.
					 */
					await db.draftCovers.delete(id);
				},
			);
		},

		listLore: async (draftId) =>
			sortLore(await liveChildren(db.draftLoreEntries, LORE_ORDER, draftId)),

		async createLore(
			draftId: string,
			input?: NewDraftLoreEntry,
		): Promise<DraftLoreEntry> {
			return db.transaction(
				"rw",
				[db.storyDrafts, db.draftLoreEntries, db.syncState],
				async () => {
					const now = nowIso();
					const positionIndex = await nextPosition(
						db.draftLoreEntries,
						LORE_ORDER,
						draftId,
						(row) => row.positionIndex,
					);
					const [childRev, parentRev] = await nextRevs(db, 2);
					const entry = createDraftLoreEntryRecord(
						{ ...input, draftId, positionIndex },
						{ id: newLocalId(), now, rev: childRev },
					);
					await db.draftLoreEntries.add(entry);
					await touchDraftInTx(draftId, now, parentRev);
					return entry;
				},
			);
		},

		async updateLore(id: string, patch: DraftLoreEntryPatch): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftLoreEntries, db.syncState],
				async () => {
					const current = await db.draftLoreEntries.get(id);
					if (!current || !isLiveRecord(current)) return;
					const now = nowIso();
					const [childRev, parentRev] = await nextRevs(db, 2);
					await db.draftLoreEntries.put(
						markAuthoringUpdate({ ...current, ...patch }, now, childRev),
					);
					await touchDraftInTx(current.draftId, now, parentRev);
				},
			);
		},

		async deleteLore(id: string): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftLoreEntries, db.syncState],
				() => softDeleteChild(db.draftLoreEntries, id),
			);
		},

		async reorderLore(draftId: string, orderedIds: string[]): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftLoreEntries, db.syncState],
				() =>
					reorderInTx(
						db.draftLoreEntries,
						LORE_ORDER,
						draftId,
						orderedIds,
						(row, positionIndex) => ({ ...row, positionIndex }),
					),
			);
		},

		listStartScenes: async (draftId) =>
			sortStartScenes(
				await liveChildren(db.draftStartScenes, START_SCENE_ORDER, draftId),
			),

		async createStartScene(
			draftId: string,
			input?: NewDraftStartScene,
		): Promise<DraftStartScene> {
			return db.transaction(
				"rw",
				[db.storyDrafts, db.draftStartScenes, db.syncState],
				async () => {
					const now = nowIso();
					const position = await nextPosition(
						db.draftStartScenes,
						START_SCENE_ORDER,
						draftId,
						(row) => row.position,
					);
					const [childRev, parentRev] = await nextRevs(db, 2);
					const scene = createDraftStartSceneRecord(
						{ ...input, draftId, position },
						{ id: newLocalId(), now, rev: childRev },
					);
					await db.draftStartScenes.add(scene);
					/**
					 * The first scene immediately becomes the default opening. If left empty, an author who made
					 * only one scene would have to choose which one opens, but with one option that choice carries
					 * no information.
					 *
					 * In that case the parent receives not an activity touch but an update to the `defaults`
					 * group, because an authored field of the draft actually changed.
					 */
					const draft = await liveDraft(draftId);
					if (draft && draft.defaultStartSceneId === null)
						await db.storyDrafts.put(
							markDraftFieldUpdate(
								draft,
								{ defaultStartSceneId: scene.id },
								now,
								parentRev,
							),
						);
					else await touchDraftInTx(draftId, now, parentRev);
					return scene;
				},
			);
		},

		async updateStartScene(
			id: string,
			patch: DraftStartScenePatch,
		): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftStartScenes, db.syncState],
				async () => {
					const current = await db.draftStartScenes.get(id);
					if (!current || !isLiveRecord(current)) return;
					const now = nowIso();
					const [childRev, parentRev] = await nextRevs(db, 2);
					await db.draftStartScenes.put(
						markAuthoringUpdate({ ...current, ...patch }, now, childRev),
					);
					await touchDraftInTx(current.draftId, now, parentRev);
				},
			);
		},

		async deleteStartScene(id: string): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftStartScenes, db.syncState],
				async () => {
					const current = await db.draftStartScenes.get(id);
					if (!current || !isLiveRecord(current)) return;
					const { draftId } = current;
					const now = nowIso();
					const [sceneRev, parentRev] = await nextRevs(db, 2);
					await db.draftStartScenes.put(
						markAuthoringDeleted(current, now, sceneRev),
					);

					const draft = await liveDraft(draftId);
					if (!draft) return;
					/**
					 * When the deleted scene was the default opening, the selection moves in the same transaction.
					 *
					 * It moves to the first remaining scene rather than being cleared. That matches the
					 * assembler's fallback, so the publish result does not change (it uses the first scene), and
					 * no dangling pointer remains in the draft. If it were cleared, the screen would show `please choose`
					 * (please choose), but the user only deleted a scene and never cancelled the selection.
					 */
					if (draft.defaultStartSceneId !== id) {
						await db.storyDrafts.put(touchDraftActivity(draft, now, parentRev));
						return;
					}
					const remaining = sortStartScenes(
						await liveChildren(db.draftStartScenes, START_SCENE_ORDER, draftId),
					);
					await db.storyDrafts.put(
						markDraftFieldUpdate(
							draft,
							{ defaultStartSceneId: remaining[0]?.id ?? null },
							now,
							parentRev,
						),
					);
				},
			);
		},

		async reorderStartScenes(
			draftId: string,
			orderedIds: string[],
		): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftStartScenes, db.syncState],
				() =>
					reorderInTx(
						db.draftStartScenes,
						START_SCENE_ORDER,
						draftId,
						orderedIds,
						(row, position) => ({ ...row, position }),
					),
			);
		},

		async setDefaultStartScene(
			draftId: string,
			sceneId: string | null,
		): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftStartScenes, db.syncState],
				async () => {
					const draft = await liveDraft(draftId);
					if (!draft) return;
					/**
					 * Prevents pointing at another author's draft or at an already-deleted scene. The screen sends
					 * this value, but it may be showing a list from a few seconds ago. Making a scene that no
					 * longer exists the default would surface the mismatch only at the next publish.
					 */
					if (sceneId !== null) {
						const scene = await db.draftStartScenes.get(sceneId);
						if (!scene || !isLiveRecord(scene) || scene.draftId !== draftId)
							return;
					}
					await db.storyDrafts.put(
						markDraftFieldUpdate(
							draft,
							{ defaultStartSceneId: sceneId },
							nowIso(),
							await nextRev(db),
						),
					);
				},
			);
		},

		listSceneImages: async (draftId) =>
			sortSceneImages(
				await liveChildren(db.draftSceneImages, SCENE_IMAGE_ORDER, draftId),
			),

		async createSceneImage(
			draftId: string,
			input?: NewDraftSceneImage,
		): Promise<DraftSceneImage> {
			return db.transaction(
				"rw",
				[db.storyDrafts, db.draftSceneImages, db.syncState],
				async () => {
					const now = nowIso();
					const position = await nextPosition(
						db.draftSceneImages,
						SCENE_IMAGE_ORDER,
						draftId,
						(row) => row.position,
					);
					const [childRev, parentRev] = await nextRevs(db, 2);
					const image = createDraftSceneImageRecord(
						{ ...input, draftId, position },
						{ id: newLocalId(), now, rev: childRev },
					);
					await db.draftSceneImages.add(image);
					/**
					 * The parent receives an activity touch. Attaching one image does not change the draft's
					 * authored fields. This differs from the start scene, where the first scene fills
					 * `defaultStartSceneId`. Here there is no place in the draft root that such an image would
					 * point to.
					 */
					await touchDraftInTx(draftId, now, parentRev);
					return image;
				},
			);
		},

		async updateSceneImage(
			id: string,
			patch: DraftSceneImagePatch,
		): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftSceneImages, db.syncState],
				async () => {
					const current = await db.draftSceneImages.get(id);
					if (!current || !isLiveRecord(current)) return;
					const now = nowIso();
					const [childRev, parentRev] = await nextRevs(db, 2);
					await db.draftSceneImages.put(
						markAuthoringUpdate({ ...current, ...patch }, now, childRev),
					);
					await touchDraftInTx(current.draftId, now, parentRev);
				},
			);
		},

		async deleteSceneImage(id: string): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftSceneImages, db.syncState],
				() => softDeleteChild(db.draftSceneImages, id),
			);
		},

		/**
		 * A project: if the draft has been deleted, it is treated as absent.
		 *
		 * Reads directly by the derived primary key (`runtimeProjectIdFor`). Scanning the `draftId` index
		 * would give the same result, but that path has the shape of 'several per draft is possible', and
		 * someday code may be written that way.
		 */
		async getRuntimeProject(
			draftId: string,
		): Promise<DraftRuntimeProject | null> {
			return db.transaction(
				"r",
				[db.storyDrafts, db.draftRuntimeProjects],
				async () => {
					if (!(await liveDraft(draftId))) return null;
					const project = await db.draftRuntimeProjects.get(
						runtimeProjectIdFor(draftId),
					);
					return project && isLiveRecord(project) ? project : null;
				},
			);
		},

		async enableRuntime(
			draftId: string,
			starter?: RuntimeStarter,
		): Promise<DraftRuntimeProject | null> {
			/**
			 * The project row and the starter files are one transaction. If they were split, a committed
			 * project could exist with no files, and anyone opening that draft would see an empty explorer.
			 * The studio cannot repair that state on its own: since it cannot be re-enabled, the moment that
			 * would create the starter files never comes.
			 */
			return db.transaction(
				"rw",
				[
					db.storyDrafts,
					db.draftRuntimeProjects,
					db.draftRuntimeFiles,
					db.syncState,
				],
				async () => {
					const draft = await liveDraft(draftId);
					if (!draft) return null;

					/**
					 * A path where no template is chosen falls back to the default template. The default is not
					 * decided here; it is delegated to the registry, because there must be exactly one source for
					 * the starter file.
					 */
					const plan = starter ?? defaultRuntimeStarter();

					const id = runtimeProjectIdFor(draftId);
					const now = nowIso();
					const existing = await db.draftRuntimeProjects.get(id);

					/**
					 * If the project already exists, this only enables it. A revival (a row with a tombstone)
					 * takes the same path too. Creating a new record there would overwrite a row with the same
					 * identity and shift `createdAt`, and that value is already on other devices.
					 */
					const project =
						existing && isLiveRecord(existing)
							? markAuthoringUpdate(
									{ ...existing, enabled: true },
									now,
									await nextRev(db),
								)
							: createDraftRuntimeProjectRecord(
									{ draftId, entry: plan.entry },
									{ now, rev: await nextRev(db) },
								);
					await db.draftRuntimeProjects.put(project);

					/**
					 * If any file exists, nothing is created.
					 *
					 * If turning the project off and on again added a set of starter files each time, the user's
					 * `src/main.tsx` would be overwritten on the second enable. Even when paths do not collide,
					 * the same files would pile up on every enable.
					 */
					const present = await liveChildren(
						db.draftRuntimeFiles,
						RUNTIME_FILE_ORDER,
						draftId,
					);
					if (present.length === 0) {
						const revs = await nextRevs(db, plan.files.length);
						await db.draftRuntimeFiles.bulkAdd(
							plan.files.map((file, index) =>
								createDraftRuntimeFileRecord(
									{ draftId, path: file.path, content: file.content },
									{ id: newLocalId(), now, rev: revs[index] },
								),
							),
						);
					}

					await touchDraftInTx(draftId, now, await nextRev(db));
					return project;
				},
			);
		},

		async setRuntimeEnabled(
			draftId: string,
			enabled: boolean,
		): Promise<DraftRuntimeProject | null> {
			return db.transaction(
				"rw",
				[db.storyDrafts, db.draftRuntimeProjects, db.syncState],
				async () => {
					const draft = await liveDraft(draftId);
					if (!draft) return null;
					const current = await db.draftRuntimeProjects.get(
						runtimeProjectIdFor(draftId),
					);
					// Does not enable through this path a draft that was never enabled. The starter files must
					// come with it.
					if (!current || !isLiveRecord(current)) return null;

					const now = nowIso();
					const [projectRev, parentRev] = await nextRevs(db, 2);
					/**
					 * Does not touch the files. Merging turn-off and delete into one operation would turn the
					 * common intent 'I'll set this aside for a while' into deleting the manuscript.
					 */
					const next = markAuthoringUpdate(
						{ ...current, enabled },
						now,
						projectRev,
					);
					await db.draftRuntimeProjects.put(next);
					await touchDraftInTx(draftId, now, parentRev);
					return next;
				},
			);
		},

		listRuntimeFiles: async (draftId) =>
			sortRuntimeFiles(
				await liveChildren(db.draftRuntimeFiles, RUNTIME_FILE_ORDER, draftId),
			),

		async createRuntimeFile(
			draftId: string,
			input: { path: string; content?: string },
		): Promise<DraftRuntimeFile | null> {
			return db.transaction(
				"rw",
				[db.storyDrafts, db.draftRuntimeFiles, db.syncState],
				async () => {
					if (!(await liveDraft(draftId))) return null;

					/**
					 * Blocks duplicates here once more.
					 *
					 * The caller already filtered them with `planRuntimeFileCreate`, but that check is about the
					 * list the screen holds. Another tab may have created the same path in the meantime. If both
					 * are created silently, two identically named entries appear in the explorer and there is no
					 * way to tell which one opens.
					 */
					const present = await liveChildren(
						db.draftRuntimeFiles,
						RUNTIME_FILE_ORDER,
						draftId,
					);
					if (present.some((file) => file.path === input.path)) return null;

					const now = nowIso();
					const [childRev, parentRev] = await nextRevs(db, 2);
					const file = createDraftRuntimeFileRecord(
						{ draftId, path: input.path, content: input.content },
						{ id: newLocalId(), now, rev: childRev },
					);
					await db.draftRuntimeFiles.add(file);
					/**
					 * The parent receives an activity touch. Adding a file does not change the draft's authored
					 * fields (the same judgment as for scene images).
					 */
					await touchDraftInTx(draftId, now, parentRev);
					return file;
				},
			);
		},

		async updateRuntimeFile(
			id: string,
			patch: DraftRuntimeFilePatch,
		): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftRuntimeFiles, db.syncState],
				async () => {
					const current = await db.draftRuntimeFiles.get(id);
					if (!current || !isLiveRecord(current)) return;

					/**
					 * Patches that change the path are also checked for duplicates. Renaming is a path change, so
					 * it carries the same race as creation. An item is never a duplicate of itself.
					 */
					if (patch.path !== undefined && patch.path !== current.path) {
						const siblings = await liveChildren(
							db.draftRuntimeFiles,
							RUNTIME_FILE_ORDER,
							current.draftId,
						);
						if (
							siblings.some(
								(file) => file.id !== id && file.path === patch.path,
							)
						)
							return;
					}

					const now = nowIso();
					const [childRev, parentRev] = await nextRevs(db, 2);
					await db.draftRuntimeFiles.put(
						markAuthoringUpdate({ ...current, ...patch }, now, childRev),
					);
					await touchDraftInTx(current.draftId, now, parentRev);
				},
			);
		},

		async deleteRuntimeFile(id: string): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftRuntimeFiles, db.syncState],
				() => softDeleteChild(db.draftRuntimeFiles, id),
			);
		},

		listRuntimeAssets: async (draftId) =>
			sortRuntimeAssets(
				await liveChildren(db.draftRuntimeAssets, RUNTIME_ASSET_ORDER, draftId),
			),

		async createRuntimeAsset(
			draftId: string,
			input: NewDraftRuntimeAsset,
		): Promise<DraftRuntimeAsset | null> {
			return db.transaction(
				"rw",
				[db.storyDrafts, db.draftRuntimeAssets, db.syncState],
				async () => {
					if (!(await liveDraft(draftId))) return null;

					/**
					 * Blocks duplicates here once more, for the same reason as files. The caller already filtered
					 * them, but that check is about the list the screen holds, and another tab may claim the same
					 * name in the meantime. If both are created silently, `asset("characters/sena/smile")` cannot
					 * say which image it refers to.
					 */
					const present = await liveChildren(
						db.draftRuntimeAssets,
						RUNTIME_ASSET_ORDER,
						draftId,
					);
					if (present.some((asset) => asset.path === input.path)) return null;

					const now = nowIso();
					const [childRev, parentRev] = await nextRevs(db, 2);
					const asset = createDraftRuntimeAssetRecord(
						{ draftId, ...input },
						{ id: newLocalId(), now, rev: childRev },
					);
					await db.draftRuntimeAssets.add(asset);
					/** The parent receives an activity touch. The authored fields have not changed. */
					await touchDraftInTx(draftId, now, parentRev);
					return asset;
				},
			);
		},

		async updateRuntimeAsset(
			id: string,
			patch: DraftRuntimeAssetPatch,
		): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftRuntimeAssets, db.syncState],
				async () => {
					const current = await db.draftRuntimeAssets.get(id);
					if (!current || !isLiveRecord(current)) return;

					/**
					 * Patches that rename are checked for duplicates too. An item is never a duplicate of itself.
					 */
					if (patch.path !== undefined && patch.path !== current.path) {
						const siblings = await liveChildren(
							db.draftRuntimeAssets,
							RUNTIME_ASSET_ORDER,
							current.draftId,
						);
						if (
							siblings.some(
								(asset) => asset.id !== id && asset.path === patch.path,
							)
						)
							return;
					}

					const now = nowIso();
					const [childRev, parentRev] = await nextRevs(db, 2);
					await db.draftRuntimeAssets.put(
						markAuthoringUpdate({ ...current, ...patch }, now, childRev),
					);
					await touchDraftInTx(current.draftId, now, parentRev);
				},
			);
		},

		async deleteRuntimeAsset(id: string): Promise<void> {
			await db.transaction(
				"rw",
				[db.storyDrafts, db.draftRuntimeAssets, db.syncState],
				() => softDeleteChild(db.draftRuntimeAssets, id),
			);
		},

		async loadPublicationSource(
			draftId: string,
		): Promise<StoryPublicationSource | null> {
			/**
			 * Reads the three tables in one read transaction. Reading them separately can produce a mix with
			 * an autosave in between: the prompt is then the new version while the lore is the old one, and
			 * that mixed snapshot gets published.
			 */
			return db.transaction(
				"r",
				[
					db.storyDrafts,
					db.draftLoreEntries,
					db.draftStartScenes,
					db.draftSceneImages,
					db.draftRuntimeProjects,
					db.draftRuntimeFiles,
					db.draftRuntimeAssets,
				],
				async () => {
					const draft = await liveDraft(draftId);
					if (!draft) return null;
					return {
						draft,
						lore: sortLore(
							await liveChildren(db.draftLoreEntries, LORE_ORDER, draftId),
						),
						startScenes: sortStartScenes(
							await liveChildren(
								db.draftStartScenes,
								START_SCENE_ORDER,
								draftId,
							),
						),
						sceneImages: sortSceneImages(
							await liveChildren(
								db.draftSceneImages,
								SCENE_IMAGE_ORDER,
								draftId,
							),
						),
						/**
						 * Runtime comes from the same read. Reading separately lets an autosave slip in between,
						 * producing a publish with new body text but old code, a mismatch the author would only
						 * notice after publishing.
						 *
						 * If there is no project, `project` is `null`, and normalization folds that into an explicit
						 * disabled state. The field itself is not omitted: this repository is a client that knows the
						 * runtime axis, so silence (`undefined`) would belong to an old client, not to this one.
						 */
						runtime: {
							project:
								(await db.draftRuntimeProjects.get(
									runtimeProjectIdFor(draftId),
								)) ?? null,
							files: await liveChildren(
								db.draftRuntimeFiles,
								RUNTIME_FILE_ORDER,
								draftId,
							),
							/**
							 * Managed images come from the same read. Reading separately lets an autosave slip in,
							 * producing a publish with new code but the previous image list. The symptom of that
							 * mismatch is a placeholder, which the author only sees after publishing.
							 */
							assets: await liveChildren(
								db.draftRuntimeAssets,
								RUNTIME_ASSET_ORDER,
								draftId,
							),
							/**
							 * The language-contract version that this device's editor was written against. The authoring
							 * package does not know this constant (layering), so it is passed in here at the assembly
							 * point. Both apps read one constant, so no copy is made.
							 */
							apiVersion: RUNTIME_API_VERSION,
						},
					};
				},
			);
		},

		async markPublished(
			draftId: string,
			publishedStoryId: string,
		): Promise<StoryDraft | null> {
			return db.transaction("rw", [db.storyDrafts, db.syncState], async () => {
				const draft = await liveDraft(draftId);
				if (!draft) return null;
				/**
				 * Only the `publication` group is bumped. Publishing is a server action, but its result,
				 * `publishedStoryId`, is local authored data. Bumping other groups would push this device's
				 * title and scenario ahead of newer edits made on other devices.
				 */
				const next = markDraftPublished(
					draft,
					publishedStoryId,
					nowIso(),
					await nextRev(db),
				);
				await db.storyDrafts.put(next);
				return next;
			});
		},
	};
}
