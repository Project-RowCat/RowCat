import type { Rev } from "@rowcat/contracts/sync";
import type { Orientation, StoryVisibility } from "@rowcat/domain";
import {
	ORIENTATION_LABEL,
	ORIENTATIONS,
	STORY_VISIBILITIES,
	STORY_VISIBILITY_LABEL,
} from "@rowcat/domain";
import { z } from "zod";
import {
	DRAFT_FIELD_GROUPS,
	DRAFT_GROUP_FIELDS,
	type DraftFieldGroup,
	draftPatchFieldGroups,
	type StoryDraft,
	type StoryDraftPatch,
} from "./model.ts";

/**
 * Rules for keeping the losing side of a same-group concurrent edit locally, so it can be
 * recovered.
 *
 * Merge is unchanged. HLC still picks one winner, and both devices still converge on the same value
 * as before. What is new is that this device keeps the value that convergence discarded.
 *
 * The three layers:
 * - Merge converges on one canonical value. Unchanged.
 * - Recovery copy keeps the losing group's values locally. Not synced.
 * - Restore writes them back as a new edit through the normal write path.
 *
 * The most important decision here is that restore does not revive an old revision. Setting `rev`,
 * `fieldRev`, `dirty`, `serverVersion`, and `updatedAt` back would send the record with a clock
 * lower than the server already knows. Other devices would ignore it as a replay, and the restored
 * text would stay only on this device. Pressing restore is a new decision that the value should be
 * used now, so it gets a new revision and syncs normally.
 *
 * Why per group: the whole draft is not snapshotted. Conflicts arise in one group while other
 * groups may hold newer, legitimate values. A whole-draft snapshot would roll those back too.
 *
 * Why `publication` is excluded: that group is monotonic, since a publish link never goes backward.
 * It is not a conflict where the losing side disappears, and it is not something the user can
 * meaningfully undo. A restore that re-pointed a draft at another story would be an accident, not a
 * recovery. The type enforces this: `publishedStoryId` is absent from `StoryDraftPatch`, so no
 * value here can carry it.
 */

/**
 * Groups that get recovery copies: every group except `publication`. The list is derived by
 * filtering rather than typed by hand. A new group is recoverable by default, and if one must be
 * excluded later, the predicate changes then. A hand-written list would silently skip a new group,
 * leaving its conflicts with no copy.
 */
export const RECOVERABLE_DRAFT_FIELD_GROUPS = DRAFT_FIELD_GROUPS.filter(
	(group): group is RecoverableDraftFieldGroup => group !== "publication",
);

export type RecoverableDraftFieldGroup = Exclude<
	DraftFieldGroup,
	"publication"
>;

export const isRecoverableDraftFieldGroup = (
	group: string,
): group is RecoverableDraftFieldGroup =>
	(RECOVERABLE_DRAFT_FIELD_GROUPS as readonly string[]).includes(group);

/**
 * One kept copy: one group of one draft. The type has no sync fields: no `dirty`, no
 * `serverVersion`, no tombstone. So no codec or `TABLE_ORDER` entry can carry it. 'Recovery copies
 * are not synced' is enforced by the shape, not just promised in a comment.
 */
export interface DraftConflictRecovery {
	/**
	 * Deterministic identity. The same logical loss gets the same value however many times it is
	 * observed.
	 */
	id: string;
	draftId: string;
	group: RecoverableDraftFieldGroup;
	/**
	 * The lost values. Only fields this group owns are included. Being a `StoryDraftPatch` is half of
	 * the restore rule. Restore passes these values straight to `updateDraft`, so group revision
	 * calculation, validation, and sync marking all take the same path as an ordinary edit. A separate
	 * write path here would be the one that skips a rule.
	 */
	values: StoryDraftPatch;
	losingRev: Rev;
	/** When this loss was first observed (ISO 8601). */
	observedAt: string;
}

/** Extracts only the values this group owns. The group table is the source of truth. */
export function draftGroupValues(
	draft: StoryDraft,
	group: RecoverableDraftFieldGroup,
): StoryDraftPatch {
	const values: Record<string, unknown> = {};
	for (const field of DRAFT_GROUP_FIELDS[group])
		values[field] = draft[field as keyof StoryDraft];
	return values as StoryDraftPatch;
}

/**
 * Opaque value the codec passes as `recover`. This file owns its shape. `@rowcat/sync` does not
 * read it, since reading it would make the protocol aware of the authoring model. Storage carries
 * it unchanged. `parseDraftConflictRecovery` below restores its type.
 */
