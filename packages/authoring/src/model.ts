import type { ChatLorePosition } from "@rowcat/contracts/chat";
import type { Rev } from "@rowcat/contracts/sync";
import type { Orientation, StoryVisibility } from "@rowcat/domain";

/**
 * Local authoring records: a draft and its children. The legacy `Preset` is not revived; it mixed
 * an editing document, a chat template, a gallery copy and a DRM container. Only the editing
 * document remains, as `StoryDraft`. Three concepts stay separate:
 * - StoryDraft: device-owned editing source, never on the server.
 * - Publication contract: the wire shape in @rowcat/contracts/publication.
 * - StoryChatSeedDto: the self-contained play snapshot of a published work, built by the server.
 *   Merging them would tie the storage model to the wire format, so every wire change would require
 *   migrating drafts already on devices. Local-only fields would also leak into the server
 *   contract. No React, Dexie, SQLite or fetch here, as in @rowcat/chat. Web (IndexedDB) and Expo
 *   (SQLite) share this model, and a different backend must not change what a draft means.
 */

/**
 * Draft schema version. Records stay on user devices for a long time, so the stored shape must be
 * identifiable after app updates. This is separate from the storage schema version (Dexie), which
 * covers tables and indexes. This version tracks the meaning of one record.
 * - 1: scenario, playGuide, suggestedPersona and character records existed separately. bodyMode
 *   split structured and free-prompt editing.
 * - 2: the authoring body is a single `prompt`. The four fields above are folded into it. Sync
 *   ignores payloads with a higher version than its own codec. Devices that have not updated keep
 *   the last version they know, so they never half-read an unknown shape. The reverse case (a v2
 *   device receiving v1 payloads) is handled by folding in legacy.ts.
 */
export const AUTHORING_SCHEMA_VERSION = 2;
export type AuthoringSchemaVersion = typeof AUTHORING_SCHEMA_VERSION;

/**
 * Sync metadata. Sync does not exist yet, but records carry these fields from now on. The fields
 * match @rowcat/chat's ChatSyncMeta, but the type is not imported, so the packages stay unaware of
 * each other. Chat is nearly append-only while drafts change often in small parts, so the two sync
 * units may split later.
 */
export interface AuthoringSyncMeta {
	/**
	 * Whether a local change has not yet reached the server. Starts at 1 on creation. This is a
	 * different axis from publication (publishedStoryId). Publishing is a separate act of listing the
	 * work publicly. 0 | 1 instead of a boolean because IndexedDB cannot index booleans. Without an
	 * index, a future push would scan the whole table to find dirty rows. The same rationale is
	 * written in @rowcat/chat's ChatSyncMeta.
	 */
	dirty: 0 | 1;
	/**
	 * Last version the server confirmed, used for optimistic concurrency. Records created only locally
	 * stay at 0.
	 */
	serverVersion: number;
	/**
	 * Merge revision (Hybrid Logical Clock). Different from updatedAt: updatedAt is for display and
	 * recency, while rev orders two versions. The store issues it, because clock state must persist in
	 * the same transaction. This package only receives and stores it.
	 */
	rev: Rev;
}

/**
 * Field groups of a draft root. These are the only fields merged field by field. The list lives
 * here, not in @rowcat/contracts. It is authoring's merge vocabulary, not a wire shape, and the
 * server should not carry it. Five groups match the editor's real surfaces. Per-field stamps would
 * be too many. One stamp per record would silently drop one side's edit, e.g. a title edited on a
 * phone and a prompt edited offline on a laptop. The persona group is gone in v2 because its
 * content folded into `prompt`. An empty group would never advance its revision and would invite
 * someone to add fields to it. Identity, timestamps and sync metadata belong to no group. They are
 * record state, and including them would advance group revisions without any field change.
 */
export const DRAFT_FIELD_GROUPS = [
	"meta",
	"rating",
	"body",
	"defaults",
	"publication",
] as const;
export type DraftFieldGroup = (typeof DRAFT_FIELD_GROUPS)[number];

/**
 * One revision per group. All five are always present, since a missing group gives merge nothing to
 * compare.
 */
export type DraftFieldRev = Record<DraftFieldGroup, Rev>;

/**
 * Soft delete: a deletion that future sync can propagate. If rows were deleted outright, other
 * devices would never learn of the deletion. They would re-upload the record at the next sync, and
 * the deleted draft would come back. Keeping the slot costs one field now. Skipping it would mean a
 * migration later. Normal queries do not return records with a value here. The store implementation
 * enforces that (see the contract in store.ts).
 */
export interface AuthoringSoftDelete {
	deletedAt: string | null;
}

