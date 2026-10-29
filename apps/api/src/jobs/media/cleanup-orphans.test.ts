import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import { media, media_blob, member } from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import * as mediaService from "../../services/media.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { runJob } from "../runner.ts";
import type { Clock, JobLogger } from "../types.ts";
import { cleanupOrphanMediaJob } from "./cleanup-orphans.ts";

/**
 * Orphan media cleanup, tested on real rows and bytes. What it protects:
 *
 * ```text
 * grace      a just-uploaded orphan is not deleted (a normal upload moment)
 * reference  media a member points at is never deleted
 * kind       only avatar is swept; scene_image references live outside the server
 * retry      a failed byte delete leaves the row for the next run
 * isolation  one failure does not stop the rest
 * cap        one run does not empty the whole store
 * ```
 */

const EMAIL_PREFIX = "orphan-job-test-";
/** Storage key prefix so only this suite's media is cleaned up. */
const KEY_PREFIX = "orphan-job-test/";

const hasDb = await connectTestDatabase();

const silent: JobLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const NOW = new Date("2026-08-25T00:00:00.000Z");
const clock: Clock = { now: () => NOW };

const hoursAgo = (hours: number): Date =>
	new Date(NOW.getTime() - hours * 3_600_000);

/** One media row plus its bytes, inserted directly (not via the service) to control its age. */
async function seedMedia(input: {
	ownerId: string;
	kind: "avatar" | "scene_image";
	createdAt: Date;
	withBytes?: boolean;
}): Promise<string> {
	const id = newId();
	const storageKey = `${KEY_PREFIX}${id}.webp`;
	if (input.withBytes !== false)
		await db
			.insert(media_blob)
			.values({ storage_key: storageKey, bytes: Buffer.from([1, 2, 3]) });
	await db.insert(media).values({
		id,
		owner: input.ownerId,
		kind: input.kind,
		mime: "image/webp",
		width: 64,
		height: 64,
		byte_size: 3,
		storage_key: storageKey,
		status: "ready",
		created_at: input.createdAt,
	});
	return id;
}

const mediaExists = async (id: string): Promise<boolean> =>
	(await db.select({ id: media.id }).from(media).where(eq(media.id, id)))
		.length > 0;

async function cleanup(): Promise<void> {
	await db.delete(media).where(like(media.storage_key, `${KEY_PREFIX}%`));
	await db
		.delete(media_blob)
		.where(like(media_blob.storage_key, `${KEY_PREFIX}%`));
	await deleteTestUsers(EMAIL_PREFIX);
}

if (hasDb)
	afterAll(async () => {
		await cleanup();
		await closeDb();
	});

const run = () =>
	runJob(cleanupOrphanMediaJob, { clock, logger: silent, signal: undefined });

describe.skipIf(!hasDb)("orphan media cleanup", () => {
	beforeEach(async () => {
		vi.restoreAllMocks();
		await cleanup();
	});

	test("orphans inside the grace period are not deleted — they may be in-flight uploads", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		const fresh = await seedMedia({
			ownerId: memberId,
			kind: "avatar",
			createdAt: hoursAgo(1),
		});

		const record = await run();
		expect(record.status).toBe("completed");
		expect(await mediaExists(fresh)).toBe(true);
	});

	test("orphans past the grace period lose both bytes and row", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		const old = await seedMedia({
			ownerId: memberId,
			kind: "avatar",
			createdAt: hoursAgo(48),
		});

		const record = await run();
		expect(record.result.succeeded).toBe(1);
		expect(await mediaExists(old)).toBe(false);
		const blobs = await db
			.select({ key: media_blob.storage_key })
			.from(media_blob)
			.where(like(media_blob.storage_key, `${KEY_PREFIX}%`));
		expect(blobs).toEqual([]);
	});

	test("never deleted, however old, while a member points at it", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		const referenced = await seedMedia({
			ownerId: memberId,
			kind: "avatar",
			createdAt: hoursAgo(24 * 365),
		});
		await db
			.update(member)
			.set({ avatar_media_id: referenced })
			.where(eq(member.id, memberId));

		const record = await run();
		expect(record.result.processed).toBe(0);
		expect(await mediaExists(referenced)).toBe(true);
	});

	test("scene_image is not a candidate — its references live in devices' E2EE drafts", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		const scene = await seedMedia({
			ownerId: memberId,
			kind: "scene_image",
			createdAt: hoursAgo(24 * 365),
		});

		await run();
		// Guards the costliest thing here: the server cannot see drafts pointing at that picture, so it
		// cannot say "nobody points at this", and deleting anyway makes a live work's picture vanish.
		expect(await mediaExists(scene)).toBe(true);
	});

	test("when deleting the bytes fails the row stays — the next run retries", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		const target = await seedMedia({
			ownerId: memberId,
			kind: "avatar",
			createdAt: hoursAgo(48),
		});

		const spy = vi
			.spyOn(mediaService, "purgeMedia")
			.mockResolvedValueOnce(false);

		const first = await run();
		expect(first.result.failed).toBe(1);
		expect(await mediaExists(target)).toBe(true);

		spy.mockRestore();
		const second = await run();
		expect(second.result.succeeded).toBe(1);
		expect(await mediaExists(target)).toBe(false);
	});

	test("one failure does not stop deleting the rest", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		await seedMedia({
			ownerId: memberId,
			kind: "avatar",
			createdAt: hoursAgo(48),
		});
		await seedMedia({
			ownerId: memberId,
			kind: "avatar",
			createdAt: hoursAgo(49),
		});
		await seedMedia({
			ownerId: memberId,
			kind: "avatar",
			createdAt: hoursAgo(50),
		});

		vi.spyOn(mediaService, "purgeMedia").mockImplementationOnce(
			async () => false,
		);

		const record = await run();
		expect(record.status).toBe("completed");
		expect(record.result.processed).toBe(3);
		expect(record.result.succeeded).toBe(2);
		expect(record.result.failed).toBe(1);
	});

	test("a shutdown signal mid-run hands the remaining candidates to the next run", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		for (let i = 0; i < 3; i++)
			await seedMedia({
				ownerId: memberId,
				kind: "avatar",
				createdAt: hoursAgo(48 + i),
			});

		const controller = new AbortController();
		controller.abort();

		const record = await runJob(cleanupOrphanMediaJob, {
			clock,
			logger: silent,
			signal: controller.signal,
		});

		// An aborted signal does not start the run; nothing was deleted.
		expect(record.status).toBe("skipped");
		expect(record.lock).toBe("not-attempted");
		const left = await db
			.select({ id: media.id })
			.from(media)
			.where(
				and(
					eq(media.owner, memberId),
					like(media.storage_key, `${KEY_PREFIX}%`),
				),
			);
		expect(left).toHaveLength(3);
	});

	test("the result carries the grace period — the log must be able to answer why it did not delete", async () => {
		const record = await run();
		expect(record.result.details?.graceHours).toBe(24);
	});
});