export interface DraftRecoveryPayload {
	draftId: string;
	group: RecoverableDraftFieldGroup;
	values: StoryDraftPatch;
}

export const draftRecoveryPayload = (
	draft: StoryDraft,
	group: RecoverableDraftFieldGroup,
): DraftRecoveryPayload => ({
	draftId: draft.id,
	group,
	values: draftGroupValues(draft, group),
});

/**
 * One stored row. The sync store writes it and this file reads it. It has the same shape as
 * `SyncRecoveryRecord` in @rowcat/sync but is written out again here for layering reasons. This
 * package does not import @rowcat/sync, which is also why `compareRev` has three copies. If the
 * shapes drift, compilation fails at the assembly point, where the app's recovery store passes its
 * records straight into this function.
 */
export interface DraftRecoveryRow {
	id: string;
	type: string;
	recordId: string;
	scope: string;
	losingRev: Rev;
	payload: unknown;
	observedAt: string;
}

/**
 * Sync type under which draft recovery copies are stored. Rows of other types are not read by this
 * file.
 */
export const DRAFT_RECOVERY_TYPE = "authoring.draft";

const RevSchema = z.object({
	t: z.number().int().nonnegative(),
	c: z.number().int().nonnegative(),
	d: z.string().min(1),
});

/**
 * Schema for stored values. Fields the group does not own are rejected. `.strict()` enforces this.
 * If someone later wants to store a whole snapshot, this blocks it. Without the block, restore
 * would roll back other groups of the same draft.
 */
const ValuesSchema = z
	.object({
		title: z.string(),
		tagline: z.string(),
		description: z.string(),
		tags: z.array(z.string()),
		orientation: z.enum(ORIENTATIONS).nullable(),
		adult: z.boolean(),
		visibility: z.enum(STORY_VISIBILITIES),
		promptProtected: z.boolean(),
		prompt: z.string(),
		defaultStartSceneId: z.string().nullable(),
	})
	.partial()
	.strict();

const PayloadSchema = z.object({
	draftId: z.string().min(1),
	group: z.string(),
	values: ValuesSchema,
});

/**
 * Turns a stored row into a typed copy. Returns `null` when the row cannot be read. It does not
 * throw, because these rows live a long time. If a vocabulary change or one corrupted row turned
 * the whole list into an error screen, the user would lose sight of the healthy copies next to it.
 * A recovery feature must not block recovery.
 */
export function parseDraftConflictRecovery(
	row: DraftRecoveryRow,
): DraftConflictRecovery | null {
	if (row.type !== DRAFT_RECOVERY_TYPE) return null;
	if (!isRecoverableDraftFieldGroup(row.scope)) return null;
	const rev = RevSchema.safeParse(row.losingRev);
	if (!rev.success) return null;
	const payload = PayloadSchema.safeParse(row.payload);
	if (!payload.success) return null;
	/**
	 * The envelope's `scope` must match the payload's `group`. If they differ, there is no basis for
	 * choosing which is right, and restoring from the wrong one would overwrite a group the user did
	 * not choose.
	 */
	if (payload.data.group !== row.scope) return null;
	if (payload.data.draftId !== row.recordId) return null;
	/**
	 * Whether the stored values belong to that group only. If fields the group does not own are mixed
	 * in, restore would roll back other groups too. This feature has deliberately decided not to do
	 * that.
	 */
	const groups = draftPatchFieldGroups(payload.data.values);
	if (groups.length > 1 || (groups.length === 1 && groups[0] !== row.scope))
		return null;
	return {
		id: row.id,
		draftId: row.recordId,
		group: row.scope,
		values: payload.data.values,
		losingRev: rev.data,
		observedAt: row.observedAt,
	};
}

/**
 * Fields that actually differ from the current draft. The screen uses this for highlighting. Not
 * everything is highlighted, because contrast is the point. If a group has five fields and only one
 * differs, the user needs to check only that one. If all five lit up, they would have to count
 * which one is the lost value.
 */
export function draftRecoveryDifferences(
	recovery: DraftConflictRecovery,
	draft: StoryDraft,
): Array<keyof StoryDraftPatch> {
	const differing: Array<keyof StoryDraftPatch> = [];
	for (const field of DRAFT_GROUP_FIELDS[recovery.group]) {
		const key = field as keyof StoryDraftPatch;
		if (!(key in recovery.values)) continue;
		if (!sameValue(recovery.values[key], draft[key])) differing.push(key);
	}
	return differing;
}

const sameValue = (a: unknown, b: unknown): boolean => {
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((item, index) => item === b[index]);
	return a === b;
};