export const isLiveRecord = <T extends AuthoringSoftDelete>(
	record: T,
): boolean => record.deletedAt === null;

export interface StoryDraft extends AuthoringSyncMeta, AuthoringSoftDelete {
	/**
	 * Local identity, created by the device. It never becomes the server work id, not even after
	 * publishing. This id names the document being edited, while publishedStoryId names the catalog
	 * entry. Merging them would leave unpublished drafts without an identity and turn every edit after
	 * publishing into a work edit, which blocks offline editing.
	 */
	id: string;
	schemaVersion: AuthoringSchemaVersion;

	title: string;
	tagline: string;
	description: string;
	tags: string[];
	/** `null` when unset. The wire convention of an empty string is kept out of the storage model. */
	orientation: Orientation | null;

	adult: boolean;
	/**
	 * The visibility the author wants at publish time. This is a request, not the result: the server
	 * re-checks it against policy. The publish screen offers only public and private. archived is a
	 * state change of a published work, not a publish target. The type still accepts all three values,
	 * because narrowing it would make values from other devices or imports unrepresentable.
	 */
	visibility: StoryVisibility;
	/**
	 * Prompt protection is a product display policy, not encryption. /play currently sends the whole
	 * play payload to the client, so this flag only means the prompt is not shown on screen. Do not
	 * claim more. Keeping prompts server-side would need a different design in which generation itself
	 * runs on the server.
	 */
	promptProtected: boolean;

	/**
	 * The whole work body. Worldbuilding, the counterpart role and characters are all written here as
	 * one text. In v1 these were four separate places. The real problem was not the number of fields.
	 * Authors could not tell where a piece of content belonged, so they wrote it anywhere, and the
	 * fields became obstacles. Lore and opening scenes are not folded in. Lore is a keyword-triggered
	 * injection; written into the body it would be sent every turn. Opening scenes are a separate
	 * choice of starting point.
	 */
	prompt: string;

	/**
	 * Id of the default opening scene. Not an array index, since reordering or deleting scenes would
	 * silently change the target. A stable id that no longer exists means 'not found', which a
	 * fallback can handle.
	 */
	defaultStartSceneId: string | null;

	publishedStoryId: string | null;

	/**
	 * `rev` and `fieldRev` are different axes.
	 * - rev: when the record was last touched, including when only its activity time moved because a
	 *   child changed.
	 * - fieldRev[group]: when that group's authored fields last really changed. Do not collapse
	 *   them, e.g. `rev = max(fieldRev)`. Child edits advance updatedAt but change no authored group,
	 *   and folding them in would require a seventh 'activity' group.
	 */
	fieldRev: DraftFieldRev;

	/** ISO 8601. */
	createdAt: string;
	updatedAt: string;
}

/**
 * A draft now has two child records: lore and opening scenes. Characters (DraftCharacter) were
 * removed in v2. A per-card record, with its own revision, tombstone and order, only pays off when
 * a card differs from the body. Now a character description is a paragraph of the prompt body. As a
 * separate record, the same text would be split across two storage units and two merge rules.
 */
export interface DraftLoreEntry extends AuthoringSyncMeta, AuthoringSoftDelete {
	id: string;
	draftId: string;
	/**
	 * List order. Deliberately named differently from `position` (the injection point). Lore has two
	 * real axes: its place in the list, and where it is injected in the prompt.
	 */
	positionIndex: number;

	keys: string[];
	content: string;
	constant: boolean;
	/**
	 * Prompt injection position. Only the three values the play contract understands are used. Legacy
	 * depth, group, oneshot and locked are not revived. The assembler does not read them, so an editor
	 * control would silently ignore what the creator set, which is worse than no feature. They will be
	 * added together with the context engine, once it understands those axes.
	 */
	position: ChatLorePosition;
	/** Priority within the same injection position. Higher values come first. */
	order: number;

	createdAt: string;
	updatedAt: string;
}

export interface DraftStartScene
	extends AuthoringSyncMeta,
		AuthoringSoftDelete {
	id: string;
	draftId: string;
	position: number;

	title: string;
	content: string;

	createdAt: string;
	updatedAt: string;
}

/**
 * Scene image: a trigger and a server asset reference. Like lore and opening scenes, it is a child
 * record with its own revision, tombstone and order. It is not a root field. Devices on an older
 * version would drop an unknown root key on decode, and their next push would delete the images.
 * Unknown record types are ignored, so the loss stays invisible (see docs/sync/ARCHITECTURE.md
 * §19). assetId is a server media id. The bytes stay out of this record, since the draft syncs as
 * text and embedding images would make one draft several MB (the legacy format did exactly this).
 * Unlike the cover, which stays on the device until publishing, the bytes upload as soon as an
 * image is chosen. The trigger must point at a reference so the runtime snapshot can be built at
 * publish time.
 */
