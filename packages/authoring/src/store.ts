import type {
	CreateDraftLoreEntryInput,
	CreateDraftSceneImageInput,
	CreateDraftStartSceneInput,
	CreateStoryDraftInput,
	DraftLoreEntry,
	DraftLoreEntryPatch,
	DraftSceneImage,
	DraftSceneImagePatch,
	DraftStartScene,
	DraftStartScenePatch,
	StoryDraft,
	StoryDraftPatch,
} from "./model.ts";
import type { StoryPublicationSource } from "./publication.ts";
import type {
	DraftRuntimeAsset,
	DraftRuntimeAssetPatch,
	DraftRuntimeFile,
	DraftRuntimeFilePatch,
	DraftRuntimeProject,
	NewDraftRuntimeAsset,
	RuntimeStarter,
} from "./runtime.ts";

/**
 * Storage port for authoring: the boundary between the pure authoring rules and actual persistence.
 *
 * - Same reason as `ChatStore` in @rowcat/chat: two implementations are already expected (web on
 *   Dexie, mobile on SQLite later). Only operations that really occur are exposed. No repository
 *   factory or query builder layer, since there is no difference to absorb.
 * - Dexie vocabulary (tables, indexes, liveQuery, Collection) must not leak through. If it did, a
 *   SQLite implementation would imitate it and the transaction boundaries would blur.
 * - Soft delete is invisible: no list or lookup returns a record with deletedAt set, including
 *   children of a deleted draft. Otherwise a deleted draft's children reappear in the editor.
 * - Order is kept by the store: lists come in stable order (position, then id), and reordering is
 *   a single transaction. Splitting it could leave two items at the same position if the browser
 *   dies in between.
 */

export type NewDraftLoreEntry = Omit<
	CreateDraftLoreEntryInput,
	"draftId" | "positionIndex"
>;
export type NewDraftStartScene = Omit<
	CreateDraftStartSceneInput,
	"draftId" | "position"
>;
export type NewDraftSceneImage = Omit<
	CreateDraftSceneImageInput,
	"draftId" | "position"
>;

export interface AuthoringStore {
	/**
	 * Ordered by most recent modification. Soft-deleted drafts are excluded.
	 */
	listDrafts(): Promise<StoryDraft[]>;
	/**
	 * Returns null if the draft is missing or deleted. A draft outside this scope counts as 'not
	 * found', not as an error.
	 */
	getDraft(id: string): Promise<StoryDraft | null>;
	/**
	 * Creates a draft. The implementation generates the id, since the identity is owned by the device
	 * and needs no server round trip.
	 *
	 * All inputs are optional. The `New draft` button is pressed without knowing any values.
	 */
	createDraft(input?: CreateStoryDraftInput): Promise<StoryDraft>;
	/**
	 * Partial update. Returns null for a missing draft and does not resurrect it.
	 *
	 * The updated record is returned so autosave can show the save time without re-reading the value
	 * just written.
	 */
	updateDraft(id: string, patch: StoryDraftPatch): Promise<StoryDraft | null>;
	/**
	 * Soft delete. Children are deleted in the same transaction.
	 *
	 * If children were kept, a later sync would upload parentless records that the receiver cannot
	 * attach to any draft. Runtime projects and their files are part of those children. Leaving them
	 * out would ship the deleted draft's code in the next push.
	 */
	deleteDraft(id: string): Promise<void>;

	listLore(draftId: string): Promise<DraftLoreEntry[]>;
	createLore(
		draftId: string,
		input?: NewDraftLoreEntry,
	): Promise<DraftLoreEntry>;
	updateLore(id: string, patch: DraftLoreEntryPatch): Promise<void>;
	deleteLore(id: string): Promise<void>;
	/**
	 * Reorders by assigning positions in the given id order, as one transaction.
	 *
	 * Ids not in the list are ignored, and items missing from the list stay at the end. The list on
	 * screen may differ from storage, for example after another tab added an item. Sorting only the
	 * known items is better than failing; the user's drag result is still applied.
	 */
	reorderLore(draftId: string, orderedIds: string[]): Promise<void>;

