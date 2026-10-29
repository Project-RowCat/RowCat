import { CHAT_LORE_POSITIONS } from "@rowcat/contracts/chat";
import type { Rev } from "@rowcat/contracts/sync";
import { ORIENTATIONS, STORY_VISIBILITIES } from "@rowcat/domain";
import { z } from "zod";
import { foldLegacyDraftBody } from "./legacy.ts";
import {
	AUTHORING_SCHEMA_VERSION,
	DRAFT_FIELD_GROUPS,
	DRAFT_GROUP_FIELDS,
	type DraftFieldRev,
	type DraftLoreEntry,
	type DraftSceneImage,
	type DraftStartScene,
	type StoryDraft,
} from "./model.ts";
import {
	draftRecoveryPayload,
	isRecoverableDraftFieldGroup,
	type RecoverableDraftFieldGroup,
} from "./recovery.ts";
import type {
	DraftRuntimeAsset,
	DraftRuntimeFile,
	DraftRuntimeProject,
} from "./runtime.ts";

/**
 * Authoring sync codec: the draft graph payload and the field-group merge.
 *
 * - Does not import @rowcat/sync (same reason as the chat codec). Conformance is checked by
 *   structural typing when the app passes the codec to the registry.
 * - One thing is unique to this file: the draft root is the only type in this repo that merges
 *   per field group. Example: device A edits the title on a phone while device B edits the scenario
 *   offline on a laptop. Record-level LWW would silently delete one of them, and the manuscript is
 *   the hardest asset in this product to recover.
 * - Stamps are not kept per field. The five groups match the editor's actual surfaces one to one,
 *   and fields in the same group are edited together on one screen.
 * - Two payload versions. The v1 payload is what devices not yet updated still send, so decoding
 *   folds it into a v2 record (`legacy.ts`). The reverse is not done: the engine ignores payloads
 *   above a codec's own version, so v1 devices never receive v2 drafts. That is correct, since an
 *   un-updated manuscript is better than a half-read one.
 */

export const AUTHORING_SYNC_SCHEMA_VERSION = AUTHORING_SCHEMA_VERSION;

export const AUTHORING_MERGE_NOTE = {
	/** Two devices edited the same group concurrently; one side's version is lost. */
	draftGroupConflict: "authoring_draft_group_conflict",
	/** The two `publishedStoryId` values point at different works. This state should never occur. */
	publicationDivergence: "authoring_publication_divergence",
	/**
	 * A remote update tried to clear the publication link to `null`; the monotonic rule blocked it.
	 */
	publicationRollbackBlocked: "authoring_publication_rollback_blocked",
} as const;

const later = (a: string, b: string): string => (a >= b ? a : b);

/**
 * HLC total order, the same rule as `compareRev` in @rowcat/sync. This is a contract.
 *
 * A copy lives here because this package cannot import @rowcat/sync (layer rule). The sameness is
 * enforced by a test rather than by this comment: `apps/web/src/lib/local-sync/codec-order.test.ts`
 * compares both implementations on random matrices and checks that they pick the same winner.
 *
 * Folding through `safeInt` is the core of that equivalence. NaN, negatives, or fractions make the
 * comparison non-total (`NaN !== NaN`, so swapping argument order flips the answer), and two
 * devices merging with a non-total clock reach different winners. The `Rev` contract already forces
 * integers and non-negatives for values that cross the boundary. Local storage rows skip that
 * validation (corrupt rows, old fixtures), and the engine already folds them. Without folding here,
 * the codec and the engine could disagree about the same record.
 */
const safeInt = (value: number): number =>
	Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

function compareRev(a: Rev, b: Rev): number {
	const at = safeInt(a.t);
	const bt = safeInt(b.t);
	if (at !== bt) return at < bt ? -1 : 1;
	const ac = safeInt(a.c);
	const bc = safeInt(b.c);
	if (ac !== bc) return ac < bc ? -1 : 1;
	if (a.d === b.d) return 0;
	return a.d < b.d ? -1 : 1;
}

const maxRev = (a: Rev, b: Rev): Rev => (compareRev(b, a) > 0 ? b : a);

interface DecodeInput {
	id: string;
	schemaVersion: number;
	rev: Rev;
	deletedAt: string | null;
	data: unknown;
}