export interface DraftSceneImage
	extends AuthoringSyncMeta,
		AuthoringSoftDelete {
	id: string;
	draftId: string;
	/**
	 * Place in the list. Also the order automatic attachment reads when it resolves ties between scene
	 * images.
	 */
	position: number;

	/** Name that `[img:<trigger>]` in the body refers to. Matching ignores case. */
	trigger: string;
	/**
	 * Server media id. An empty string means no image has been chosen yet, and publishing blocks on
	 * it.
	 */
	assetId: string;

	createdAt: string;
	updatedAt: string;
}

/**
 * Values supplied by the caller: id and timestamp. This package never calls crypto.randomUUID() or
 * Date.now(). Platforms differ in what they provide (Hermes on Expo needs a polyfill). Pure inputs
 * also make the results directly comparable.
 */
export interface AuthoringStamp {
	id: string;
	/** ISO 8601. */
	now: string;
	/**
	 * Revision at which the record is created. The store supplies it from its clock, since clock state
	 * and the record must persist in one transaction. Only the store knows that boundary.
	 */
	rev: Rev;
}

const freshSyncMeta = (rev: Rev): AuthoringSyncMeta => ({
	dirty: 1,
	serverVersion: 0,
	rev,
});

/**
 * All five group revisions start at the creation revision. That means the whole record existed at
 * that point. No earlier per-group history exists, so this is accurate.
 */
const freshFieldRev = (rev: Rev): DraftFieldRev => ({
	meta: rev,
	rating: rev,
	body: rev,
	defaults: rev,
	publication: rev,
});

/**
 * All fields are optional, because an empty draft must be valid. The creator presses `New draft` before
 * deciding anything, and the record must still save. Requiring a title would break the common order
 * of writing the scenario first and naming it later. Legacy lost data exactly this way.
 */
export interface CreateStoryDraftInput {
	title?: string;
	tagline?: string;
	description?: string;
	tags?: string[];
	orientation?: Orientation | null;
	adult?: boolean;
	visibility?: StoryVisibility;
	promptProtected?: boolean;
	prompt?: string;
}

/**
 * The default visibility is `private`, on purpose. Making a work public cannot be undone, since
 * viewers may already have seen it. Public publishing is open now, and this default is the only
 * guard against publishing an unfinished work by mistake. Earlier, policy caught that mistake.
 */
export function createStoryDraftRecord(
	input: CreateStoryDraftInput | undefined,
	stamp: AuthoringStamp,
): StoryDraft {
	return {
		id: stamp.id,
		schemaVersion: AUTHORING_SCHEMA_VERSION,
		title: input?.title ?? "",
		tagline: input?.tagline ?? "",
		description: input?.description ?? "",
		tags: input?.tags ? [...input.tags] : [],
		orientation: input?.orientation ?? null,
		adult: input?.adult ?? false,
		visibility: input?.visibility ?? "private",
		promptProtected: input?.promptProtected ?? false,
		prompt: input?.prompt ?? "",
		defaultStartSceneId: null,
		publishedStoryId: null,
		fieldRev: freshFieldRev(stamp.rev),
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshSyncMeta(stamp.rev),
	};
}

export interface CreateDraftLoreEntryInput {
	draftId: string;
	positionIndex: number;
	keys?: string[];
	content?: string;
	constant?: boolean;
	position?: ChatLorePosition;
	order?: number;
}

export function createDraftLoreEntryRecord(
	input: CreateDraftLoreEntryInput,
	stamp: AuthoringStamp,
): DraftLoreEntry {
	return {
		id: stamp.id,
		draftId: input.draftId,
		positionIndex: input.positionIndex,
		keys: input.keys ? [...input.keys] : [],
		content: input.content ?? "",
		constant: input.constant ?? false,
		position: input.position ?? "system_bottom",
		order: input.order ?? 0,
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshSyncMeta(stamp.rev),
	};
}

export interface CreateDraftStartSceneInput {
	draftId: string;
	position: number;
	title?: string;
	content?: string;
}

export function createDraftStartSceneRecord(
	input: CreateDraftStartSceneInput,
	stamp: AuthoringStamp,
): DraftStartScene {
	return {
		id: stamp.id,
		draftId: input.draftId,
		position: input.position,
		title: input.title ?? "",
		content: input.content ?? "",
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshSyncMeta(stamp.rev),
	};
}