	listStartScenes(draftId: string): Promise<DraftStartScene[]>;
	createStartScene(
		draftId: string,
		input?: NewDraftStartScene,
	): Promise<DraftStartScene>;
	updateStartScene(id: string, patch: DraftStartScenePatch): Promise<void>;
	/**
	 * Deletes a scene. If it was the default start scene, clears the selection in the same
	 * transaction.
	 *
	 * Splitting these would leave a window pointing at a missing scene. Publishing from that window
	 * would silently switch the start scene. Clearing is more honest: the editor then shows `Please choose`
	 * (please choose).
	 */
	deleteStartScene(id: string): Promise<void>;
	reorderStartScenes(draftId: string, orderedIds: string[]): Promise<void>;
	/**
	 * Sets the default start scene. `null` means no selection; the assembler then falls back to the
	 * first scene.
	 */
	setDefaultStartScene(draftId: string, sceneId: string | null): Promise<void>;

	/**
	 * Lists this draft's scene images in position order.
	 *
	 * This is the one list without a reorder operation, unlike lore and start scenes. Here the order
	 * only decides which entry wins when two share a trigger, and duplicates are blocked at publish.
	 * Lore and start-scene order is the order they appear in the prompt, so the creator must set it. A
	 * reorder UI would add a control that changes nothing.
	 */
	listSceneImages(draftId: string): Promise<DraftSceneImage[]>;
	createSceneImage(
		draftId: string,
		input?: NewDraftSceneImage,
	): Promise<DraftSceneImage>;
	updateSceneImage(id: string, patch: DraftSceneImagePatch): Promise<void>;
	/**
	 * Removes the image from the list. The server asset is not deleted.
	 *
	 * A published work's playback snapshot may point at this media. Deleting the bytes here would
	 * remove a picture from a conversation someone else is having. Removing from a draft and deleting
	 * from the world are different operations.
	 */
	deleteSceneImage(id: string): Promise<void>;

	/**
	 * Returns the draft's runtime project, or null if it was never enabled.
	 *
	 * null and { enabled: false } are different facts. The first means never turned on; the second
	 * means turned off, usually with files still present. If the screen draws them the same, a user
	 * who turns the runtime back on cannot explain why their code came back.
	 */
	getRuntimeProject(draftId: string): Promise<DraftRuntimeProject | null>;
	/**
	 * Enables the runtime. On first enable, the starter files are created in the same transaction.
	 *
	 * Splitting these would commit a project that is on but has no files, a state the studio cannot
	 * repair (it cannot be re-enabled). The template creates six files, so atomicity matters more now:
	 * a half-committed template is a project that does not compile, and the user inherits a state they
	 * did not choose.
	 *
	 * If files already exist, nothing is created. Writing a second starter copy on re-enable would
	 * make the user's src/main.tsx vanish or be overwritten. So the template gallery is shown only on
	 * first creation, and this idempotency is the final guard for that.
	 *
	 * Omitting `starter` uses the default template (`defaultRuntimeStarter`). The port takes an
	 * already instantiated value, not a template id, because the store has no reason to know the
	 * template registry. Choosing is the screen's job; this port only writes the value atomically.
	 */
	enableRuntime(
		draftId: string,
		starter?: RuntimeStarter,
	): Promise<DraftRuntimeProject | null>;
	/**
	 * Disables (or re-enables) the runtime. Files are not deleted.
	 *
	 * Disabling and deleting are not merged into one operation. Undoing a deletion is far more costly,
	 * and combining them would turn the common intent 'set this aside for now' into deleting the
	 * manuscript (see §16).
	 */
	setRuntimeEnabled(
		draftId: string,
		enabled: boolean,
	): Promise<DraftRuntimeProject | null>;