/**
 * Merge channels reported to the caller. The shape matches `MergeContext` in @rowcat/sync.
 *
 * It is not imported, because of the layer rule: this package does not know the protocol.
 * Conformance is checked when the app passes the codec to the registry, so a mismatch fails
 * compilation at that point.
 *
 * The two channels carry different things. `note` only classifies and feeds diagnostics. `recover`
 * carries the lost value, which stops in this device's store.
 */
interface MergeCtx {
	note(code: string): void;
	recover(candidate: { scope: string; losingRev: Rev; payload: unknown }): void;
}

interface Merged<T> {
	record: T;
	remoteWins: boolean;
}

const INBOUND_META = { dirty: 0, serverVersion: 0 } as const;

const RevSchema = z.object({
	t: z.number().int().nonnegative(),
	c: z.number().int().nonnegative(),
	d: z.string().min(1),
});

/** All five groups must always be present. A missing group has nothing to merge against. */
const FieldRevSchema = z.object({
	meta: RevSchema,
	rating: RevSchema,
	body: RevSchema,
	defaults: RevSchema,
	publication: RevSchema,
});

/* ─────────────────────────────────────────────────────────────────────────────
 * authoring.draft
 * ──────────────────────────────────────────────────────────────────────────── */

const DraftCommon = {
	title: z.string(),
	tagline: z.string(),
	description: z.string(),
	tags: z.array(z.string()),
	/**
	 * `null` means explicitly unset. Folding it to `""` or a default would let an older version revert
	 * the setting.
	 */
	orientation: z.enum(ORIENTATIONS).nullable(),
	adult: z.boolean(),
	visibility: z.enum(STORY_VISIBILITIES),
	promptProtected: z.boolean(),
	defaultStartSceneId: z.string().nullable(),
	publishedStoryId: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
};

/**
 * v2: the authoring body is the single `prompt`. It has no default, so a missing value is never
 * invented.
 */
const DraftData = z.object({
	...DraftCommon,
	prompt: z.string(),
	fieldRev: FieldRevSchema,
});

/**
 * v1: the shape that devices which have not updated still send.
 *
 * Character cards are not here. They were a separate record (`authoring.character`), not part of
 * the draft payload. v2 has no codec for that type, so the engine ignores it entirely. A draft
 * arriving from a v1 device therefore never carries character cards through this path. Folding them
 * into the body is the local migration's job, on the device that holds the cards (web Dexie v9,
 * mobile SQLite). Nothing can be invented here, so the list folds to empty.
 *
 * `bodyMode` and `prompt` have defaults even within v1, because some payloads predate those fields
 * (before Dexie v7). Failing to decode them would turn the whole draft into a manuscript that
 * disappears from the screen.
 */
const LegacyDraftData = z.object({
	...DraftCommon,
	bodyMode: z.enum(["structured", "prompt"]).default("structured"),
	scenario: z.string(),
	playGuide: z.string(),
	prompt: z.string().default(""),
	suggestedPersona: z
		.object({ name: z.string(), description: z.string() })
		.nullable(),
	fieldRev: FieldRevSchema.extend({ persona: RevSchema }),
});

/**
 * v1 payload to v2 record.
 *
 * The only decision in this function: the `body` group's revision becomes the maximum of `body` and
 * `persona`. The folded body carries the content of both groups. Sending only the earlier revision
 * would let a newer persona edit on another device win this record and revert it to the pre-fold
 * state. Sending the later one means the revision already includes that edit, so no such revert
 * occurs.
 */
function fromLegacyDraft(
	data: z.infer<typeof LegacyDraftData>,
): Omit<z.infer<typeof DraftData>, never> {
	const { bodyMode, scenario, playGuide, suggestedPersona, fieldRev, ...rest } =
		data;
	return {
		...rest,
		prompt: foldLegacyDraftBody({
			bodyMode,
			prompt: data.prompt,
			scenario,
			playGuide,
			suggestedPersona,
			characters: [],
		}),
		fieldRev: {
			meta: fieldRev.meta,
			rating: fieldRev.rating,
			body: maxRev(fieldRev.body, fieldRev.persona),
			defaults: fieldRev.defaults,
			publication: fieldRev.publication,
		},
	};
}