export interface CreateDraftSceneImageInput {
	draftId: string;
	position: number;
	trigger?: string;
	assetId?: string;
}

export function createDraftSceneImageRecord(
	input: CreateDraftSceneImageInput,
	stamp: AuthoringStamp,
): DraftSceneImage {
	return {
		id: stamp.id,
		draftId: input.draftId,
		position: input.position,
		trigger: input.trigger ?? "",
		assetId: input.assetId ?? "",
		createdAt: stamp.now,
		updatedAt: stamp.now,
		deletedAt: null,
		...freshSyncMeta(stamp.rev),
	};
}

/**
 * Fields that may be patched on the draft root. Identity, creation time and the publish link are
 * not patchable.
 */
export type StoryDraftPatch = Partial<
	Pick<
		StoryDraft,
		| "title"
		| "tagline"
		| "description"
		| "tags"
		| "orientation"
		| "adult"
		| "visibility"
		| "promptProtected"
		| "prompt"
		| "defaultStartSceneId"
	>
>;

export type DraftLoreEntryPatch = Partial<
	Pick<DraftLoreEntry, "keys" | "content" | "constant" | "position" | "order">
>;

export type DraftStartScenePatch = Partial<
	Pick<DraftStartScene, "title" | "content">
>;

export type DraftSceneImagePatch = Partial<
	Pick<DraftSceneImage, "trigger" | "assetId">
>;

/**
 * Field-to-group table for draft patches. This is the only definition in the repository. If screens
 * or storage each decided the group, an edit could be saved without advancing its group revision.
 * The next merge would then silently overwrite that field with the other side's value. Typed as
 * Record<keyof StoryDraftPatch, ...>, a new patch field fails to compile until it is mapped.
 */
const DRAFT_FIELD_GROUP_OF: Record<keyof StoryDraftPatch, DraftFieldGroup> = {
	title: "meta",
	tagline: "meta",
	description: "meta",
	tags: "meta",
	orientation: "meta",
	adult: "rating",
	visibility: "rating",
	promptProtected: "rating",
	prompt: "body",
	defaultStartSceneId: "defaults",
};

/**
 * Groups touched by this patch. Uses `in` rather than value checks, to match how the write spreads
 * the patch: a key set to undefined still counts as written. `publication` is never returned.
 * publishedStoryId is not part of patches; markDraftPublished advances that group.
 */
export function draftPatchFieldGroups(
	patch: StoryDraftPatch,
): DraftFieldGroup[] {
	const groups = new Set<DraftFieldGroup>();
	for (const key of Object.keys(DRAFT_FIELD_GROUP_OF) as Array<
		keyof StoryDraftPatch
	>) {
		if (key in patch) groups.add(DRAFT_FIELD_GROUP_OF[key]);
	}
	return DRAFT_FIELD_GROUPS.filter((group) => groups.has(group));
}

/**
 * Group to owned fields, derived from the table above. It is derived rather than hand-written
 * because two readers depend on it and will grow. A stale sync merge would lose the other device's
 * edits on new fields. A stale recovery copy would restore without them. `publication` is seeded by
 * hand: publishedStoryId is not in the patch table, so derivation cannot produce it. An empty list
 * would stop merges from moving the publish link.
 */
export const DRAFT_GROUP_FIELDS: Record<
	DraftFieldGroup,
	readonly (keyof StoryDraft)[]
> = (() => {
	const table: Record<DraftFieldGroup, (keyof StoryDraft)[]> = {
		meta: [],
		rating: [],
		body: [],
		defaults: [],
		publication: ["publishedStoryId"],
	};
	for (const key of Object.keys(DRAFT_FIELD_GROUP_OF) as Array<
		keyof StoryDraftPatch
	>)
		table[DRAFT_FIELD_GROUP_OF[key]].push(key);
	return table;
})();

/**
 * Local-edit marker: advances the update time and revision, and sets dirty again. serverVersion is
 * not touched. It is the last server-confirmed version, and local edits never change it. Advancing
 * it here would let a future push run its concurrency check against a version it never saw. The
 * revision is a parameter because one transaction can edit several records (a child and its parent
 * draft). They need distinct revisions to keep their order, and only the store knows the issue
 * order.
 */
export function markAuthoringUpdate<
	T extends AuthoringSyncMeta & { updatedAt: string },
>(record: T, now: string, rev: Rev): T {
	return { ...record, updatedAt: now, dirty: 1, rev };
}

/**
 * Partial update of a draft root. Applies the patch and advances only the fieldRev of the groups it
 * touches. One revision is used even when several groups change. One save is one logical change.
 * Per-field revisions would invent an order inside a single save, and merging would read it as 'the
 * title was written, then the body'.
 */
