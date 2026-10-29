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
import { newLocalId, nowIso } from "./clock.ts";
import { nextRev, nextRevs } from "./hlc.ts";
import type { MobileDatabase, SqlRunner } from "./sqlite.ts";
import {
	authoringDraftTable,
	authoringLoreTable,
	authoringRuntimeAssetTable,
	authoringRuntimeFileTable,
	authoringRuntimeProjectTable,
	authoringSceneImageTable,
	authoringSceneTable,
	type RecordTable,
	type SqlRow,
} from "./tables.ts";

/**
 * The SQLite implementation of `AuthoringStore` — **the same contract and the same transactions**
 * as the web's Dexie version.
 *
 * The three children (characters, lore, start scenes) differ only in the name of their order
 * column, so like the web they sit on three copies of shared helpers. What those helpers guarantee
 * is this file's real contract:
 *
 * ```text
 * editing a child also bumps the parent's activity time, in the same transaction
 * reordering is one transaction — split, two items can end up holding the same slot
 * deleting a draft deletes its children in the same transaction
 * ```
 *
 * Deleting a draft's children differs from the conversation cascade. A room's children receive only
 * `deletedAt` (the room's one tombstone stands in for them), while a draft's children each receive
 * `markAuthoringDeleted` with their own revision and dirty flag. The web does this, and "tidying"
 * the asymmetry here would make the two adapters push different things to the server.
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

const byId = (a: { id: string }, b: { id: string }): number =>
	a.id < b.id ? -1 : 1;

export function createAuthoringStore(db: MobileDatabase): AuthoringStore {
	const readDraft = async (
		tx: SqlRunner,
		id: string,
	): Promise<StoryDraft | null> => {
		const row = await tx.first<SqlRow>(
			"SELECT * FROM authoring_draft WHERE id = ?",
			[id],
		);
		return row ? authoringDraftTable.fromRow(row) : null;
	};

	const liveDraft = async (
		tx: SqlRunner,
		id: string,
	): Promise<StoryDraft | null> => {
		const draft = await readDraft(tx, id);
		return draft && isLiveRecord(draft) ? draft : null;
	};

	const readChild = async <T extends AuthoringChild>(
		tx: SqlRunner,
		table: RecordTable,
		id: string,
	): Promise<T | null> => {
		const row = await tx.first<SqlRow>(
			`SELECT * FROM ${table.table} WHERE id = ?`,
			[id],
		);
		return row ? (table.fromRow(row) as unknown as T) : null;
	};

	/**
	 * Every child of this draft, tombstones included, in a stable order.
	 *
	 * One child has no order column (the runtime project — one per draft, so it has no siblings). In
	 * that case the clause is not generated at all: `ORDER BY null` is accepted by SQLite but **lies
	 * to the reader**, who would take it as a column that might be filled in later. An id alone makes
	 * the order deterministic.
	 */
	const allChildren = async <T extends AuthoringChild>(
		tx: SqlRunner,
		table: RecordTable,
		draftId: string,
	): Promise<T[]> => {
		const order = table.order ? `${table.order} ASC, id ASC` : "id ASC";
		const rows = await tx.all<SqlRow>(
			`SELECT * FROM ${table.table} WHERE draft_id = ?
			 ORDER BY ${order}`,
			[draftId],
		);
		return rows.map((row) => table.fromRow(row) as unknown as T);
	};

	/** Live children — **children of a deleted draft are never returned.** */
	const liveChildren = async <T extends AuthoringChild>(
		tx: SqlRunner,
		table: RecordTable,
		draftId: string,
	): Promise<T[]> => {
		if (!(await liveDraft(tx, draftId))) return [];
		return (await allChildren<T>(tx, table, draftId)).filter(isLiveRecord);
	};

	const touchDraftInTx = async (
		tx: SqlRunner,
		draftId: string,
		now: string,
		rev: Rev,
	): Promise<void> => {
		const draft = await liveDraft(tx, draftId);
		if (!draft) return;
		await authoringDraftTable.upsert(tx, touchDraftActivity(draft, now, rev));
	};

	const softDeleteChild = async (
		tx: SqlRunner,
		table: RecordTable,
		id: string,
	): Promise<void> => {
		const current = await readChild(tx, table, id);
		if (!current || !isLiveRecord(current)) return;
		const now = nowIso();
		const [childRev, parentRev] = await nextRevs(tx, 2);
		await table.upsert(tx, markAuthoringDeleted(current, now, childRev));
		await touchDraftInTx(tx, current.draftId, now, parentRev);
	};

	const softDeleteChildrenOf = async (
		tx: SqlRunner,
		table: RecordTable,
		draftId: string,
		now: string,
	): Promise<void> => {
		const children = (await allChildren(tx, table, draftId))
			.filter(isLiveRecord)
			.sort(byId);
		if (children.length === 0) return;
		const revs = await nextRevs(tx, children.length);
		for (const [index, child] of children.entries())
			await table.upsert(tx, markAuthoringDeleted(child, now, revs[index]));
	};

	/**
	 * Next slot — **counts tombstones too.**
	 *
	 * Looking only at live children would reuse the number of a deleted slot, and another device that
	 * does not yet know about the deletion would create its own child in that same slot. The web scans
	 * everything for the same reason.
	 */
	const nextPosition = async (
		tx: SqlRunner,
		table: RecordTable,
		draftId: string,
	): Promise<number> => {
		const row = await tx.first<{ next: number | null }>(
			`SELECT MAX(${table.order}) + 1 AS next FROM ${table.table} WHERE draft_id = ?`,
			[draftId],
		);
		return Math.max(0, row?.next ?? 0);
	};

	/**
	 * Reorder — ids not in the list are ignored, and items missing from the list stay at the end.
	 *
	 * The list the screen was looking at may differ from the store (one item was added on another
	 * device). In that case it is better to sort what is known than to fail the reorder — the order
	 * the user dragged into place is still reflected.
	 */
	const reorderInTx = async <T extends AuthoringChild>(
		tx: SqlRunner,
		table: RecordTable,
		draftId: string,
		orderedIds: string[],
		write: (row: T, position: number) => T,
	): Promise<void> => {
		const rows = await allChildren<T>(tx, table, draftId);
		const lookup = new Map(rows.map((row) => [row.id, row]));
		const now = nowIso();
		const live = rows.filter(isLiveRecord);
		const ordered = orderedIds
			.map((id) => lookup.get(id))
			.filter((row): row is T => row !== undefined && isLiveRecord(row));
		const rest = live.filter((row) => !ordered.includes(row));
		const result = [...ordered, ...rest];
		const revs = await nextRevs(tx, result.length + 1);
		for (const [position, row] of result.entries())
			await table.upsert(
				tx,
				markAuthoringUpdate(write(row, position), now, revs[position]),
			);
		await touchDraftInTx(tx, draftId, now, revs[result.length]);
	};

	return {
		/* ── Drafts ── */

		async listDrafts(): Promise<StoryDraft[]> {
			const rows = await db.all<SqlRow>(
				`SELECT * FROM authoring_draft WHERE deleted_at IS NULL
				 ORDER BY updated_at DESC, id DESC`,
			);
			return rows.map(authoringDraftTable.fromRow).sort(compareDraftsByRecency);
		},

		getDraft: (id) => liveDraft(db, id),

		createDraft: (input?: CreateStoryDraftInput): Promise<StoryDraft> =>
			db.transaction(async (tx) => {
				const draft = createStoryDraftRecord(input, {
					id: newLocalId(),
					now: nowIso(),
					rev: await nextRev(tx),
				});
				await authoringDraftTable.upsert(tx, draft);
				return draft;
			}),

		updateDraft: (
			id: string,
			patch: StoryDraftPatch,
		): Promise<StoryDraft | null> =>
			db.transaction(async (tx) => {
				const current = await liveDraft(tx, id);
				if (!current) return null;
				const next = markDraftFieldUpdate(
					current,
					patch,
					nowIso(),
					await nextRev(tx),
				);
				await authoringDraftTable.upsert(tx, next);
				return next;
			}),

		async deleteDraft(id: string): Promise<void> {
			await db.transaction(async (tx) => {
				const draft = await liveDraft(tx, id);
				if (!draft) return;
				const now = nowIso();
				await authoringDraftTable.upsert(
					tx,
					markAuthoringDeleted(draft, now, await nextRev(tx)),
				);
				await softDeleteChildrenOf(tx, authoringLoreTable, id, now);
				await softDeleteChildrenOf(tx, authoringSceneTable, id, now);
				/**
				 * Scene images also receive tombstones — **the server's pictures are not deleted.** Only the
				 * fact that this draft called those pictures is removed (the web made the same decision).
				 */
				await softDeleteChildrenOf(tx, authoringSceneImageTable, id, now);
				/**
				 * The runtime project and its files are children too — **even the one project per draft goes
				 * through the same helper.** Writing this out by hand here would leave this spot shaped
				 * differently the day a child is added.
				 */
				await softDeleteChildrenOf(tx, authoringRuntimeProjectTable, id, now);
				await softDeleteChildrenOf(tx, authoringRuntimeFileTable, id, now);
				/**
				 * Managed assets are children too — **the server's pictures are not deleted.** Only the fact
				 * that this draft called that picture by that logical name is removed; the bytes may still be
				 * pointed at by an already-published snapshot.
				 */
				await softDeleteChildrenOf(tx, authoringRuntimeAssetTable, id, now);
			});
		},

		/* ── Lore ── */

		listLore: async (draftId) =>
			sortLore(
				await liveChildren<DraftLoreEntry>(db, authoringLoreTable, draftId),
			),

		createLore: (
			draftId: string,
			input?: NewDraftLoreEntry,
		): Promise<DraftLoreEntry> =>
			db.transaction(async (tx) => {
				const now = nowIso();
				const positionIndex = await nextPosition(
					tx,
					authoringLoreTable,
					draftId,
				);
				const [childRev, parentRev] = await nextRevs(tx, 2);
				const entry = createDraftLoreEntryRecord(
					{ ...input, draftId, positionIndex },
					{ id: newLocalId(), now, rev: childRev },
				);
				await authoringLoreTable.upsert(tx, entry);
				await touchDraftInTx(tx, draftId, now, parentRev);
				return entry;
			}),

		async updateLore(id: string, patch: DraftLoreEntryPatch): Promise<void> {
			await db.transaction(async (tx) => {
				const current = await readChild<DraftLoreEntry>(
					tx,
					authoringLoreTable,
					id,
				);
				if (!current || !isLiveRecord(current)) return;
				const now = nowIso();
				const [childRev, parentRev] = await nextRevs(tx, 2);
				await authoringLoreTable.upsert(
					tx,
					markAuthoringUpdate({ ...current, ...patch }, now, childRev),
				);
				await touchDraftInTx(tx, current.draftId, now, parentRev);
			});
		},

		async deleteLore(id: string): Promise<void> {
			await db.transaction((tx) => softDeleteChild(tx, authoringLoreTable, id));
		},

		async reorderLore(draftId: string, orderedIds: string[]): Promise<void> {
			await db.transaction((tx) =>
				reorderInTx<DraftLoreEntry>(
					tx,
					authoringLoreTable,
					draftId,
					orderedIds,
					(row, positionIndex) => ({ ...row, positionIndex }),
				),
			);
		},

		/* ── Start scenes ── */

		listStartScenes: async (draftId) =>
			sortStartScenes(
				await liveChildren<DraftStartScene>(db, authoringSceneTable, draftId),
			),

		/**
		 * The first scene **becomes the default opening.**
		 *
		 * If a draft that has not chosen anything yet gets a scene, that scene is the opening. Leaving it
		 * unchosen would show "pick one" in the editor, and on a screen where there is only one thing to
		 * pick, that is not something the user needs to do.
		 */
		createStartScene: (
			draftId: string,
			input?: NewDraftStartScene,
		): Promise<DraftStartScene> =>
			db.transaction(async (tx) => {
				const now = nowIso();
				const position = await nextPosition(tx, authoringSceneTable, draftId);
				const [childRev, parentRev] = await nextRevs(tx, 2);
				const scene = createDraftStartSceneRecord(
					{ ...input, draftId, position },
					{ id: newLocalId(), now, rev: childRev },
				);
				await authoringSceneTable.upsert(tx, scene);
				const draft = await liveDraft(tx, draftId);
				if (draft && draft.defaultStartSceneId === null)
					await authoringDraftTable.upsert(
						tx,
						markDraftFieldUpdate(
							draft,
							{ defaultStartSceneId: scene.id },
							now,
							parentRev,
						),
					);
				else await touchDraftInTx(tx, draftId, now, parentRev);
				return scene;
			}),

		async updateStartScene(
			id: string,
			patch: DraftStartScenePatch,
		): Promise<void> {
			await db.transaction(async (tx) => {
				const current = await readChild<DraftStartScene>(
					tx,
					authoringSceneTable,
					id,
				);
				if (!current || !isLiveRecord(current)) return;
				const now = nowIso();
				const [childRev, parentRev] = await nextRevs(tx, 2);
				await authoringSceneTable.upsert(
					tx,
					markAuthoringUpdate({ ...current, ...patch }, now, childRev),
				);
				await touchDraftInTx(tx, current.draftId, now, parentRev);
			});
		},

		/**
		 * Deleting a scene — if it was the default opening, the selection moves **in the same
		 * transaction**.
		 *
		 * Split, a draft would be left pointing at a missing scene, and publishing in that window would
		 * silently change the opening to a different scene.
		 */
		async deleteStartScene(id: string): Promise<void> {
			await db.transaction(async (tx) => {
				const current = await readChild<DraftStartScene>(
					tx,
					authoringSceneTable,
					id,
				);
				if (!current || !isLiveRecord(current)) return;
				const { draftId } = current;
				const now = nowIso();
				const [sceneRev, parentRev] = await nextRevs(tx, 2);
				await authoringSceneTable.upsert(
					tx,
					markAuthoringDeleted(current, now, sceneRev),
				);
				const draft = await liveDraft(tx, draftId);
				if (!draft) return;
				if (draft.defaultStartSceneId !== id) {
					await authoringDraftTable.upsert(
						tx,
						touchDraftActivity(draft, now, parentRev),
					);
					return;
				}
				const remaining = sortStartScenes(
					await liveChildren<DraftStartScene>(tx, authoringSceneTable, draftId),
				);
				await authoringDraftTable.upsert(
					tx,
					markDraftFieldUpdate(
						draft,
						{ defaultStartSceneId: remaining[0]?.id ?? null },
						now,
						parentRev,
					),
				);
			});
		},

		async reorderStartScenes(
			draftId: string,
			orderedIds: string[],
		): Promise<void> {
			await db.transaction((tx) =>
				reorderInTx<DraftStartScene>(
					tx,
					authoringSceneTable,
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
			await db.transaction(async (tx) => {
				const draft = await liveDraft(tx, draftId);
				if (!draft) return;
				if (sceneId !== null) {
					const scene = await readChild<DraftStartScene>(
						tx,
						authoringSceneTable,
						sceneId,
					);
					if (!scene || !isLiveRecord(scene) || scene.draftId !== draftId)
						return;
				}
				await authoringDraftTable.upsert(
					tx,
					markDraftFieldUpdate(
						draft,
						{ defaultStartSceneId: sceneId },
						nowIso(),
						await nextRev(tx),
					),
				);
			});
		},

		/* ── Scene images ── */

		listSceneImages: async (draftId) =>
			sortSceneImages(
				await liveChildren<DraftSceneImage>(
					db,
					authoringSceneImageTable,
					draftId,
				),
			),

		createSceneImage: (
			draftId: string,
			input?: NewDraftSceneImage,
		): Promise<DraftSceneImage> =>
			db.transaction(async (tx) => {
				const now = nowIso();
				const position = await nextPosition(
					tx,
					authoringSceneImageTable,
					draftId,
				);
				const [childRev, parentRev] = await nextRevs(tx, 2);
				const image = createDraftSceneImageRecord(
					{ ...input, draftId, position },
					{ id: newLocalId(), now, rev: childRev },
				);
				await authoringSceneImageTable.upsert(tx, image);
				/** The parent receives **only an activity touch** — the draft's authored fields did not change. */
				await touchDraftInTx(tx, draftId, now, parentRev);
				return image;
			}),

		async updateSceneImage(
			id: string,
			patch: DraftSceneImagePatch,
		): Promise<void> {
			await db.transaction(async (tx) => {
				const current = await readChild<DraftSceneImage>(
					tx,
					authoringSceneImageTable,
					id,
				);
				if (!current || !isLiveRecord(current)) return;
				const now = nowIso();
				const [childRev, parentRev] = await nextRevs(tx, 2);
				await authoringSceneImageTable.upsert(
					tx,
					markAuthoringUpdate({ ...current, ...patch }, now, childRev),
				);
				await touchDraftInTx(tx, current.draftId, now, parentRev);
			});
		},

		async deleteSceneImage(id: string): Promise<void> {
			await db.transaction((tx) =>
				softDeleteChild(tx, authoringSceneImageTable, id),
			);
		},

		/* ── Runtime ── */

		getRuntimeProject: (draftId: string): Promise<DraftRuntimeProject | null> =>
			db.transaction(async (tx) => {
				if (!(await liveDraft(tx, draftId))) return null;
				const project = await readChild<DraftRuntimeProject>(
					tx,
					authoringRuntimeProjectTable,
					runtimeProjectIdFor(draftId),
				);
				return project && isLiveRecord(project) ? project : null;
			}),

		enableRuntime: (
			draftId: string,
			starter?: RuntimeStarter,
		): Promise<DraftRuntimeProject | null> =>
			/**
			 * The project row and the starter file are **one transaction** (same reason and boundary as the
			 * web). Split, a project that is "on with no files" would remain, and that state does not heal
			 * itself.
			 */
			db.transaction(async (tx) => {
				if (!(await liveDraft(tx, draftId))) return null;
				/** A path that was not chosen is the default template — it goes through the same function as the web. */
				const plan = starter ?? defaultRuntimeStarter();
				const now = nowIso();
				const existing = await readChild<DraftRuntimeProject>(
					tx,
					authoringRuntimeProjectTable,
					runtimeProjectIdFor(draftId),
				);

				const project =
					existing && isLiveRecord(existing)
						? markAuthoringUpdate(
								{ ...existing, enabled: true },
								now,
								await nextRev(tx),
							)
						: createDraftRuntimeProjectRecord(
								{ draftId, entry: plan.entry },
								{ now, rev: await nextRev(tx) },
							);
				await authoringRuntimeProjectTable.upsert(tx, project);

				/** If any file exists, do not pour in the starter file — turning off and on again would become an overwrite. */
				const present = await liveChildren<DraftRuntimeFile>(
					tx,
					authoringRuntimeFileTable,
					draftId,
				);
				if (present.length === 0) {
					const revs = await nextRevs(tx, plan.files.length);
					for (const [index, file] of plan.files.entries())
						await authoringRuntimeFileTable.upsert(
							tx,
							createDraftRuntimeFileRecord(
								{ draftId, path: file.path, content: file.content },
								{ id: newLocalId(), now, rev: revs[index] },
							),
						);
				}

				await touchDraftInTx(tx, draftId, now, await nextRev(tx));
				return project;
			}),

		setRuntimeEnabled: (
			draftId: string,
			enabled: boolean,
		): Promise<DraftRuntimeProject | null> =>
			db.transaction(async (tx) => {
				if (!(await liveDraft(tx, draftId))) return null;
				const current = await readChild<DraftRuntimeProject>(
					tx,
					authoringRuntimeProjectTable,
					runtimeProjectIdFor(draftId),
				);
				// A draft that was never turned on is not switched on through this path — the starter file has
				// to come with it.
				if (!current || !isLiveRecord(current)) return null;

				const now = nowIso();
				const [projectRev, parentRev] = await nextRevs(tx, 2);
				/** **Files are not touched here.** Turning off and deleting are different operations. */
				const next = markAuthoringUpdate(
					{ ...current, enabled },
					now,
					projectRev,
				);
				await authoringRuntimeProjectTable.upsert(tx, next);
				await touchDraftInTx(tx, draftId, now, parentRev);
				return next;
			}),

		listRuntimeFiles: async (draftId) =>
			sortRuntimeFiles(
				await liveChildren<DraftRuntimeFile>(
					db,
					authoringRuntimeFileTable,
					draftId,
				),
			),

		createRuntimeFile: (
			draftId: string,
			input: { path: string; content?: string },
		): Promise<DraftRuntimeFile | null> =>
			db.transaction(async (tx) => {
				if (!(await liveDraft(tx, draftId))) return null;
				/** Duplicates are decided by the store as the last authority — another device may create the same path in the meantime. */
				const present = await liveChildren<DraftRuntimeFile>(
					tx,
					authoringRuntimeFileTable,
					draftId,
				);
				if (present.some((file) => file.path === input.path)) return null;

				const now = nowIso();
				const [childRev, parentRev] = await nextRevs(tx, 2);
				const file = createDraftRuntimeFileRecord(
					{ draftId, path: input.path, content: input.content },
					{ id: newLocalId(), now, rev: childRev },
				);
				await authoringRuntimeFileTable.upsert(tx, file);
				await touchDraftInTx(tx, draftId, now, parentRev);
				return file;
			}),

		async updateRuntimeFile(
			id: string,
			patch: DraftRuntimeFilePatch,
		): Promise<void> {
			await db.transaction(async (tx) => {
				const current = await readChild<DraftRuntimeFile>(
					tx,
					authoringRuntimeFileTable,
					id,
				);
				if (!current || !isLiveRecord(current)) return;

				if (patch.path !== undefined && patch.path !== current.path) {
					const siblings = await liveChildren<DraftRuntimeFile>(
						tx,
						authoringRuntimeFileTable,
						current.draftId,
					);
					if (
						siblings.some((file) => file.id !== id && file.path === patch.path)
					)
						return;
				}

				const now = nowIso();
				const [childRev, parentRev] = await nextRevs(tx, 2);
				await authoringRuntimeFileTable.upsert(
					tx,
					markAuthoringUpdate({ ...current, ...patch }, now, childRev),
				);
				await touchDraftInTx(tx, current.draftId, now, parentRev);
			});
		},

		async deleteRuntimeFile(id: string): Promise<void> {
			await db.transaction((tx) =>
				softDeleteChild(tx, authoringRuntimeFileTable, id),
			);
		},

		listRuntimeAssets: async (draftId) =>
			sortRuntimeAssets(
				await liveChildren<DraftRuntimeAsset>(
					db,
					authoringRuntimeAssetTable,
					draftId,
				),
			),

		/**
		 * This app has no studio, yet it has the operation set anyway, **because the port is one.**
		 *
		 * Both apps fill `AuthoringStore` with the same contract, and a hole in that contract (a place
		 * that throws or returns `null`) becomes a silent failure the day an authoring surface comes to
		 * this app. That no screen calls these three yet is not a reason not to implement them —
		 * authoring records already arrive on this device through sync.
		 */
		createRuntimeAsset: (
			draftId: string,
			input: NewDraftRuntimeAsset,
		): Promise<DraftRuntimeAsset | null> =>
			db.transaction(async (tx) => {
				if (!(await liveDraft(tx, draftId))) return null;
				/** Duplicates are decided by the store as the last authority — another device may bind the same name in the meantime. */
				const present = await liveChildren<DraftRuntimeAsset>(
					tx,
					authoringRuntimeAssetTable,
					draftId,
				);
				if (present.some((asset) => asset.path === input.path)) return null;

				const now = nowIso();
				const [childRev, parentRev] = await nextRevs(tx, 2);
				const asset = createDraftRuntimeAssetRecord(
					{ draftId, ...input },
					{ id: newLocalId(), now, rev: childRev },
				);
				await authoringRuntimeAssetTable.upsert(tx, asset);
				await touchDraftInTx(tx, draftId, now, parentRev);
				return asset;
			}),

		async updateRuntimeAsset(
			id: string,
			patch: DraftRuntimeAssetPatch,
		): Promise<void> {
			await db.transaction(async (tx) => {
				const current = await readChild<DraftRuntimeAsset>(
					tx,
					authoringRuntimeAssetTable,
					id,
				);
				if (!current || !isLiveRecord(current)) return;

				if (patch.path !== undefined && patch.path !== current.path) {
					const siblings = await liveChildren<DraftRuntimeAsset>(
						tx,
						authoringRuntimeAssetTable,
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
				const [childRev, parentRev] = await nextRevs(tx, 2);
				await authoringRuntimeAssetTable.upsert(
					tx,
					markAuthoringUpdate({ ...current, ...patch }, now, childRev),
				);
				await touchDraftInTx(tx, current.draftId, now, parentRev);
			});
		},

		async deleteRuntimeAsset(id: string): Promise<void> {
			await db.transaction((tx) =>
				softDeleteChild(tx, authoringRuntimeAssetTable, id),
			);
		},

		/* ── Publication ── */

		/**
		 * The one set of values the publication assembler reads — fetched **in one consistent read**.
		 *
		 * Reading four times separately can produce a combination mixed with edits in between (autosave
		 * keeps running). The prompt would be the new version while the lore is the old, and that
		 * snapshot would get published. It is a read only, but it is a transaction for this reason.
		 */
		loadPublicationSource: (
			draftId: string,
		): Promise<StoryPublicationSource | null> =>
			db.transaction(async (tx) => {
				const draft = await liveDraft(tx, draftId);
				if (!draft) return null;
				return {
					draft,
					lore: sortLore(
						await liveChildren<DraftLoreEntry>(tx, authoringLoreTable, draftId),
					),
					startScenes: sortStartScenes(
						await liveChildren<DraftStartScene>(
							tx,
							authoringSceneTable,
							draftId,
						),
					),
					sceneImages: sortSceneImages(
						await liveChildren<DraftSceneImage>(
							tx,
							authoringSceneImageTable,
							draftId,
						),
					),
					/**
					 * **Runtime comes from the same transaction too.**
					 *
					 * This app has no studio, but authoring records arrive through sync — code written on a Mac
					 * sits in this device's draft, and if publication left it out, **the next publication would
					 * delete that work's runtime.** So mobile also sends the source as-is, and compilation is done
					 * by the server (this is why no compiler comes to this app).
					 */
					runtime: {
						project: await (async () => {
							const project = await readChild<DraftRuntimeProject>(
								tx,
								authoringRuntimeProjectTable,
								runtimeProjectIdFor(draftId),
							);
							return project && isLiveRecord(project) ? project : null;
						})(),
						files: sortRuntimeFiles(
							await liveChildren<DraftRuntimeFile>(
								tx,
								authoringRuntimeFileTable,
								draftId,
							),
						),
						/**
						 * Managed images are also read **in the same transaction**. The reason for sending them
						 * despite this app having no screen that binds them is the same as above — an image bound on
						 * a Mac sits in this device's draft, and if publication left it out, **the next publication
						 * would delete that work's images.**
						 */
						assets: sortRuntimeAssets(
							await liveChildren<DraftRuntimeAsset>(
								tx,
								authoringRuntimeAssetTable,
								draftId,
							),
						),
						/** Reads the **same constant** the web reads — no copy is made. */
						apiVersion: RUNTIME_API_VERSION,
					},
				};
			}),

		/**
		 * Records the publication result on the draft. **The draft id does not change** — publishing does
		 * not consume the draft. The user keeps editing offline after publishing, and the next
		 * publication updates that work.
		 */
		markPublished: (
			draftId: string,
			publishedStoryId: string,
		): Promise<StoryDraft | null> =>
			db.transaction(async (tx) => {
				const draft = await liveDraft(tx, draftId);
				if (!draft) return null;
				const next = markDraftPublished(
					draft,
					publishedStoryId,
					nowIso(),
					await nextRev(tx),
				);
				await authoringDraftTable.upsert(tx, next);
				return next;
			}),
	};
}