/**
 * Decides whether the losing side's version actually disappears. This is the predicate that decides
 * whether a recovery copy is kept.
 *
 * It must be narrower than the diagnostic (`note`), and the reason is concrete. The diagnostic
 * counts 'group revisions diverged', which is also true for a merge that loses nothing. Example: A
 * edits only the title and B edits only the prompt. Both group revisions diverge, since each side
 * still holds the old version of the group the other changed.
 *
 * A copy saved there would notify the user about edits they never lost. It would also hold stale
 * values that side had already updated, so restoring it would lose the newer values.
 *
 * So the function looks for evidence of a common ancestor. If the losing side's group revision
 * appears unchanged somewhere in the winning side's `fieldRev`, both records inherited the same
 * write. A revision is the identity of one write, and every group touched by one save shares the
 * same value. The losing side has not touched that group since, so the winning side edited it while
 * already knowing the losing side's value. Nothing was lost.
 *
 * The reverse direction is not proof: no evidence does not always mean a conflict. Erring toward
 * reporting a conflict is the right direction. A stray copy can be deleted by the user, but a
 * manuscript that was not kept cannot be recovered. The one false positive left is narrow: the
 * winning side rewrote all five groups while the losing side only changed children.
 */
const sharesGroupRev = (record: StoryDraft, candidate: Rev): boolean =>
	DRAFT_FIELD_GROUPS.some(
		(group) => compareRev(record.fieldRev[group], candidate) === 0,
	);

/**
 * Same-group concurrent edit: counts the classification and keeps the values that would disappear.
 *
 * The two channels come out of one function on purpose. If they were split, one would eventually go
 * uncalled, and that omission is silent. A diagnostic-only path would lose the manuscript without a
 * trace; a copy-only path would hide how often the event happens. The two channels' conditions are
 * not the same, though: the predicate above is the whole difference.
 *
 * Which side loses depends on the direction. Keeping a copy only when the incoming side wins would
 * hide half the losses. Each device has to hold the version it lost on its own side, so the user
 * can find the lost value from either device.
 *
 *   order > 0  remote takes the group, so the local value is lost
 *   order < 0  local keeps the group, so the remote value is lost
 *
 * Which revision identifies the copy (`losingRev`) is also set here. The same loss yields the same
 * value no matter how many times it is re-seen, so retries, reconnects, and restarts collapse the
 * copies into one.
 */
function reportGroupConflict(
	local: StoryDraft,
	remote: StoryDraft,
	group: RecoverableDraftFieldGroup,
	order: number,
	context: MergeCtx,
): void {
	/**
	 * The diagnostic stays as is. It counts the fact that group revisions diverged, which is broader
	 * than the recovery condition.
	 */
	context.note(AUTHORING_MERGE_NOTE.draftGroupConflict);
	const losing = order > 0 ? local : remote;
	const winning = order > 0 ? remote : local;
	if (sharesGroupRev(winning, losing.fieldRev[group])) return;
	context.recover({
		scope: group,
		losingRev: losing.fieldRev[group],
		payload: draftRecoveryPayload(losing, group),
	});
}