export function markDraftFieldUpdate(
	draft: StoryDraft,
	patch: StoryDraftPatch,
	now: string,
	rev: Rev,
): StoryDraft {
	const fieldRev = { ...draft.fieldRev };
	for (const group of draftPatchFieldGroups(patch)) fieldRev[group] = rev;
	return { ...markAuthoringUpdate({ ...draft, ...patch }, now, rev), fieldRev };
}

/**
 * Child activity touches the parent draft. Its record revision and time advance, but fieldRev does
 * not. The list sorts by updatedAt, so the draft must move up when a child changes. That activity
 * changed no authored field, though. Advancing a group revision here would let the next merge
 * overwrite another device's edits with unchanged fields.
 */
export const touchDraftActivity = (
	draft: StoryDraft,
	now: string,
	rev: Rev,
): StoryDraft => markAuthoringUpdate(draft, now, rev);

/**
 * Soft-delete marker. An already deleted record keeps its deletedAt, so the first deletion time
 * stays as the basis for the local trash and compaction. A repeated delete (another tab or a retry)
 * must not move that time forward. Deletion wins over edits by tombstone state, not by timestamp: a
 * locally deleted record cannot be revived by any inbound update. Remote tombstones arrive without
 * a body, so the receiving device cannot recover the original deletion time.
 */
export function markAuthoringDeleted<
	T extends AuthoringSyncMeta & AuthoringSoftDelete & { updatedAt: string },
>(record: T, now: string, rev: Rev): T {
	return {
		...record,
		deletedAt: record.deletedAt ?? now,
		updatedAt: now,
		dirty: 1,
		rev,
	};
}

/**
 * Writes the publish result onto the draft. The id stays the same: local editing identity and
 * catalog identity differ, and the draft stays editable after publishing, which is what makes
 * offline editing work. dirty is not cleared on purpose. That flag is read by future sync, and
 * publishing does not mean the draft has synced. Only the publication group advances. Advancing the
 * others would let a publish overwrite title or scenario edits made on other devices.
 */
export function markDraftPublished(
	draft: StoryDraft,
	publishedStoryId: string,
	now: string,
	rev: Rev,
): StoryDraft {
	return {
		...markAuthoringUpdate({ ...draft, publishedStoryId }, now, rev),
		fieldRev: { ...draft.fieldRev, publication: rev },
	};
}

/**
 * Child sort. When order values tie, the id breaks the tie to give a total order. Without that, the
 * list can shuffle on each render in engines whose sort is not stable. Some reorders briefly give
 * two items the same value (implementations that write one row at a time outside a transaction), so
 * a deterministic order beats flicker.
 */
const byPositionThenId = (
	a: { position: number; id: string },
	b: { position: number; id: string },
): number =>
	a.position !== b.position ? a.position - b.position : a.id < b.id ? -1 : 1;

export const sortStartScenes = (items: DraftStartScene[]): DraftStartScene[] =>
	[...items].sort(byPositionThenId);

export const sortSceneImages = (items: DraftSceneImage[]): DraftSceneImage[] =>
	[...items].sort(byPositionThenId);

export const sortLore = (items: DraftLoreEntry[]): DraftLoreEntry[] =>
	[...items].sort((a, b) =>
		a.positionIndex !== b.positionIndex
			? a.positionIndex - b.positionIndex
			: a.id < b.id
				? -1
				: 1,
	);

export function compareDraftsByRecency(a: StoryDraft, b: StoryDraft): number {
	if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
	return a.id < b.id ? 1 : -1;
}

/**
 * The name shown in lists. It lives here because the draft list, editor header and publish
 * confirmation must use the same wording. Without a fallback, a blank title renders as an empty row
 * that looks like loading. The fallback is `Untitled`.
 */
export const draftDisplayTitle = (draft: StoryDraft): string =>
	draft.title.trim() || "Untitled";

/**
 * Chooses the default opening scene: saved selection first, then the first scene, then none. The
 * selected scene can disappear (deleted, or removed by another device's sync), so it falls back to
 * the first scene instead of blocking publish. The input must already be live and sorted. Filtering
 * again here would make each caller filter twice, and a caller that forgot to sort would get a
 * different answer silently.
 */
export function resolveDefaultStartScene(
	defaultStartSceneId: string | null,
	orderedScenes: DraftStartScene[],
): DraftStartScene | null {
	if (defaultStartSceneId) {
		const chosen = orderedScenes.find((s) => s.id === defaultStartSceneId);
		if (chosen) return chosen;
	}
	return orderedScenes[0] ?? null;
}
