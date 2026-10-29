import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { media_blob } from "../../db/schema.ts";
import type { MediaBlobStore } from "./storage.ts";

/**
 * Postgres adapter for `MediaBlobStore`, and this deployment's default storage.
 *
 * - There is no S3/R2 integration yet, and code that demands credentials would kill avatars
 *   entirely on an unconfigured deployment, surfacing only after the user uploads. The local
 *   filesystem cannot be a production architecture either (lost on restart, diverges across
 *   replicas). Postgres is already a dependency, and cover art already works this way
 *   (`story_cover.bytes`).
 * - Cost: bytes pass through the connection pool (hence the avatar cap is below the cover cap),
 *   media dominates backup size, and reads go through our API with immutable URLs standing in for a
 *   CDN. When that bites, the swap is this file plus `resolveMediaStore`.
 * - It deliberately does not join a transaction. `put` could share one with the media row INSERT
 *   and rule out orphans, but object storage cannot, so a service relying on that would start
 *   leaking orphans the day the adapter changes. `services/media.ts` uses an order that is correct
 *   for every adapter instead.
 */
export const postgresMediaStore: MediaBlobStore = {
	/**
	 * Upsert, so a retried upload with the same media id (response lost) rewrites the same bytes
	 * instead of dying on a constraint violation and surfacing as a 5xx.
	 */
	async put(key, bytes) {
		await db
			.insert(media_blob)
			.values({ storage_key: key, bytes })
			.onConflictDoUpdate({
				target: media_blob.storage_key,
				set: { bytes: sql`excluded.bytes` },
			});
	},

	async get(key) {
		const [row] = await db
			.select({ bytes: media_blob.bytes })
			.from(media_blob)
			.where(eq(media_blob.storage_key, key))
			.limit(1);
		return row?.bytes ?? null;
	},

	/**
	 * Range read via `substring(bytea from … for …)`, which keeps the pool less occupied. Reading
	 * `octet_length` alongside decides key existence and range validity in one round trip; two queries
	 * would let a key deleted in between look like an empty slice. `substring` is 1-based.
	 */
	async getRange(key, start, endExclusive) {
		const length = endExclusive - start;
		const [row] = await db
			.select({
				total: sql<number>`octet_length(${media_blob.bytes})`,
				chunk:
					length > 0
						? sql<Buffer>`substring(${media_blob.bytes} from ${start + 1} for ${length})`
						: sql<Buffer>`''::bytea`,
			})
			.from(media_blob)
			.where(eq(media_blob.storage_key, key))
			.limit(1);
		if (!row) return null;
		return row.chunk ?? Buffer.alloc(0);
	},

	/** Deleting a missing key succeeds; `DELETE` does not throw on zero rows. */
	async delete(key) {
		await db.delete(media_blob).where(eq(media_blob.storage_key, key));
	},
};

/**
 * Picks this deployment's storage. It is a function so the next adapter has one place to branch;
 * services must not import `postgresMediaStore` directly.
 *
 * No env var yet: add the setting in the commit that adds the adapter reading it. A variable that
 * does nothing when filled in creates deployments that believe it is on.
 */
export const resolveMediaStore = (): MediaBlobStore => postgresMediaStore;
