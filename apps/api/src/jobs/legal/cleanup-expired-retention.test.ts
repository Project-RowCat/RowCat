import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { closeDb, db } from "../../db/client.ts";
import {
	guardian_consent,
	identity_verification,
	sync_pairing,
	verification,
} from "../../db/schema.ts";
import { newId } from "../../lib/id.ts";
import { createTestMember } from "../../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../../test/database.ts";
import { runJob } from "../runner.ts";
import type { Clock, JobLogger } from "../types.ts";
import {
	cleanupExpiredRetentionJob,
	inspectRetention,
} from "./cleanup-expired-retention.ts";
import {
	RETENTION_POLICIES,
	UNRESOLVED_RETENTION,
} from "./retention-policies.ts";

/**
 * Statutory retention destruction, with boundaries checked by value on a deterministic clock.
 *
 * The most important assertions are about what is not deleted: code touching an unresolved category
 * (dispute records, access logs, etc.) breaks here first. No guessed retention period is written in
 * the tests; every period here is already in the policy document, and changing a value without
 * editing that document is meant to break this file.
 */

const EMAIL_PREFIX = "retention-job-test-";
/** Prefix so cleanup touches only rows this suite created. */
const MARK = "retention-job-test-";

const hasDb = await connectTestDatabase();

const silent: JobLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

/** The time one run sees; the boundary assertions hang on it. */
const NOW = new Date("2026-08-25T00:00:00.000Z");
const clock: Clock = { now: () => NOW };
const before = (ms: number): Date => new Date(NOW.getTime() - ms);
const after = (ms: number): Date => new Date(NOW.getTime() + ms);

async function cleanup(): Promise<void> {
	await db
		.delete(verification)
		.where(like(verification.identifier, `${MARK}%`));
	await db.delete(sync_pairing).where(like(sync_pairing.code_hash, `${MARK}%`));
	await deleteTestUsers(EMAIL_PREFIX);
}

if (hasDb)
	afterAll(async () => {
		await cleanup();
		await closeDb();
	});

const run = (dryRun = false) =>
	runJob(cleanupExpiredRetentionJob, { clock, logger: silent, dryRun });

const verificationRows = () =>
	db
		.select({ id: verification.id })
		.from(verification)
		.where(like(verification.identifier, `${MARK}%`));