export const storyDraftSyncCodec = {
	type: "authoring.draft",
	schemaVersion: AUTHORING_SYNC_SCHEMA_VERSION,

	encode(record: StoryDraft): unknown {
		return {
			title: record.title,
			tagline: record.tagline,
			description: record.description,
			tags: record.tags,
			orientation: record.orientation,
			adult: record.adult,
			visibility: record.visibility,
			promptProtected: record.promptProtected,
			prompt: record.prompt,
			defaultStartSceneId: record.defaultStartSceneId,
			publishedStoryId: record.publishedStoryId,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			fieldRev: record.fieldRev,
		};
	},

	/**
	 * Splits by version. The engine only sends payloads at or below this codec's version.
	 *
	 * The point is not to guess from shape. Checking `"scenario" in data` could misfire: a v2 draft's
	 * folded body might accidentally contain that key, and such a rule would flip on one corrupt row.
	 * The envelope states the version.
	 */
	decode(input: DecodeInput): StoryDraft | null {
		const data =
			input.schemaVersion < 2
				? (() => {
						const legacy = LegacyDraftData.safeParse(input.data);
						return legacy.success ? fromLegacyDraft(legacy.data) : null;
					})()
				: (DraftData.safeParse(input.data).data ?? null);
		if (!data) return null;
		return {
			id: input.id,
			schemaVersion: AUTHORING_SCHEMA_VERSION,
			...data,
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},

	/**
	 * Group merge: for each group g, the side with the higher `fieldRev[g]` takes only that group's
	 * fields.
	 *
	 * The result `rev` is the maximum of the two record revisions. Not deriving it from
	 * `max(fieldRev)` is the distinction fixed in 1a:
	 *
	 *   rev          the last revision that touched this record. Child activity also advances it.
	 *   fieldRev[g]  the last revision where group g's authoring fields actually changed.
	 *
	 * Editing a child (lore or scene) raises the draft's `updatedAt` and `rev`, but no authoring group
	 * changes. Using `max(fieldRev)` as the result would erase that activity revision, so the next
	 * merge would treat an already-seen version as unseen.
	 */
	merge(
		local: StoryDraft,
		remote: StoryDraft,
		context: MergeCtx,
	): Merged<StoryDraft> {
		const merged: StoryDraft = { ...local };
		/**
		 * Fields are moved by name, so index access is needed here. The type is widened once in this
		 * function, and only `StoryDraft` leaves it. The group table (`GROUP_FIELDS`) is narrowed to
		 * `keyof StoryDraft`, so a nonexistent field cannot be listed at all.
		 */
		const assign = merged as unknown as Record<string, unknown>;
		const fieldRev: DraftFieldRev = { ...local.fieldRev };
		let remoteTookAll = true;

		for (const group of DRAFT_FIELD_GROUPS) {
			const order = compareRev(remote.fieldRev[group], local.fieldRev[group]);
			/**
			 * This detects, here, whether the two devices each edited the same group. Optimistic concurrency
			 * already provides the detection axis: if the local side is dirty and a group revision diverged,
			 * both devices diverged from the same server version and wrote separately.
			 *
			 * The signal is emitted whichever side wins. A lost version is the event, and that event does
			 * not happen only on the winning side. There are two outputs with different conditions. The
			 * diagnostic counts exactly this condition. The local recovery copy narrows it further
			 * (`reportGroupConflict`).
			 *
			 * `publication` is excluded. That group is monotonic, so it is not a conflict in which a losing
			 * version disappears. It is handled separately below.
			 */
			if (
				order !== 0 &&
				local.dirty === 1 &&
				isRecoverableDraftFieldGroup(group)
			)
				reportGroupConflict(local, remote, group, order, context);
			if (order < 0) {
				remoteTookAll = false;
				continue;
			}
			if (order === 0) {
				/**
				 * A matching group revision means the same write on the same device (the device id is part of
				 * `rev`). The content is identical too, so either side produces the same result.
				 */
				continue;
			}
			for (const field of DRAFT_GROUP_FIELDS[group])
				assign[field] = remote[field];
			fieldRev[group] = remote.fieldRev[group];
		}

		/**
		 * The publication link is monotonic. Once a draft is published, an old copy from another device
		 * must not revert it to 'unpublished'. Otherwise the user loses the ability to update that work
		 * and would publish the same manuscript twice.
		 */
		if (local.publishedStoryId !== null && merged.publishedStoryId === null) {
			merged.publishedStoryId = local.publishedStoryId;
			fieldRev.publication = maxRev(
				local.fieldRev.publication,
				remote.fieldRev.publication,
			);
			remoteTookAll = false;
			context.note(AUTHORING_MERGE_NOTE.publicationRollbackBlocked);
		} else if (
			local.publishedStoryId !== null &&
			remote.publishedStoryId !== null &&
			local.publishedStoryId !== remote.publishedStoryId
		) {
			// Both are non-null and differ. The normal path cannot produce this state, so it is folded
			// deterministically by HLC.
			context.note(AUTHORING_MERGE_NOTE.publicationDivergence);
		}

		const updatedAt = later(local.updatedAt, remote.updatedAt);
		const rev = maxRev(local.rev, remote.rev);
		const record: StoryDraft = { ...merged, fieldRev, updatedAt, rev };
		return {
			record,
			remoteWins:
				remoteTookAll &&
				updatedAt === remote.updatedAt &&
				compareRev(rev, remote.rev) === 0,
		};
	},

	revOf: (record: StoryDraft): Rev => record.rev,
};

/**
 * Children are not group-merged. They have few fields, edited together within one card, so there is
 * no natural boundary for groups. A loss is also a single revision of one card, so group merge here
 * would add more complexity than it gains.
 */
function childMerge<
	T extends { rev: Rev; dirty: 0 | 1; serverVersion: number },
>(local: T, remote: T): Merged<T> {
	const remoteWins = compareRev(remote.rev, local.rev) >= 0;
	return {
		record: remoteWins
			? { ...remote, dirty: local.dirty, serverVersion: local.serverVersion }
			: local,
		remoteWins,
	};
}

const LoreData = z.object({
	draftId: z.string(),
	positionIndex: z.number().int(),
	keys: z.array(z.string()),
	content: z.string(),
	constant: z.boolean(),
	position: z.enum(CHAT_LORE_POSITIONS),
	order: z.number().int(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const draftLoreSyncCodec = {
	type: "authoring.lore",
	schemaVersion: AUTHORING_SYNC_SCHEMA_VERSION,
	encode: (record: DraftLoreEntry): unknown => ({
		draftId: record.draftId,
		positionIndex: record.positionIndex,
		keys: record.keys,
		content: record.content,
		constant: record.constant,
		position: record.position,
		order: record.order,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	}),
	decode(input: DecodeInput): DraftLoreEntry | null {
		const parsed = LoreData.safeParse(input.data);
		if (!parsed.success) return null;
		return {
			id: input.id,
			...parsed.data,
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},
	merge: (
		local: DraftLoreEntry,
		remote: DraftLoreEntry,
	): Merged<DraftLoreEntry> => childMerge(local, remote),
	revOf: (record: DraftLoreEntry): Rev => record.rev,
};

const StartSceneData = z.object({
	draftId: z.string(),
	position: z.number().int(),
	title: z.string(),
	content: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/**
 * Scene image: one reference and one trigger word, so merging is simple.
 *
 * There is no per-field merge here (only the draft root has one). If two devices each edited the
 * trigger and the asset of the same entry, that is 'a different name on a different picture', which
 * cannot be mixed. Mixing would leave a combination nobody chose, so the side with the larger
 * revision is taken whole.
 */
const SceneImageData = z.object({
	draftId: z.string(),
	position: z.number().int(),
	trigger: z.string(),
	assetId: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const draftSceneImageSyncCodec = {
	type: "authoring.sceneImage",
	schemaVersion: AUTHORING_SYNC_SCHEMA_VERSION,
	encode: (record: DraftSceneImage): unknown => ({
		draftId: record.draftId,
		position: record.position,
		trigger: record.trigger,
		assetId: record.assetId,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	}),
	decode(input: DecodeInput): DraftSceneImage | null {
		const parsed = SceneImageData.safeParse(input.data);
		if (!parsed.success) return null;
		return {
			id: input.id,
			...parsed.data,
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},
	merge: (
		local: DraftSceneImage,
		remote: DraftSceneImage,
	): Merged<DraftSceneImage> => childMerge(local, remote),
	revOf: (record: DraftSceneImage): Rev => record.rev,
};

export const draftStartSceneSyncCodec = {
	type: "authoring.scene",
	schemaVersion: AUTHORING_SYNC_SCHEMA_VERSION,
	encode: (record: DraftStartScene): unknown => ({
		draftId: record.draftId,
		position: record.position,
		title: record.title,
		content: record.content,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	}),
	decode(input: DecodeInput): DraftStartScene | null {
		const parsed = StartSceneData.safeParse(input.data);
		if (!parsed.success) return null;
		return {
			id: input.id,
			...parsed.data,
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},
	merge: (
		local: DraftStartScene,
		remote: DraftStartScene,
	): Merged<DraftStartScene> => childMerge(local, remote),
	revOf: (record: DraftStartScene): Rev => record.rev,
};

const RuntimeProjectData = z.object({
	draftId: z.string(),
	enabled: z.boolean(),
	entry: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/**
 * Runtime project: one per draft, so merging is also per record.
 *
 * It has two fields, and one of them (`enabled`) is effectively the whole record. A field-level
 * merge would produce two revisions with the same result. If two devices each enabled or disabled
 * it, the later one wins. That is the precise meaning of this axis: whoever last decided it.
 */
export const draftRuntimeProjectSyncCodec = {
	type: "authoring.runtimeProject",
	schemaVersion: AUTHORING_SYNC_SCHEMA_VERSION,
	encode: (record: DraftRuntimeProject): unknown => ({
		draftId: record.draftId,
		enabled: record.enabled,
		entry: record.entry,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	}),
	decode(input: DecodeInput): DraftRuntimeProject | null {
		const parsed = RuntimeProjectData.safeParse(input.data);
		if (!parsed.success) return null;
		return {
			id: input.id,
			...parsed.data,
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},
	merge: (
		local: DraftRuntimeProject,
		remote: DraftRuntimeProject,
	): Merged<DraftRuntimeProject> => childMerge(local, remote),
	revOf: (record: DraftRuntimeProject): Rev => record.rev,
};

const RuntimeFileData = z.object({
	draftId: z.string(),
	path: z.string(),
	content: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/**
 * Runtime file: one path and one body.
 *
 * No field-level merge. The reason is especially clear here: if two devices each changed the path
 * and the content of one file, that is 'a moved file' and 'an edited file'. Mixing them would leave
 * a combination nobody created (new path plus old body). The side with the larger revision is taken
 * whole.
 *
 * The losing side's body disappearing is a problem the draft root already has an answer to
 * (`recovery.ts`). This slice does not extend that recovery to code files, because the value type
 * of a recovery copy is `StoryDraftPatch`. Giving that type a place for files would reopen the
 * recovery model, which is a separate decision.
 */
export const draftRuntimeFileSyncCodec = {
	type: "authoring.runtimeFile",
	schemaVersion: AUTHORING_SYNC_SCHEMA_VERSION,
	encode: (record: DraftRuntimeFile): unknown => ({
		draftId: record.draftId,
		path: record.path,
		content: record.content,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	}),
	decode(input: DecodeInput): DraftRuntimeFile | null {
		const parsed = RuntimeFileData.safeParse(input.data);
		if (!parsed.success) return null;
		return {
			id: input.id,
			...parsed.data,
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},
	merge: (
		local: DraftRuntimeFile,
		remote: DraftRuntimeFile,
	): Merged<DraftRuntimeFile> => childMerge(local, remote),
	revOf: (record: DraftRuntimeFile): Rev => record.rev,
};

const RuntimeAssetData = z.object({
	draftId: z.string(),
	path: z.string(),
	assetId: z.string(),
	mime: z.string(),
	/**
	 * All three are optional, and an absent value means something different for each.
	 *
	 *   kind absent        an old device's record; the only asset type then was image, so image
	 *   width absent       audio (or a corrupt old image record; see below)
	 *   durationMs absent  image
	 *
	 * Making them required would make old envelopes fail decoding. In this codec a failure means the
	 * asset never reaches this device: an image bound on the Mac would vanish on the phone, and the
	 * phone's next push would upload the draft without it.
	 */
	kind: z.enum(["image", "audio"]).optional(),
	width: z.number().nullable().optional(),
	height: z.number().nullable().optional(),
	durationMs: z.number().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/**
 * Folds the envelope into the record's shape. This is the only place where missing values are
 * filled.
 *
 * An absent `kind` means image (see the schema above). Once the kind is known, the opposite side's
 * columns are cleared. An envelope where audio carries dimensions, or an image carries a duration,
 * is a shape this code never creates. Storing such values as they are would make this device's list
 * state different facts.
 */
function foldRuntimeAssetData(
	data: z.infer<typeof RuntimeAssetData>,
): Pick<
	DraftRuntimeAsset,
	| "draftId"
	| "path"
	| "kind"
	| "assetId"
	| "mime"
	| "width"
	| "height"
	| "durationMs"
	| "createdAt"
	| "updatedAt"
> {
	const kind = data.kind ?? "image";
	return {
		draftId: data.draftId,
		path: data.path,
		kind,
		assetId: data.assetId,
		mime: data.mime,
		width: kind === "image" ? (data.width ?? null) : null,
		height: kind === "image" ? (data.height ?? null) : null,
		durationMs: kind === "audio" ? (data.durationMs ?? null) : null,
		createdAt: data.createdAt,
		updatedAt: data.updatedAt,
	};
}

/**
 * Managed image: one logical name and one media reference.
 *
 * No field-level merge, for the same reason as the file codec. If two devices each changed the name
 * and the picture of the same asset, that is 'renamed' and 'swapped the picture'. Mixing them would
 * leave a combination nobody created (new name plus old picture). The dimensions and format sit in
 * the same record as `assetId`, and the whole record is taken as one value, so those four values
 * cannot diverge.
 *
 * Bytes do not travel in this envelope. Only one media identity goes out. The image already lives
 * in RowCat media regardless of publication (`POST /v2/me/runtime-assets`). The scene image made
 * the same decision for the same reason: base64 wrapped in base64 inflates the envelope about 1.8x,
 * and the same picture would be duplicated once per draft.
 */
export const draftRuntimeAssetSyncCodec = {
	type: "authoring.runtimeAsset",
	schemaVersion: AUTHORING_SYNC_SCHEMA_VERSION,
	encode: (record: DraftRuntimeAsset): unknown => ({
		draftId: record.draftId,
		path: record.path,
		/**
		 * Always written, even for images.
		 *
		 * Omitting it for images would shorten the envelope, but then an old device's record and a new
		 * device's image would share one shape. Today the two mean the same thing, so this is harmless.
		 * When a third media type arrives, the distinction becomes necessary, and by then the envelopes
		 * already stored cannot be rewritten.
		 */
		kind: record.kind,
		assetId: record.assetId,
		mime: record.mime,
		width: record.width,
		height: record.height,
		durationMs: record.durationMs,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	}),
	decode(input: DecodeInput): DraftRuntimeAsset | null {
		const parsed = RuntimeAssetData.safeParse(input.data);
		if (!parsed.success) return null;
		return {
			id: input.id,
			...foldRuntimeAssetData(parsed.data),
			deletedAt: input.deletedAt,
			rev: input.rev,
			...INBOUND_META,
		};
	},
	merge: (
		local: DraftRuntimeAsset,
		remote: DraftRuntimeAsset,
	): Merged<DraftRuntimeAsset> => childMerge(local, remote),
	revOf: (record: DraftRuntimeAsset): Rev => record.rev,
};

/**
 * The list the app passes to the registry. Parents come first.
 *
 * `authoring.character` is absent in v2. A type without a codec is ignored by the engine, which
 * only advances the cursor (see §19), so person records uploaded by devices not yet updated pass
 * through this device silently. Those records are not overwritten with tombstones, because deleting
 * them requires uploading first. Deletion propagates only by rewriting the record, and that would
 * send the private content already folded into the body to the server once more. What stays on the
 * server is ciphertext nobody reads, and account deletion wipes the whole namespace.
 */
export const authoringSyncCodecs = [
	storyDraftSyncCodec,
	draftLoreSyncCodec,
	draftStartSceneSyncCodec,
	/**
	 * Adding a type does not break compatibility. The list first used this promise for memory
	 * (`chat.memory`), and this is the second use. The server has no type vocabulary. An old device
	 * that does not know the type ignores those records and only advances its cursor.
	 */
	draftSceneImageSyncCodec,
	/**
	 * Runtime: the third slot where two types were added (the earlier two are `chat.memory` and
	 * `authoring.sceneImage`).
	 *
	 * Project before files follows this list's rule (parents first). The receiving device does not
	 * rely on the order, but when the order is right, a file without a project never exists, even
	 * briefly.
	 */
	draftRuntimeProjectSyncCodec,
	draftRuntimeFileSyncCodec,
	/**
	 * Managed image: the fourth slot of the same promise. Coming after files is for the reader's sake,
	 * not a rule of the list. Assets are siblings of files, not children of them. Both are children of
	 * the project.
	 */
	draftRuntimeAssetSyncCodec,
];
