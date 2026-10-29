import { sql } from "drizzle-orm";
import {
	customType,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { member } from "./member.ts";

/** drizzle has no built-in bytea; minimal definition exchanging Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => "bytea",
});

/**
 * User-uploaded media: source of truth for metadata. It answers whose the bytes are, what they are
 * used as, and where they live; only the server writes any of them
 * (`packages/contracts/src/media.ts`).
 *
 * Not a string column on the member row: a string carries no ownership, replacing by overwrite
 * makes the intermediate state a loss, and old bytes become permanent orphans. As a record,
 * ownership is a column, replacement is "create a new row and move the pointer" (a failure leaves
 * the old row), and orphans are rows nobody points at, findable by query.
 *
 * There is no `bytes` column; bytes sit behind the `MediaBlobStore` port (`lib/media/storage.ts`),
 * currently backed by `media_blob` below. Swapping that adapter for S3/R2 changes nothing here,
 * with `storage_key` becoming the object key. `public_url` is not stored: it derives from `id`, and
 * a stored copy would go stale when the origin or path rules change (same reason covers derive
 * `coverUrl`).
 *
 * Covers did not move here: `story_cover` already gets ownership from the `story_id` FK, cache
 * identity from the generated `version` column and atomicity from being one tuple, and moving live
 * covers buys nothing. What is shared is the validation/normalization boundary
 * (`lib/media/image.ts`); two copies would diverge with the looser one becoming the vulnerability.
 */
export const media = pgTable(
	"media",
	{
		id: text("id").primaryKey(),
		/**
		 * Owner. Nullable: NULL means a published asset that survived the owner's account deletion.
		 *
		 * It used to be NOT NULL on the premise that uploaded media has no retention reason; that was
		 * wrong, since a story someone bought permanently keeps its scene images after the creator leaves
		 * (the same reason `story.owner` is nullable), and losing only the images would be silent (the
		 * conversation opens, only the picture slot 404s). Authorization predicates are all `owner =
		 * :viewer`, and SQL's WHERE does not treat NULL as true, so ownerless rows drop out
		 * (fail-closed); nobody can reuse or delete them. Do not build `owner <> :viewer` or `NOT IN`
		 * shapes over this column; that flips the judgement.
		 *
		 * `onDelete: cascade` stays on purpose: account deletion first detaches the media a `story_media`
		 * row still points at (sets NULL) and leaves the rest to cascade, so a new kind that fits no
		 * category is deleted rather than left behind as ownerless personal data. Bytes are deleted
		 * separately by the deletion service, because DB cascade does not know the object store
		 * (`services/account/deletion.ts`).
		 */
		owner: text("owner").references(() => member.id, { onDelete: "cascade" }),
		/**
		 * What the media is used as. Policy differs per kind (limits, output size, cropping in
		 * `lib/media/policy.ts`), and the row must remember which rules normalized these bytes. `text`
		 * rather than `pgEnum` so a larger vocabulary needs no migration; authority is the contract's
		 * `MediaKind`, checked before writing (unlike cover `visibility`, which SQL predicates compare
		 * directly).
		 */
		kind: text("kind").notNull(),
		/**
		 * Actual format of the normalized stored bytes, not the request's claimed `Content-Type`. The
		 * upload boundary decodes and re-encodes to one format (`lib/media/image.ts`); copying the
		 * client's claim would store a JPEG labelled `image/png` and make browsers sniff bytes that
		 * disagree with the header.
		 */
		mime: text("mime").notNull(),
		/**
		 * Dimensions after normalization (the original size is not kept; nothing reads it). Returned so
		 * the screen can reserve space and avoid layout shift.
		 *
		 * NULL on audio rows. NOT NULL used to hold because every consumer was an image; with audio it
		 * would force a lie (0 means "an image 0 wide", which the screen would then reserve). The schema
		 * loosened but the invariant moved to the services: `createMedia` in `services/media.ts` is the
		 * only INSERT, and its input is a union discriminated by kind, so `{ kind: "runtime_audio", image
		 * }` does not type-check. `services/media-kind.test.ts` covers the type,
		 * `routes/me/runtime-assets.test.ts` and `routes/me/runtime-audio.test.ts` the row shapes.
		 */
		width: integer("width"),
		height: integer("height"),
		/**
		 * Audio duration in milliseconds; NULL for visual media. Separate from `byte_size` because a
		 * low-bitrate multi-hour file is small and only a duration cap stops it. Kept because the
		 * studio's asset list shows it; re-measuring in the player would compute the same fact twice and
		 * the two could diverge.
		 */
		duration_ms: integer("duration_ms"),
		/** Stored byte count, for operations' usage questions; not in responses. */
		byte_size: integer("byte_size").notNull(),
		/**
		 * Key of the bytes inside the store, issued by the server and never built from the original file
		 * name (it would leak names, let same-named uploads overwrite each other, and turn user strings
		 * into path material like `../`). `buildStorageKey` in `lib/media/storage.ts` is the only issuer
		 * and joins our own ids. Unique so overwriting is inexpressible: two rows sharing a key would
		 * make deleting one delete the other's bytes.
		 */
		storage_key: text("storage_key").notNull(),
		/**
		 * Lifecycle; only `ready` is used today. `pending` is the slot for a future safety check between
		 * storing and publishing; without it that feature would have to change the storage structure.
		 * Unlike a placeholder value, the read route already checks `ready`, so adding the check later is
		 * a one-place change.
		 */
		status: text("status").notNull().default("ready"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		/** Makes overwriting inexpressible (see `storage_key`). */
		uniqueIndex("uq_media_storage_key").on(t.storage_key),
		/** Axis for orphan cleanup and account deletion; the time order lets cleanup scan oldest first. */
		index("idx_media_owner_kind").on(t.owner, t.kind, t.created_at.desc()),
		/** Cleanup's dominant path: find rows left not `ready` by time. Partial, so normal rows stay out. */
		index("idx_media_unready")
			.on(t.created_at)
			.where(sql`${t.status} <> 'ready'`),
	],
);

/**
 * Media bytes: the default storage adapter's backyard. Written by one implementation of the
 * `MediaBlobStore` port (`lib/media/postgres-store.ts`), not part of the media model; swapping the
 * adapter for S3/R2 leaves `media` untouched.
 *
 * Postgres is the default because the repository has no object-store integration yet (requiring S3
 * credentials would kill avatars in unconfigured deployments, after the user picked a file) and a
 * local filesystem cannot be a production architecture. Postgres is durable storage the deployment
 * already depends on and covers already work this way (`story_cover.bytes`). The cost: bytes pass
 * through the connection pool and DB memory, so avatars are capped lower than covers (2MiB) and a
 * very large media set would dominate backups; that is when to swap the adapter.
 *
 * No FK to `media` on purpose: it would make "metadata in Postgres, bytes in S3" a constraint
 * violation after a swap. The store is key-value; whether anything points at a key is not its
 * question, so orphan bytes are representable (a property of every object store; see the cleanup
 * section of `services/media.ts`).
 */
export const media_blob = pgTable("media_blob", {
	storage_key: text("storage_key").primaryKey(),
	bytes: bytea("bytes").notNull(),
});