describe.skipIf(!hasDb)("retention expiry destruction", () => {
	beforeEach(cleanup);

	test("records still valid remain", async () => {
		await db.insert(verification).values({
			id: newId(),
			identifier: `${MARK}live`,
			value: "token",
			expiresAt: after(60_000),
		});

		await run();
		expect(await verificationRows()).toHaveLength(1);
	});

	test("expired records are destroyed", async () => {
		await db.insert(verification).values({
			id: newId(),
			identifier: `${MARK}dead`,
			value: "token",
			expiresAt: before(60_000),
		});

		const record = await run();
		expect(record.status).toBe("completed");
		expect(await verificationRows()).toHaveLength(0);
	});

	test("the exact cutoff instant is not yet expired", async () => {
		/**
		 * The predicate is `<`, so a value equal to the cutoff stays. That choice is documented meaning,
		 * not arbitrary; a change to `<=` should break here first.
		 */
		await db.insert(verification).values({
			id: newId(),
			identifier: `${MARK}exact`,
			value: "token",
			expiresAt: NOW,
		});

		await run();
		expect(await verificationRows()).toHaveLength(1);
	});

	test("one clock for the whole run — the same input gives the same result", async () => {
		await db.insert(verification).values({
			id: newId(),
			identifier: `${MARK}deterministic`,
			value: "token",
			expiresAt: NOW,
		});

		await run();
		await run();
		expect(await verificationRows()).toHaveLength(1);
	});

	test("dry-run only counts candidates", async () => {
		await db.insert(verification).values({
			id: newId(),
			identifier: `${MARK}dry`,
			value: "token",
			expiresAt: before(60_000),
		});

		const record = await run(true);
		expect(record.result.details?.dryRun).toBe(true);
		expect(record.result.succeeded).toBe(0);
		expect(record.result.processed).toBeGreaterThan(0);
		expect(await verificationRows()).toHaveLength(1);
	});

	test("the inspect function deletes nothing either", async () => {
		await db.insert(verification).values({
			id: newId(),
			identifier: `${MARK}inspect`,
			value: "token",
			expiresAt: before(60_000),
		});

		const rows = await inspectRetention(NOW);
		expect(rows.map((r) => r.id)).toContain("auth.verification-token");
		expect(rows.every((r) => r.action === "delete")).toBe(true);
		expect(await verificationRows()).toHaveLength(1);
	});

	test("only expired, abandoned guardian consent requests are destroyed", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		const abandoned = newId();
		await db.insert(guardian_consent).values({
			id: abandoned,
			member_id: memberId,
			status: "verified",
			token_hash: newId(),
			guardian_name: "Guardian",
			guardian_contact: "010-0000-0000",
			expires_at: before(60_000),
		});

		await run();
		const left = await db
			.select({ id: guardian_consent.id })
			.from(guardian_consent)
			.where(eq(guardian_consent.member_id, memberId));
		expect(left).toHaveLength(0);
	});

	test("a confirmed consent remains even past its expiry time — it is a record", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		await db.insert(guardian_consent).values({
			id: newId(),
			member_id: memberId,
			status: "approved",
			token_hash: newId(),
			expires_at: before(365 * 24 * 3_600_000),
			consented_at: before(365 * 24 * 3_600_000),
		});

		await run();
		const left = await db
			.select({ id: guardian_consent.id })
			.from(guardian_consent)
			.where(eq(guardian_consent.member_id, memberId));
		expect(left).toHaveLength(1);
	});

	test("finished identity verifications remain; only abandoned attempts are destroyed", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		const finished = newId();
		await db.insert(identity_verification).values({
			id: finished,
			member_id: memberId,
			purpose: "adult",
			status: "verified",
			provider: "dev",
			expires_at: before(3_600_000),
		});
		await db.insert(identity_verification).values({
			id: newId(),
			member_id: memberId,
			purpose: "adult",
			status: "pending",
			provider: "dev",
			expires_at: before(3_600_000),
		});

		await run();
		const left = await db
			.select({ id: identity_verification.id })
			.from(identity_verification)
			.where(eq(identity_verification.member_id, memberId));
		expect(left.map((r) => r.id)).toEqual([finished]);
	});

	test("expired device pairing relays are destroyed — a sealed envelope does not linger forever", async () => {
		const { memberId } = await createTestMember(EMAIL_PREFIX);
		await db.insert(sync_pairing).values({
			owner: memberId,
			code_hash: `${MARK}${newId()}`,
			new_pub: "pub",
			payload: "sealed",
			expires_at: before(60_000),
		});

		await run();
		const left = await db
			.select({ owner: sync_pairing.owner })
			.from(sync_pairing)
			.where(eq(sync_pairing.owner, memberId));
		expect(left).toHaveLength(0);
	});

	test("every listed policy states its basis for expiry", () => {
		for (const policy of RETENTION_POLICIES) {
			expect(policy.source).toMatch(/validity|expiry/);
			expect(policy.period.length).toBeGreaterThan(0);
		}
	});

	test("unresolved categories remain explicitly, with reasons", () => {
		expect(UNRESOLVED_RETENTION.length).toBeGreaterThan(0);
		for (const item of UNRESOLVED_RETENTION) {
			expect(item.blockedBy.length).toBeGreaterThan(0);
			expect(item.reason.length).toBeGreaterThan(0);
		}
		const blocked = UNRESOLVED_RETENTION.map((i) => i.id);
		expect(blocked).toContain("consumer-dispute");
		expect(blocked).toContain("access-log");
	});

	test("deleting long-dormant accounts is not in the policy — it is a deployment's decision, not expiry", () => {
		const ids = RETENTION_POLICIES.map((p) => p.id).join(" ");
		expect(ids).not.toMatch(/dormant|inactive|member/);
	});

	test("no policy takes an action other than destruction", () => {
		/**
		 * Every category needing anonymization is unresolved, so the vocabulary having a single value
		 * reflects the facts.
		 */
		expect(new Set(RETENTION_POLICIES.map((p) => p.action))).toEqual(
			new Set(["delete"]),
		);
	});

	test("several rows are deleted in batches within one run", async () => {
		for (let i = 0; i < 12; i++)
			await db.insert(verification).values({
				id: newId(),
				identifier: `${MARK}batch-${i}`,
				value: "token",
				expiresAt: before(60_000 + i),
			});

		const record = await run();
		expect(record.result.succeeded).toBeGreaterThanOrEqual(12);
		expect(await verificationRows()).toHaveLength(0);
	});
});
