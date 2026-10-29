import type { InboundEntry, SyncRecordShape } from "@rowcat/sync";
import { syncCodecRegistry } from "../lib/local-sync/registry.ts";

/**
 * Turns one record into an inbound entry by actually sending it over the wire.
 *
 * It really runs `encode` → `decode`. Plugging a local record straight into `remote` would skip the
 * fields the codec drops (sync metadata) and skip validation, so these tests would verify
 * themselves rather than the store.
 *
 * Encryption is not here. The envelope bytes are pinned by the golden vector
 * (`local-sync/golden-vector.test.ts`); this helper covers the layer above that.
 */
export function wireEntry<T extends SyncRecordShape>(input: {
	type: string;
	record: T;
	version: number;
	serverUpdatedAt?: string;
}): InboundEntry {
	const codec = syncCodecRegistry.get(input.type);
	if (!codec) throw new Error(`no codec: ${input.type}`);
	const remote = codec.decode({
		id: input.record.id,
		schemaVersion: codec.schemaVersion,
		rev: input.record.rev,
		deletedAt: input.record.deletedAt,
		data: codec.encode(input.record),
	});
	if (!remote) throw new Error(`the codec rejected it: ${input.type}`);
	return {
		kind: "record",
		id: input.record.id,
		type: input.type,
		version: input.version,
		serverUpdatedAt: input.serverUpdatedAt ?? input.record.updatedAt,
		rev: input.record.rev,
		remote,
		merge: (local, context) => codec.merge(local, remote, context),
	};
}

export const tombstoneEntry = (input: {
	type: string;
	id: string;
	version: number;
	serverUpdatedAt: string;
}): InboundEntry => ({
	kind: "tombstone",
	id: input.id,
	type: input.type,
	version: input.version,
	serverUpdatedAt: input.serverUpdatedAt,
});
