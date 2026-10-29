import type { Rev } from "@rowcat/contracts/sync";
import { compareRev } from "./clock.ts";
import type { SyncRecordShape } from "./registry.ts";

/**
 * Type-independent merge skeleton: the decision order (§19.2).
 *
 * Domain codecs own the type rules (completeness first, protection of immutable fields, field
 * groups). This file holds the decisions that run before those rules are invoked. None of them
 * depend on the domain: is the record unseen, is it a tombstone, was it already deleted, is it a
 * replay.
 *
 * The order must not be rewritten per storage implementation (web Dexie, a future SQLite). If the
 * copies drift apart, the same input could reach different final states on two devices. It lives
 * here as one pure function.
 */

/**
 * Type-independent diagnostic codes, kept apart from the domain codecs' vocabulary (`chat_*`,
 * `authoring_*`). They come from decisions made before any domain rule runs, so no domain owns
 * them.
 */
export const SYNC_MERGE_NOTE = {
	/**
	 * An inbound version older than the one already applied. It is ignored, and our version is sent
	 * back.
	 *
	 * Two things produce this signal. One is a server replaying an old blob, where the defense worked.
	 * The other, which is actually common, is two devices editing the same record separately and
	 * diverging. Then the losing side's version disappears. Counting the signal shows how often that
	 * happens.
	 */
	staleInbound: "sync_stale_inbound",
} as const;

/** Instruction the storage layer applies inside its transaction. */
export type InboundDecision =
	| { action: "create" }
	/** A remote tombstone. It always wins: the deletion applies regardless of local edits. */
	| { action: "delete" }
	/**
	 * Already deleted locally. Content is not applied; only `serverVersion` is updated.
	 *
	 * This is where resurrection becomes structurally impossible. The local row is not removed, so the
	 * 'never seen this id' decision cannot arise, and a deleted local record cannot be revived by any
	 * inbound.
	 */
	| { action: "keep-deleted" }
	/**
	 * An older version than already applied. It is ignored: content unchanged, only `serverVersion`
	 * updated.
	 *
	 * This defends against replay, where the server returns an old blob, and it also handles the
	 * common case of receiving back our own just-sent write. The legacy code had no such defense at
	 * all: once `version` went up, even an old ciphertext was applied.
	 */
	| { action: "replay" }
	/** Handed to the domain codec's conflict rules. */
	| { action: "merge" };

export interface InboundFacts {
	/** Whether the remote is a tombstone, which carries no ciphertext. */
	deleted: boolean;
	/** Remote revision. Null for tombstones, which have no payload to decrypt. */
	rev: Rev | null;
}

/**
 * Builds the decision from the current local value and the inbound facts. A null `local` means the
 * id is unseen.
 *
 * Tombstones also create rows. A child tombstone arriving before its parent, or a deletion for a
 * record this device never saw, lands here. Without a row, a later live copy of that record would
 * resurrect it.
 */
export function decideInbound(
	local: SyncRecordShape | null,
	inbound: InboundFacts,
): InboundDecision {
	if (!local)
		return inbound.deleted ? { action: "delete" } : { action: "create" };
	if (inbound.deleted) return { action: "delete" };
	if (local.deletedAt !== null) return { action: "keep-deleted" };
	/**
	 * Only a strictly older revision is a replay. An equal revision goes to merge, usually because our
	 * own write came back. The codec then keeps the local value and decides `remoteWins` exactly.
	 */
	if (inbound.rev && compareRev(inbound.rev, local.rev) < 0)
		return { action: "replay" };
	return { action: "merge" };
}
