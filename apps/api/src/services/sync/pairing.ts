import type {
	SyncPairingApproveRequest,
	SyncPairingDto,
	SyncPairingStartRequest,
} from "@rowcat/contracts";
import { SYNC_ERROR_CODE, SYNC_LIMITS } from "@rowcat/contracts";
import { and, count, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { sync_pairing } from "../../db/schema.ts";
import { ApiError } from "../../lib/errors.ts";

/**
 * Device pairing: an authenticated relay that expires, and nothing more. What it does not do is its
 * spec:
 *
 * - It never learns the code; it receives only the hash, never the plaintext.
 * - It does not parse `payload` (length only); knowing the structure would eventually make it a
 *   target for transformation.
 * - It does not rewrap keys; keyring and recovery wrappers do not pass this path (§18).
 * - It does not register devices; a successful pairing leaves no trace, the row disappears.
 *
 * `owner` always arrives as an argument and the contract has no slot for it, so a client cannot
 * point at another namespace.
 *
 * Expiry is the server's call: every lookup adds `expires_at > now()`, no client time is trusted,
 * and an expired row is the same as a missing one (§8). Distinguishing them would flip between 404
 * and 410 depending on when cleanup last ran.
 */

const pairingError = (
	status: 404 | 409 | 429,
	code: string,
	message: string,
): ApiError => new ApiError(status, code, message);

const expiry = (): Date =>
	new Date(Date.now() + SYNC_LIMITS.pairingTtlMinutes * 60 * 1000);

const toDto = (row: {
	new_pub: string;
	payload: string | null;
	expires_at: Date;
}): SyncPairingDto => ({
	newPublicKey: row.new_pub,
	payload: row.payload,
	expiresAt: row.expires_at.toISOString(),
});

/**
 * The new device deposits its public key. Order: sweep this owner's expired rows (owner-scoped,
 * same reason as push idempotency), count open sessions, insert (409 if the hash exists).
 *
 * `onConflictDoNothing` is the point: overwriting would let a later request swap `new_pub` of a
 * pairing in progress, and the trusted device would seal the DEK to a different key. With an 80-bit
 * code only a retry of the same request reaches the 409, and the client's answer is to draw a new
 * code.
 */
export async function startPairing(
	owner: string,
	input: SyncPairingStartRequest,
): Promise<SyncPairingDto> {
	return db.transaction(async (tx) => {
		await tx
			.delete(sync_pairing)
			.where(
				and(
					eq(sync_pairing.owner, owner),
					lt(sync_pairing.expires_at, new Date()),
				),
			);

		const [active] = await tx
			.select({ n: count() })
			.from(sync_pairing)
			.where(eq(sync_pairing.owner, owner));
		if ((active?.n ?? 0) >= SYNC_LIMITS.pairingMaxActive)
			throw pairingError(
				429,
				SYNC_ERROR_CODE.pairingTooMany,
				"There are too many device pairings in progress.",
			);

		const expires_at = expiry();
		const inserted = await tx
			.insert(sync_pairing)
			.values({
				owner,
				code_hash: input.codeHash,
				new_pub: input.newPublicKey,
				payload: null,
				expires_at,
			})
			.onConflictDoNothing({
				target: [sync_pairing.owner, sync_pairing.code_hash],
			})
			.returning({
				new_pub: sync_pairing.new_pub,
				payload: sync_pairing.payload,
				expires_at: sync_pairing.expires_at,
			});

		if (inserted.length === 0)
			throw pairingError(
				409,
				SYNC_ERROR_CODE.pairingExists,
				"A pairing with the same code is already in progress.",
			);
		return toDto(inserted[0]);
	});
}

/**
 * Trusted devices read `newPublicKey`, the new device reads `payload`. Read-only and consumes
 * nothing: deleting on first delivery would leave a retry after a lost response facing a vanished
 * session. The device that actually remembered the key decides consumption, via `DELETE`.
 */
export async function readPairing(
	owner: string,
	input: { codeHash: string },
): Promise<SyncPairingDto> {
	const [row] = await db
		.select({
			new_pub: sync_pairing.new_pub,
			payload: sync_pairing.payload,
			expires_at: sync_pairing.expires_at,
		})
		.from(sync_pairing)
		.where(
			and(
				eq(sync_pairing.owner, owner),
				eq(sync_pairing.code_hash, input.codeHash),
				gt(sync_pairing.expires_at, new Date()),
			),
		)
		.limit(1);
	if (!row)
		throw pairingError(
			404,
			SYNC_ERROR_CODE.pairingNotFound,
			"There is no device pairing in progress.",
		);
	return toDto(row);
}

/**
 * First approval wins: one conditional `UPDATE` (`payload IS NULL`) is the whole rule. With
 * read-then-write, two trusted devices approving at once would both pass and the later one would
 * remain, though the new device may already have taken the first envelope; the server would then
 * hold an envelope it cannot open and the next poll would fail decryption. The expiry condition
 * sits in the same statement for the same reason.
 */
export async function approvePairing(
	owner: string,
	input: SyncPairingApproveRequest,
): Promise<void> {
	const updated = await db
		.update(sync_pairing)
		.set({ payload: input.payload })
		.where(
			and(
				eq(sync_pairing.owner, owner),
				eq(sync_pairing.code_hash, input.codeHash),
				gt(sync_pairing.expires_at, new Date()),
				isNull(sync_pairing.payload),
			),
		)
		.returning({ code_hash: sync_pairing.code_hash });
	if (updated.length > 0) return;

	/**
	 * Zero rows means two things, split only here: "already approved" is a normal race result (two
	 * devices approved the same code) and needs different user copy, and both answers stay inside the
	 * caller's own namespace so existence hiding is not broken.
	 */
	const [existing] = await db
		.select({ payload: sync_pairing.payload })
		.from(sync_pairing)
		.where(
			and(
				eq(sync_pairing.owner, owner),
				eq(sync_pairing.code_hash, input.codeHash),
				gt(sync_pairing.expires_at, new Date()),
			),
		)
		.limit(1);
	if (existing && existing.payload !== null)
		throw pairingError(
			409,
			SYNC_ERROR_CODE.pairingAlreadyApproved,
			"This pairing was already approved.",
		);
	throw pairingError(
		404,
		SYNC_ERROR_CODE.pairingNotFound,
		"There is no device pairing in progress.",
	);
}

/**
 * Cancellation and post-consumption cleanup are the same operation. Closing a missing session
 * succeeds: a 404 would make the later of two racing closers look failed with nothing to tell,
 * since the desired state (no session) already holds. Closes the relay only; keyring, DEK and other
 * devices' trust are untouched.
 */
export async function cancelPairing(
	owner: string,
	input: { codeHash: string },
): Promise<void> {
	await db
		.delete(sync_pairing)
		.where(
			and(
				eq(sync_pairing.owner, owner),
				eq(sync_pairing.code_hash, input.codeHash),
			),
		);
}