/**
 * Recovery copy store. Read and discard only. Having no write method is the point of this port.
 * Copies are created in one place: the transaction that commits a merge (`applyPull` in web Dexie
 * and mobile SQLite). If a `save` were exposed to the screen, that atomicity would stop meaning
 * anything. A copy created outside the merge would not point at any loss.
 */
export interface DraftRecoveryStore {
	/** All copies not yet handled, most recently observed first. */
	list(): Promise<DraftConflictRecovery[]>;
	listForDraft(draftId: string): Promise<DraftConflictRecovery[]>;
	/** Permanently discards this local copy. The canonical draft is not touched. */
	discard(id: string): Promise<void>;
}

/** Result of a restore. The screen renders each status separately. */
export type DraftRestoreOutcome =
	/** The values went into the draft as a new edit, and the copy was cleaned up. */
	| { status: "restored"; draft: StoryDraft }
	/**
	 * The draft no longer exists, and the copy is kept. The draft is not recreated here. The copy
	 * holds one group's values, so a draft built from it would have every other field empty, which the
	 * user never wrote. The worst outcome is one that looks like the original came back when it did
	 * not.
	 */
	| { status: "missing" };

/**
 * Restore rewrites the values as one ordinary authoring edit. The order is the rule: edit the draft
 * first, and discard the copy only on success.
 * - `updateDraft` succeeds: discard the copy. The recovered value is in the canonical draft.
 * - `updateDraft` fails: keep the copy, so the user can retry.
 * - Draft missing: keep the copy, so it stays readable. Reversing this (discarding the copy
 *   first, then writing) would leave the value nowhere if the write failed. That is the very loss
 *   this feature exists to prevent.
 */
export async function restoreDraftConflict(
	ports: {
		authoring: {
			updateDraft(
				id: string,
				patch: StoryDraftPatch,
			): Promise<StoryDraft | null>;
		};
		recovery: Pick<DraftRecoveryStore, "discard">;
	},
	recovery: DraftConflictRecovery,
): Promise<DraftRestoreOutcome> {
	const draft = await ports.authoring.updateDraft(
		recovery.draftId,
		recovery.values,
	);
	if (!draft) return { status: "missing" };
	await ports.recovery.discard(recovery.id);
	return { status: "restored", draft };
}

/**
 * Product names for the groups. The internal names `meta` and `body` never reach the screen. The
 * words come from the editor's section names. That is where the user edits these values, so other
 * names would make them hunt for where a restore applies.
 */
export const DRAFT_RECOVERY_GROUP_LABEL: Record<
	RecoverableDraftFieldGroup,
	string
> = {
	meta: "Basics",
	rating: "Visibility settings",
	body: "Prompt",
	defaults: "Default opening scene",
};

/** Product names for fields. They use the same words as the editor labels. */
export const DRAFT_RECOVERY_FIELD_LABEL: Record<keyof StoryDraftPatch, string> =
	{
		title: "Title",
		tagline: "One-line intro",
		description: "Description",
		tags: "Tags",
		orientation: "Orientation",
		adult: "Adult",
		visibility: "Visibility",
		promptProtected: "Protect prompt",
		prompt: "Prompt",
		defaultStartSceneId: "Default opening scene",
	};

/**
 * Summary grouped by draft, for users who have lost track of which draft a copy came from. Both
 * apps' sync sections draw the same row, so the grouping rule must be one rule. If each app grouped
 * its own way, one would count copies and the other would count drafts, and those are different
 * numbers. Order is most recently lost first. If old copies sat on top, users would have to scan
 * the list to find what just happened.
 */
export interface DraftRecoverySummaryEntry {
	draftId: string;
	count: number;
	/** Which parts were affected. The screen turns these into labels. */
	groups: RecoverableDraftFieldGroup[];
	/** The most recent observation time among them. */
	observedAt: string;
}

export function summarizeDraftRecoveries(
	items: readonly DraftConflictRecovery[],
): { total: number; drafts: DraftRecoverySummaryEntry[] } {
	const byDraft = new Map<string, DraftRecoverySummaryEntry>();
	for (const item of items) {
		const entry = byDraft.get(item.draftId);
		if (!entry) {
			byDraft.set(item.draftId, {
				draftId: item.draftId,
				count: 1,
				groups: [item.group],
				observedAt: item.observedAt,
			});
			continue;
		}
		entry.count += 1;
		if (!entry.groups.includes(item.group)) entry.groups.push(item.group);
		if (item.observedAt > entry.observedAt) entry.observedAt = item.observedAt;
	}
	const drafts = [...byDraft.values()].sort((a, b) =>
		a.observedAt === b.observedAt
			? a.draftId < b.draftId
				? 1
				: -1
			: a.observedAt < b.observedAt
				? 1
				: -1,
	);
	return { total: items.length, drafts };
}

