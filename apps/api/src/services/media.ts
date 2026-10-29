import { MEDIA_ERROR_CODE, type MediaKind } from "@rowcat/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { media, member } from "../db/schema.ts";
import { publicApiUrl } from "../env.ts";
import { ApiError } from "../lib/errors.ts";
import { newId } from "../lib/id.ts";
import type { ValidatedAudio } from "../lib/media/audio.ts";
import type { NormalizedImage } from "../lib/media/image.ts";
import { resolveMediaStore } from "../lib/media/postgres-store.ts";
import { buildStorageKey } from "../lib/media/storage.ts";

/**
 * Media lifecycle: storage, ownership, cleanup. Knows nothing about the storage backend,
 * normalization (`lib/media/image.ts`) or HTTP.
 *
 * Upload spans two stores (bytes in the blob store, metadata in Postgres) with no transaction
 * covering both, so a failure must pick a direction. Create and delete both write bytes first, then
 * the row, so a failure leaves an orphan that a query can still find (`findOrphanedAvatarMedia`);
 * that is why the storage port has no `list()`. Row-first is worse both ways: creating would leave
 * a profile pointing at missing bytes (broken image), deleting would leave bytes with no record
 * that could ever locate them.
 *
 * Ownership is pinned in the delete predicate (`id = :id AND owner = :ownerId`), not a
 * read-then-delete: someone else's media deletes 0 rows and becomes the same 404 as a missing one,
 * so the path is not an existence probe.
 */

const store = resolveMediaStore();

/**
 * Public URL of one media, derived from the id and never stored (a stored copy would go stale when
 * a deployment changes origin or path rules).
 *
 * No `?v=` cache buster, unlike covers: a cover URL is fixed while its bytes change, whereas a new
 * avatar gets a new media id and so a new URL. The address is inherently immutable, so the route
 * can attach one-year `immutable` unconditionally.
 */
export const mediaUrl = (mediaId: string): string =>
	`${publicApiUrl}/media/${encodeURIComponent(mediaId)}`;

export interface MediaRecord {
	id: string;
	/**
	 * NULL is a published asset that outlived its owner's account (`db/tables/media.ts`). Ownership
	 * checks compare with equality, so such a row belongs to nobody (fail-closed).
	 */
	owner: string | null;
	kind: string;
	mime: string;
	/** Visual dimensions; `null` for audio. Nullable rather than optional so "not read yet" and "does not apply" are not one shape. */
	width: number | null;
	height: number | null;
	durationMs: number | null;
	byteSize: number;
	storageKey: string;
}

export const MEDIA_COLUMNS = {
	id: media.id,
	owner: media.owner,
	kind: media.kind,
	mime: media.mime,
	width: media.width,
	height: media.height,
	durationMs: media.duration_ms,
	byteSize: media.byte_size,
	storageKey: media.storage_key,
};

/**
 * Dimensions of a visual media row; a missing value is an invariant violation. `width`/`height` are
 * nullable only for audio and every image write path fills both, so absence means our write path
 * broke. Not folded with `?? 0` (the screen would reserve zero space, seen only as occasional
 * layout oddities) and not an `ApiError` (nothing to tell the user).
 */
export function imageDimensionsOf(record: MediaRecord): {
	width: number;
	height: number;
} {
	if (record.width === null || record.height === null)
		throw new Error(`[media] visual media has no dimensions: ${record.id}`);
	return { width: record.width, height: record.height };
}

/**
 * The medium of each kind. `Record<MediaKind, …>` means adding a kind without deciding image vs
 * audio here breaks compilation, and `createMedia` has no branch for it otherwise.
 *
 * Decided by kind, not MIME: what the bytes parse as and why the media was uploaded are different
 * axes, and only the latter answers "did this person choose to put it here".
 */
export const MEDIA_MEDIUM = {
	avatar: "image",
	story_cover: "image",
	scene_image: "image",
	runtime_image: "image",
	runtime_audio: "audio",
} as const satisfies Record<MediaKind, "image" | "audio">;

type MediaKindOfMedium<M extends "image" | "audio"> = {
	[K in MediaKind]: (typeof MEDIA_MEDIUM)[K] extends M ? K : never;
}[MediaKind];

export type ImageMediaKind = MediaKindOfMedium<"image">;
export type AudioMediaKind = MediaKindOfMedium<"audio">;

/**
 * The kind is the discriminant, so `{ kind: "runtime_audio", image }` and `{ kind: "runtime_image",
 * audio }` are not expressible. Without that they typed fine and produced a row whose kind lies
 * about its bytes; the publication predicate checks ownership and kind only, so image bytes would
 * be published as sound, visible only at playback.
 *
 * The `?: never` lines block requests carrying both payloads: a union's excess-property check
 * accepts any branch's keys, so `mediaMetadataOf` would otherwise drop one silently.
 */
export type CreateMediaInput =
	| {
			ownerId: string;
			kind: ImageMediaKind;
			image: NormalizedImage;
			audio?: never;
	  }
	| {
			ownerId: string;
			kind: AudioMediaKind;
			audio: ValidatedAudio;
			image?: never;
	  };

