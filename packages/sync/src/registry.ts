import type { Rev } from "@rowcat/contracts/sync";
import type { MergeRecoveryCandidate } from "./recovery.ts";

/**
 * Codec: the translation between a domain record and the wire payload, plus that type's merge rule.
 * The interface lives here, not in `@rowcat/contracts`, because it describes behavior (encode,
 * decode, merge) rather than shape. The contracts package is what the server carries to parse
 * requests, and the server never learns merging. Domain packages (chat, authoring) do not import
 * this interface. If they depended on it, the protocol would become upstream of the domain, and a
 * cycle would form once a domain wanted to reference sync types. Instead, domains export plain
 * objects and the app's assembly point checks conformance structurally. A mismatch fails
 * compilation there.
 */

/**
 * Common fields every sync record has. The six types (room, message, draft, character, lore, scene)
 * already have this shape. This writes down what `ChatSyncMeta` and `AuthoringSyncMeta` established
 * in step 1a. It adds no new constraint.
 */
export interface SyncRecordShape {
	id: string;
	rev: Rev;
	dirty: 0 | 1;
	serverVersion: number;
	deletedAt: string | null;
	updatedAt: string;
}

/**
 * The codec's decode input: the payload `data` plus the metadata outside it. Local records need
 * `id`, `rev` and `deletedAt`, and those are deliberately outside `data`. `id` is covered by the
 * AAD, and the rest belong to the common envelope. Copying them into `data` would record the same
 * fact in two places that can drift apart. Once they drift, nothing decides which value is right,
 * so the outside values are passed as arguments.
 */
export interface DecodedRecordInput {
	id: string;
	schemaVersion: number;
	rev: Rev;
	deletedAt: string | null;
	data: unknown;
}

/**
 * The merge emits two channels, and they carry different things.
 * - `note`: classifications and counts only. Goes to diagnostics, logs and telemetry.
 * - `recover`: user values that disappear. Stays only in this device's storage. Merging them into
 *   one would make SyncDiagnosticEvent a plaintext carrier. That event is built to flow to the
 *   console and error reporters, and that difference is the whole reason for the split.
 */
export interface MergeContext {
	/**
	 * `note` reports a normal but noteworthy outcome, such as concurrent edits in the same group or a
	 * branched publish link. It takes a code string because each domain has its own vocabulary. An
	 * enum defined here would pull chat and authoring diagnostic names into the protocol package and
	 * force a change to this file for every new domain. No record id or value is included here.
	 */
	note(code: string): void;
	/**
	 * `recover` reports losing versions that should be kept as local recovery copies. It is required
	 * on purpose. If it were optional, a store could silently keep nothing, and the loss would surface
	 * only after a user had lost their work. The codec only reports candidates; the transaction that
	 * commits the merge writes them. So `merge` stays a deterministic function without side effects.
	 */
	recover(candidate: MergeRecoveryCandidate): void;
}

export interface MergeResult<TRecord> {
	/** Merge result. It is stored exactly as returned. */
	record: TRecord;
	/**
	 * Whether the server copy won as-is. This value decides whether the record must be uploaded again.
	 * `true` means local contributed nothing, so there is nothing to send back (dirty = 0). `false`
	 * means the merge result is a version the server does not have, so it must upload again (dirty =
	 * 1). If storage inferred this by comparing fields, each type would infer differently. One wrong
	 * guess would mean one device's edits never upload.
	 */
	remoteWins: boolean;
}

/**
 * Codec for one type. The method-shorthand syntax is intentional. TypeScript checks method
 * parameters bivariantly, so `SyncCodec<ChatRoom>` is assignable to `SyncCodec<SyncRecordShape>`.
 * That is why the registry can hold six types in one list. Arrow-function properties would make
 * strictFunctionTypes enforce contravariance, the list could not be built, and the usual workaround
 * is `as any`.
 */
export interface SyncCodec<TRecord extends SyncRecordShape> {
	/** Namespace string such as `chat.room`. It is the registry key. */
	readonly type: string;
	/**
	 * The schema version this codec writes. The range of versions it can read is known to `decode`.
	 */
	readonly schemaVersion: number;

	/**
	 * Record to `payload.data`. Excludes identity and transport metadata and holds only the authored
	 * content.
	 */
	encode(record: TRecord): unknown;

	/**
	 * Payload to record. Returns `null` when the payload cannot be applied. Null is returned in two
	 * cases: a schemaVersion higher than this codec knows, or the same version with a shape that does
	 * not match the contract. Retrying cannot make either valid, so the engine ignores the entry and
	 * advances the cursor. It does not throw because 'not applicable' is a normal path for forward
	 * compatibility, not an exceptional case. The returned record's `dirty` and `serverVersion` are
	 * meaningless and set to 0. They are the receiving device's transport metadata, not part of the
	 * payload. Storage overwrites them with wire values.
	 */
	decode(input: DecodedRecordInput): TRecord | null;

	/** Conflict rule for this type. It must return the same answer for the same two inputs. */
	merge(
		local: TRecord,
		remote: TRecord,
		context: MergeContext,
	): MergeResult<TRecord>;

	/**
	 * Extracts the axis used to judge merges. The engine and storage compare revisions without knowing
	 * the type.
	 */
	revOf(record: TRecord): Rev;
}

/**
 * Type-erased codec. Concrete codecs are assignable to it because of the method-shorthand
 * bivariance described above.
 */
export type AnySyncCodec = SyncCodec<SyncRecordShape>;

export interface SyncCodecRegistry {
	/**
	 * Returns `null` for an unknown type. That is not an error; it is the 'ignore and advance the
	 * cursor' path (§19).
	 */
	get(type: string): AnySyncCodec | null;
	/** Types this client knows. Outbound collection order uses this list. */
	types(): readonly string[];
}

/**
 * Assembly point for the app. The argument order is preserved, and that is part of the protocol.
 * Push must send parents before children (room before message, draft before its children). The
 * order is fixed in an array rather than left to Map iteration or object key order, which can
 * differ between runtimes. Duplicate types throw. If two codecs claimed the same type, one merge
 * rule would silently disappear, and that would surface only when two devices produced different
 * winners.
 */
export function createCodecRegistry(
	codecs: readonly AnySyncCodec[],
): SyncCodecRegistry {
	const byType = new Map<string, AnySyncCodec>();
	const order: string[] = [];
	for (const codec of codecs) {
		if (byType.has(codec.type))
			throw new Error(`sync codec registered twice: ${codec.type}`);
		byType.set(codec.type, codec);
		order.push(codec.type);
	}
	return {
		get: (type) => byType.get(type) ?? null,
		types: () => order,
	};
}
