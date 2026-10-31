import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
	normalizeSetupCode,
	SETUP_CODE_SOURCE_BYTES,
	setupCodeFromBytes,
} from "@rowcat/domain";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { deployment_setup, member } from "../../db/schema.ts";
import { env, localOwnerEnabled } from "../../env.ts";
import { recordAudit } from "../admin/audit.ts";

/**
 * First-run setup: the one path by which the product API makes someone an admin.
 *
 * ```text
 * boot      prepareDeploymentSetup   ensure the row · close it if an admin already exists · derive the code
 *           announce.ts              print the code to this process's log (the only place it appears)
 * request   readSetupStatus          one bit: is setup open
 *           claimDeploymentSetup     the code → the caller becomes admin → setup closes for good
 * ```
 *
 * The rest of the product still has no promotion path (`db:seed:moderator` is the other way in, and
 * only on the server). What makes this one acceptable is what it asks for: the code exists only in
 * the API's log, so presenting it proves the same authority that script assumes. And it is
 * single-use — `completed_at` is written in the same transaction as the role, and nothing in the
 * product clears it.
 *
 * What it does not do: it takes no role and no member from the request (the grant is always `admin`,
 * always to the session's member), it creates no account (sign-up stays Better Auth's — the one
 * exception is the local owner, `local-owner.ts`, which exists precisely because there is no sign-up),
 * and it does not reopen when the last admin leaves. That recovery is a database operation on purpose.
 */

export const SETUP_ROW_ID = "deployment";

/**
 * Domain separation for the HMAC: the session secret also signs cookies, and a value derived under
 * this label cannot be replayed as one of those signatures.
 */
const DERIVATION_LABEL = "rowcat:deployment-setup:v1:";

/**
 * `HMAC(BETTER_AUTH_SECRET, label ‖ salt)`. Deterministic, so every replica and restart prints the
 * same code; the salt is per database, so an empty development secret still gives a code nobody can
 * predict without reading the row.
 */
export function deriveSetupCode(salt: string): string {
	const digest = createHmac("sha256", env.BETTER_AUTH_SECRET ?? "")
		.update(DERIVATION_LABEL + salt)
		.digest();
	return setupCodeFromBytes(digest.subarray(0, SETUP_CODE_SOURCE_BYTES));
}

/** Constant time over equal lengths; both sides are canonical twelve-character codes by now. */
function sameCode(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

/** Whether `code` (as typed) is the code this salt derives. Shared by both claims so they cannot disagree. */
export function setupCodeMatches(salt: string, code: string): boolean {
	const normalized = normalizeSetupCode(code);
	return !!normalized && sameCode(normalized, deriveSetupCode(salt));
}

export type SetupBootState = { open: false } | { open: true; code: string };

/**
 * Runs once at boot, after migrations and before listening.
 *
 * Creates the row on first start. If it is still open but an admin already exists — a deployment
 * that appointed one with the seed script or psql before this table existed — it closes it here, so
 * upgrading never opens a promotion path on a deployment that did not need one.
 */
export async function prepareDeploymentSetup(): Promise<SetupBootState> {
	return db.transaction(async (tx) => {
		await tx
			.insert(deployment_setup)
			.values({
				id: SETUP_ROW_ID,
				salt: randomBytes(32).toString("base64url"),
			})
			.onConflictDoNothing();

		const [row] = await tx
			.select({
				salt: deployment_setup.salt,
				completedAt: deployment_setup.completed_at,
			})
			.from(deployment_setup)
			.where(eq(deployment_setup.id, SETUP_ROW_ID))
			.for("update");
		if (!row || row.completedAt) return { open: false };

		const [admin] = await tx
			.select({ id: member.id })
			.from(member)
			.where(eq(member.role, "admin"))
			.limit(1);
		if (admin) {
			await tx
				.update(deployment_setup)
				.set({ completed_at: new Date() })
				.where(eq(deployment_setup.id, SETUP_ROW_ID));
			return { open: false };
		}

		return { open: true, code: deriveSetupCode(row.salt) };
	});
}

/**
 * Open means the row exists and was never completed. No row is closed: without a salt there is no
 * code anyone could hold, and saying "open" would draw a form that can only fail.
 */
export async function readSetupStatus(): Promise<{
	open: boolean;
	localOwner: boolean;
}> {
	const [row] = await db
		.select({ completedAt: deployment_setup.completed_at })
		.from(deployment_setup)
		.where(eq(deployment_setup.id, SETUP_ROW_ID))
		.limit(1);
	return {
		open: !!row && row.completedAt === null,
		localOwner: localOwnerEnabled,
	};
}

export type SetupClaimOutcome = "claimed" | "closed" | "invalid";

/**
 * Makes `memberId` an admin if `code` is this deployment's setup code, and closes setup in the same
 * transaction.
 *
 * The row is locked first, so two correct claims racing each other cannot both commit: the second
 * reads `completed_at` and answers `closed`. Closed is decided before the code is compared — status is
 * public anyway, and comparing a code against a closed setup would only make wrong guesses look
 * meaningful.
 */
export async function claimDeploymentSetup(input: {
	memberId: string;
	code: string;
}): Promise<SetupClaimOutcome> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({
				salt: deployment_setup.salt,
				completedAt: deployment_setup.completed_at,
			})
			.from(deployment_setup)
			.where(eq(deployment_setup.id, SETUP_ROW_ID))
			.for("update");
		if (!row || row.completedAt) return "closed";
		if (!setupCodeMatches(row.salt, input.code)) return "invalid";

		const [current] = await tx
			.select({ role: member.role })
			.from(member)
			.where(eq(member.id, input.memberId))
			.for("update")
			.limit(1);
		/** The caller is a viewer, so the row exists; a vanished one is treated like a closed setup, not a 500. */
		if (!current) return "closed";

		await tx
			.update(member)
			.set({ role: "admin" })
			.where(eq(member.id, input.memberId));
		await tx
			.update(deployment_setup)
			.set({ completed_at: new Date(), completed_by: input.memberId })
			.where(eq(deployment_setup.id, SETUP_ROW_ID));
		/** The claimant is the operator of their own promotion; the previous role is what incident response needs. */
		await recordAudit(tx, {
			operatorId: input.memberId,
			action: "admin.setup.claim",
			targetType: "member",
			targetId: input.memberId,
			metadata: { before: current.role, after: "admin" },
		});
		return "claimed";
	});
}

/**
 * The local owner, if this deployment was set up for use without signing in (`local-owner.ts`).
 * Both ids, because the sign-in door needs the auth account and everything else needs the member.
 *
 * Read per request rather than cached: it is one primary-key row, and a cache would keep handing out
 * sessions for a moment after the owner's account was deleted.
 */
export async function readLocalOwner(): Promise<{
	memberId: string;
	userId: string;
} | null> {
	const [row] = await db
		.select({ memberId: member.id, userId: member.user_id })
		.from(deployment_setup)
		.innerJoin(member, eq(member.id, deployment_setup.local_owner_id))
		.where(eq(deployment_setup.id, SETUP_ROW_ID))
		.limit(1);
	return row ?? null;
}

/** Whether a local owner exists — the deployment fact `runtime-config` carries. */
export async function hasLocalOwner(): Promise<boolean> {
	const [row] = await db
		.select({ id: deployment_setup.id })
		.from(deployment_setup)
		.where(isNotNull(deployment_setup.local_owner_id))
		.limit(1);
	return !!row;
}