/**
 * Decides by `MEDIA_MEDIUM[kind]`, not by `"image" in input`: the kind sets the medium and the
 * payload follows, and a payload check silently picks wrong once a branch is added.
 */
const isAudioMediaInput = (
	input: CreateMediaInput,
): input is Extract<CreateMediaInput, { audio: ValidatedAudio }> =>
	MEDIA_MEDIUM[input.kind] === "audio";

function mediaMetadataOf(input: CreateMediaInput): {
	bytes: Buffer;
	mime: string;
	width: number | null;
	height: number | null;
	durationMs: number | null;
} {
	if (isAudioMediaInput(input))
		return {
			bytes: input.audio.bytes,
			mime: input.audio.mime,
			width: null,
			height: null,
			durationMs: input.audio.durationMs,
		};
	return {
		bytes: input.image.bytes,
		mime: input.image.mime,
		width: input.image.width,
		height: input.image.height,
		durationMs: null,
	};
}

/**
 * Stores the bytes and inserts the media row. Does not link it anywhere: the caller moves its own
 * pointer (e.g. the avatar) in its own transaction and owns cleanup if that fails
 * (`services/account/avatar.ts`), since a second consumer would touch a different row.
 *
 * A storage failure is a 5xx with our own sentence; vendor text can carry bucket names, internal
 * paths and credential hints.
 */
export async function createMedia(
	input: CreateMediaInput,
): Promise<MediaRecord> {
	const metadata = mediaMetadataOf(input);
	const mediaId = newId();
	const storageKey = buildStorageKey({
		kind: input.kind,
		ownerId: input.ownerId,
		mediaId,
		mime: metadata.mime,
	});

	/** Bytes first: a row first would leave a row pointing at missing bytes, a broken image once linked. */
	try {
		await store.put(storageKey, metadata.bytes, metadata.mime);
	} catch (error) {
		/**
		 * Vendor error text goes to the log only. Log the diagnostic axes, never bytes or file names
		 * (someone else's photo).
		 */
		console.error("[media] failed to store", {
			ownerId: input.ownerId,
			kind: input.kind,
			byteSize: metadata.bytes.byteLength,
			stage: "store-put",
			error: String(error),
		});
		throw new ApiError(
			503,
			MEDIA_ERROR_CODE.storageFailed,
			"Couldn't save the image. Please try again in a moment.",
		);
	}

	try {
		const [row] = await db
			.insert(media)
			.values({
				id: mediaId,
				owner: input.ownerId,
				kind: input.kind,
				mime: metadata.mime,
				width: metadata.width,
				height: metadata.height,
				duration_ms: metadata.durationMs,
				byte_size: metadata.bytes.byteLength,
				storage_key: storageKey,
				status: "ready",
			})
			.returning(MEDIA_COLUMNS);
		if (!row) throw new Error("[media] insert returned no row");
		return row;
	} catch (cause) {
		/**
		 * No row means the bytes just written are unreferenced. Deleting them is best effort, and this is
		 * the one point in the pipeline where an orphan can leave no trace for a query to find. The order
		 * is not reversed for that: row-first yields visible broken avatars, and an untraceable blob is
		 * the lesser harm. A cleanup failure is swallowed so the original error reaches the caller.
		 */
		await store.delete(storageKey).catch((cleanupError) => {
			console.error("[media] orphan cleanup failed", {
				storageKey,
				stage: "create-rollback",
				error: String(cleanupError),
			});
		});
		throw cause;
	}
}

/**
 * The exportable media, or `null` if missing or not `ready`. The `status = 'ready'` predicate is
 * where a later safety check will plug in; having it now makes that a one-place change.
 *
 * Takes no viewer: avatars render the same for everyone, and a viewer argument would personalize
 * the response and break the shared cache. A private media kind would add its gate here via `kind`.
 */
export async function getReadableMedia(
	mediaId: string,
): Promise<MediaRecord | null> {
	const [row] = await db
		.select(MEDIA_COLUMNS)
		.from(media)
		.where(and(eq(media.id, mediaId), eq(media.status, "ready")))
		.limit(1);
	return row ?? null;
}

/** Fetches bytes from the store; a dangling pointer (row without bytes) is `null`. */
export const readMediaBytes = (record: MediaRecord): Promise<Buffer | null> =>
	store.get(record.storageKey);

/**
 * Reads `[start, endExclusive)`. Falls back to reading everything and slicing when the adapter has
 * no range support; the fallback lives here so range correctness does not vary by adapter.
 */
export async function readMediaRange(
	record: MediaRecord,
	start: number,
	endExclusive: number,
): Promise<Buffer | null> {
	if (store.getRange)
		return store.getRange(record.storageKey, start, endExclusive);
	const whole = await store.get(record.storageKey);
	return whole === null ? null : whole.subarray(start, endExclusive);
}

/**
 * Fully deletes one media, bytes first then row (see the header). Any failed step leaves the row so
 * the next cleanup finds it again.
 *
 * Callers must ensure nothing points at this media first. Relying on the FK's `set null` to clear a
 * live avatar pointer works but hides that a referenced media was deleted.
 *
 * Failures are swallowed and reported as `false`: every caller is cleanup, which must not fail the
 * user's operation.
 */
