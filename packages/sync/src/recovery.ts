import type { Rev } from "@rowcat/contracts/sync";

/**
 * Local safety net for records that a merge discards. This is not part of the protocol. The
 * question: when two devices edit the same field group concurrently and one version disappears,
 * where should that value be kept? Only this device's local storage.
 * - Not SyncDiagnosticEvent: it carries counts and categories only. Plaintext there would flow
 *   into logs, telemetry and error reporters.
 * - Not a sync record: a synced copy would become a second conflict domain. Resolving a conflict
 *   would create one.
 * - The package never reads the payload shape. Field-group names belong to the domain codec
 *   (`@rowcat/authoring`). Domain words such as prompt, title or adult must not enter this package.
 * - Nothing is sent to the server. There is no codec, type vocabulary, endpoint or envelope
 *   version here. The canonical document converges as before; the only addition is that the user
 *   can recover a discarded value.
 */

/**
 * The codec does not store this object itself. Its `merge` must be a pure function that gives the
 * same answer for the same two inputs, per the registry contract. Adding side effects would turn
 * that determinism into a promise no test can verify. The codec only reports candidates; the
 * transaction that commits the merge result writes them.
 */
export interface MergeRecoveryCandidate {
	/**
	 * Piece name, unique within a record. It is a domain term (such as a draft's field-group name),
	 * and the protocol does not interpret it. The protocol only knows it separates pieces of the same
	 * record, which is enough for identity and deduplication.
	 */
	scope: string;
	/**
	 * Revision of the losing version that disappears. This is the identity axis and the deduplication
	 * key. It is the losing side, not the winning side, on purpose. The same logical loss may be
	 * observed many times (pull retries, reconnects, process restarts), but this value stays the same,
	 * so the entries fold into one row. An identity built from the winner or an observation time would
	 * add a copy on every retry.
	 */
	losingRev: Rev;
	/** Domain-owned opaque value. This package never reads it. */
	payload: unknown;
}

/**
 * A local-only recovery copy row. It is deliberately not shaped like the sync record
 * (`SyncRecordShape`): no `dirty`, `rev`, `serverVersion` or tombstone. If any sync axis were
 * added, this row could become a shape that outbound collection picks up. The decision that
 * recovery copies are not synced would then survive only as a comment promise. This type is absent
 * from the codec registry and from `TABLE_ORDER`.
 */
export interface SyncRecoveryRecord {
	/** Deterministic identity from `syncRecoveryId`. The same loss always produces the same value. */
	id: string;
	/** Which sync type the record belonged to, such as `authoring.draft`. */
	type: string;
	recordId: string;
	scope: string;
	losingRev: Rev;
	payload: unknown;
	/** First observation time (ISO 8601). Re-observing the same loss does not move this value. */
	observedAt: string;
}

/**
 * Deterministic identity from (type, record, piece, losing revision). No time or randomness goes
 * in. That lets a re-run of the same page, a reconnect, or an app restart point to the same row, so
 * storage skips it as is. Keeping the revision-to-string rule in this one place is part of that
 * determinism. If each caller assembled it, one might pad differently or use another separator, and
 * the same loss would appear as two rows.
 */
export const syncRecoveryId = (
	type: string,
	recordId: string,
	scope: string,
	losingRev: Rev,
): string =>
	`${type}:${recordId}:${scope}:${losingRev.t}.${losingRev.c}.${losingRev.d}`;