/**
 * The recovery screen copy, one set shared by both apps. It is not written per app because these
 * sentences are promises. The line `Everything else stays` states an invariant this feature actually
 * keeps, since restore works per group. With two copies, fixing one app would leave the other
 * making a promise it does not keep. `ROOM_ACTIONS` in @rowcat/chat gives both apps the same words
 * for the same reason. Layout and containers stay app-specific. Web uses a window; mobile also uses
 * a window, with different geometry.
 */
export const DRAFT_RECOVERY_COPY = {
	/** In-editor notice. It does not block: it opens no dialog and changes no content. */
	notice:
		"Another device edited the same part at the same time, so the edit that didn't make it was kept aside.",
	open: "Review",
	title: "Kept edits",
	description:
		"When two devices edit the same part at the same time, only one side remains. The other side is kept here.",
	empty: "No kept edits.",
	/** When the source draft is gone. This copy states first that nothing will be restored. */
	orphaned:
		"The draft this edit belongs to no longer exists. You can still read it, but there's nowhere to restore it to.",
	restore: "Restore this version",
	discard: "Delete kept version",
	cancel: "Cancel",
	/**
	 * Delete confirmation. It must say both that this cannot be undone and that the draft itself is
	 * unchanged.
	 */
	discardConfirm:
		"The kept version is deleted permanently. The current draft doesn't change.",
	restoreFailed: "Couldn't restore. Please try again in a moment.",
	discardFailed: "Couldn't delete. Please try again in a moment.",
	/** The draft disappeared during restore. This is a different fact, not a failure. */
	restoreMissing:
		"The draft this edit belongs to no longer exists, so it can't be restored.",
	/** Column names for the two columns. The screen does not invent which is which. */
	preservedColumn: "Kept version",
	currentColumn: "Current version",
	/** When a value is empty. A blank cell would read as `failed to load`. */
	emptyValue: "(empty)",
	/**
	 * Row label in the sync section. This is not a history dashboard. It says one thing only: there is
	 * recoverable content. Transfer events, device lists, and conflict counters do not appear here,
	 * since those are developer values. The way to open it is the editor for that draft.
	 */
	summaryLabel: "Recoverable edits",
} as const;

/**
 * Restore confirmation. It says what gets overwritten, not how. `fieldRev`, HLC, and revisions do
 * not appear in the text. The user needs only two facts: `the saved part becomes the kept version`, and `the
 * rest stays`.
 */
export const draftRecoveryRestoreConfirm = (
	group: RecoverableDraftFieldGroup,
): string =>
	`The current “${DRAFT_RECOVERY_GROUP_LABEL[group]}” content will be replaced with the kept version. Everything else stays.`;

/**
 * Turns one stored value into human-readable text. Raw values are never drawn as-is. Leaving
 * `true`/`false`, `null`, or arrays raw would leave users unable to tell what they are restoring.
 * Nobody reads a checkbox as `false`. It would also make the two columns impossible to compare by
 * eye. All vocabulary comes from `@rowcat/domain`. Retyping it in the app would drift from the
 * editor's words.
 */
export function draftRecoveryValueText(
	field: keyof StoryDraftPatch,
	value: unknown,
): string {
	if (value === undefined || value === null || value === "") {
		if (field === "orientation") return "Not set";
		if (field === "defaultStartSceneId") return "None";
		return DRAFT_RECOVERY_COPY.emptyValue;
	}
	if (field === "tags")
		return Array.isArray(value) && value.length > 0
			? value.join(", ")
			: DRAFT_RECOVERY_COPY.emptyValue;
	if (field === "orientation")
		return ORIENTATION_LABEL[value as Orientation] ?? "Not set";
	if (field === "visibility")
		return STORY_VISIBILITY_LABEL[value as StoryVisibility] ?? String(value);
	if (typeof value === "boolean") return value ? "On" : "Off";
	return String(value);
}

/**
 * Display of the kept-at time. It shows both date and time. Relative phrasing such as '3 days ago'
 * is avoided because copies can stay for weeks. The older a copy is, the more its date matters, and
 * relative phrasing gets vaguer as time passes.
 */
export const draftRecoveryObservedText = (observedAt: string): string => {
	const parsed = new Date(observedAt);
	return Number.isNaN(parsed.getTime())
		? observedAt
		: parsed.toLocaleString("ko-KR", {
				dateStyle: "medium",
				timeStyle: "short",
			});
};