export async function purgeMedia(record: MediaRecord): Promise<boolean> {
	try {
		await store.delete(record.storageKey);
	} catch (error) {
		console.error("[media] failed to delete bytes", {
			mediaId: record.id,
			stage: "purge-blob",
			error: String(error),
		});
		/**
		 * Bytes not deleted means the row stays: deleting it would orphan the blob with no record to find
		 * it, and keeping the row is what makes a retry possible.
		 */
		return false;
	}

	try {
		await db.delete(media).where(eq(media.id, record.id));
		return true;
	} catch (error) {
		console.error("[media] failed to delete the row", {
			mediaId: record.id,
			stage: "purge-row",
			error: String(error),
		});
		return false;
	}
}

/**
 * Deletes only bytes, for keys whose rows are already gone. Account-deletion path: the
 * `media.owner` FK cascade removed the rows, and `purgeMedia` would issue a pointless DELETE per
 * member.
 *
 * Returns the count because the deletion summary records it; this cleanup runs outside the
 * transaction and fails quietly. Continues past a failure, since the cause is usually that one key.
 */
export async function purgeMediaBytes(
	items: readonly { id: string; storageKey: string }[],
): Promise<number> {
	let purged = 0;
	for (const item of items) {
		try {
			await store.delete(item.storageKey);
			purged += 1;
		} catch (error) {
			console.error("[media] account deletion cleanup failed", {
				mediaId: item.id,
				stage: "account-deletion",
				error: String(error),
			});
		}
	}
	return purged;
}

/**
 * Finds avatar media nobody points at. It queries `media` rather than scanning the store, which
 * would need `list()` on the port, adapter-specific pagination, and would misread a normal
 * mid-upload state as an orphan.
 *
 * The grace period exists for that last case: media created but not yet linked to the profile is a
 * normal moment (the two are not one transaction).
 *
 * Run daily by `jobs/media/cleanup-orphans.ts`. The real cleanup is the immediate one in the
 * replace/delete paths; this only catches their failures.
 *
 * Locked to `avatar` as a safeguard: `scene_image` references live in devices' E2EE drafts and
 * published snapshots, so the server cannot say nobody points at them.
 */
export const ORPHAN_AVATAR_GRACE_HOURS = 24;

export async function findOrphanedAvatarMedia(options?: {
	olderThanHours?: number;
	limit?: number;
	/** Grace cutoff reference time; defaults to the DB's `now()`. */
	now?: Date;
}): Promise<MediaRecord[]> {
	const hours = options?.olderThanHours ?? ORPHAN_AVATAR_GRACE_HOURS;
	const cutoff = options?.now
		? sql`${new Date(options.now.getTime() - hours * 3_600_000)}`
		: sql`now() - make_interval(hours => ${hours})`;
	return db
		.select(MEDIA_COLUMNS)
		.from(media)
		.leftJoin(member, eq(member.avatar_media_id, media.id))
		.where(
			and(
				eq(media.kind, "avatar"),
				isNull(member.id),
				sql`${media.created_at} < ${cutoff}`,
			),
		)
		.orderBy(media.created_at)
		.limit(options?.limit ?? 100);
}

/**
 * Whether the media is still an orphan, asked again right before deleting: a batch's worth of time
 * separates building the candidate list from deleting its last item. Age is not rechecked; it was
 * answered when candidates were picked.
 */
export async function isAvatarMediaOrphaned(mediaId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: media.id })
		.from(media)
		.leftJoin(member, eq(member.avatar_media_id, media.id))
		.where(
			and(eq(media.id, mediaId), eq(media.kind, "avatar"), isNull(member.id)),
		)
		.limit(1);
	return Boolean(row);
}

/**
 * Scalar subquery for the member's current avatar media id. A subquery rather than a join because
 * three consumers (public profile, comment author, notification actor) each have their own join
 * graph, and three `LEFT JOIN media` copies would let one drop the `status` condition, which shows
 * up only as a broken image. `status = 'ready'` here also means media held in `pending` by a later
 * safety check gets no URL at all, instead of a URL the route then blocks. `followers` has the same
 * shape (`services/account/profile.ts`).
 */
export const memberAvatarMediaId = sql<
	string | null
>`(select ${media.id} from ${media} where ${media.id} = ${member.avatar_media_id} and ${media.status} = 'ready')`;

/**
 * Avatar URL: media first, legacy column as fallback. `member.avatar_url` (`db/tables/member.ts`)
 * has no write path left but stays readable because the database may hold more than the code knows;
 * drop the column once a query confirms it is empty. Legacy must not come first, or a member with
 * an old value would never see a newly uploaded avatar. `""` folds to null (repo convention:
 * unspecified is null, not an empty string).
 */
export const avatarUrlOf = (
	mediaId: string | null,
	legacyUrl: string,
): string | null => (mediaId ? mediaUrl(mediaId) : legacyUrl || null);