	/** Returned in path order. Deleted files are excluded. */
	listRuntimeFiles(draftId: string): Promise<DraftRuntimeFile[]>;
	/**
	 * Creates one file. Returns null if the path already exists or the draft does not exist.
	 *
	 * The caller normalizes and validates the path (`planRuntimeFileCreate`). This port does not judge
	 * it again: the store can only say 'not allowed', while the pure rules own the 'why'. Duplicates
	 * are still rejected here, because another tab may create the same path in the meantime. Silently
	 * creating both would show the same name twice in the explorer.
	 */
	createRuntimeFile(
		draftId: string,
		input: { path: string; content?: string },
	): Promise<DraftRuntimeFile | null>;
	/**
	 * Updates the content or the path. If the file is missing, does nothing; it is not resurrected.
	 *
	 * Changing the path is a rename. There is no separate move operation because they are the same
	 * thing: folders derive from the path, so changing `src/a.ts` to `lib/a.ts` is indistinguishable
	 * from renaming it.
	 */
	updateRuntimeFile(id: string, patch: DraftRuntimeFilePatch): Promise<void>;
	deleteRuntimeFile(id: string): Promise<void>;

	/** Images this draft has bound to logical names, sorted by path. */
	listRuntimeAssets(draftId: string): Promise<DraftRuntimeAsset[]>;
	/**
	 * Binds one image to a logical name.
	 *
	 * The bytes are not in the arguments. The image is uploaded to the server before this call
	 * (`client.me.uploadRuntimeImage`), and only its identity and dimensions arrive here. For a draft
	 * to be self-contained, the reference must point at the image on other devices too. A local value
	 * without bytes means nothing on those devices (the scene image made the same decision).
	 *
	 * The path is validated by the caller (`classifyRuntimeAssetValue`, then `planRuntimeAssetBinding`
	 * in the language contract). The store only checks for duplicates again. Another tab may bind the
	 * same name in the meantime, and silently creating both would leave `asset("a")` unable to say
	 * which image it means.
	 */
	createRuntimeAsset(
		draftId: string,
		/**
		 * This is a discriminated union: the values that come along depend on the kind.
		 *
		 * An optional bag would let callers build `{ kind: "audio", width: 512 }`, or an audio asset with
		 * no duration. The storage layer accepts that combination because its columns are nullable, so it
		 * would save it silently. The symptom of such a bad row is only that the list shows false data.
		 */
		input: NewDraftRuntimeAsset,
	): Promise<DraftRuntimeAsset | null>;
	/**
	 * Renames (one path) or swaps the image (identity and dimensions together).
	 *
	 * This port has no path that overwrites existing media bytes. Replacement creates new media and
	 * points this record at the new identity. So a published work's screen does not change a single
	 * pixel until it is republished. That invariant is why this signature exists.
	 */
	updateRuntimeAsset(id: string, patch: DraftRuntimeAssetPatch): Promise<void>;
	/**
	 * Removes one of this draft's bindings. The server image is not deleted.
	 *
	 * Only the fact that this draft calls that image by that name is deleted. The bytes may still be
	 * referenced by a published work's snapshot, and that work may be running on someone else's device
	 * right now.
	 */
	deleteRuntimeAsset(id: string): Promise<void>;

	/**
	 * Reads the publication assembler's inputs as one consistent read.
	 *
	 * If the caller reads three times separately, edits in between can produce a mixed result.
	 * Autosave keeps running, so the published prompt could be the new version while the lore is the
	 * old one.
	 */
	loadPublicationSource(
		draftId: string,
	): Promise<StoryPublicationSource | null>;

	/**
	 * Records the publish result on the draft. Returns null if the draft is missing.
	 *
	 * The draft id does not change (`markDraftPublished`). Publishing does not consume the draft: the
	 * user keeps editing offline after publishing, and the next publish updates the same work.
	 */
	markPublished(
		draftId: string,
		publishedStoryId: string,
	): Promise<StoryDraft | null>;
}
