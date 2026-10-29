import {
	checkWireValue,
	DEFAULT_WIRE_LIMITS,
	type RuntimeWireLimits,
	type RuntimeWireValue,
} from "./wire.ts";

/**
 * Host contract for durable-state snapshots: a platform-neutral shape that does not know lifetimes,
 * plus the trusted store that holds it.
 *
 * Flow: a host snapshot of the form `{ formatVersion, entries: [{ key, version, value }] }` is
 * handed to the VM at session creation, before the first render (hydration). When a commit
 * succeeds, only the changed keys come back as a delta, and the host snapshot is updated.
 *
 * This module is used twice, for the playthrough (`story-state.ts`) and for persistent state
 * (`persistent-state.ts`). It is one mechanism rather than two copies on purpose: the
 * easy-to-get-wrong parts (canonical ordering, keeping unknown entries, limit validation) must give
 * the same answers for both.
 *
 * The snapshot has no scope. `storyId`, `draftId`, `userId`, `saveSlotId`, `deviceId`, and `rev`
 * are absent. Those belong to the storage coordinator's vocabulary, which decides where the
 * snapshot is kept. The runtime knows only `key`, `version`, and `value`. That ignorance lets one
 * store serve studio preview, web playback, native playback, tests, and future save slots.
 *
 * No storage location is chosen here. There is no Postgres, REST, Dexie, SQLite, or sync record in
 * this file. It defines a portable contract for consumers such as `@rowcat/runtime-persistence`.
 *
 * Unknown entries are not deleted. A key that the creator source does not define right now is kept
 * as is. Creators often remove a module and re-add it, and a run during that gap must not erase
 * player progress. Only an explicit reset deletes data.
 */

export const DURABLE_SNAPSHOT_FORMAT_VERSION = 1;

export interface RuntimeDurableStateEntry {
	readonly key: string;
	/** The version of the creator's schema, not the runtime API version. */
	readonly version: number;
	readonly value: RuntimeWireValue;
}

export interface RuntimeDurableStateSnapshot {
	readonly formatVersion: typeof DURABLE_SNAPSHOT_FORMAT_VERSION;
	/** Sorted by key. The same logical state always has the same representation. */
	readonly entries: readonly RuntimeDurableStateEntry[];
}

export interface RuntimeDurableStateLimits {
	/** Maximum number of entries in one snapshot, on the same axis as the definition count limit. */
	maxEntries: number;
	maxEntrySerializedLength: number;
	maxSnapshotSerializedLength: number;
}

/**
 * Not production values. That a limit exists is the structure. Without one, a single interactive
 * story could use persistent state as an unbounded object store.
 */
export const DEFAULT_DURABLE_STATE_LIMITS: RuntimeDurableStateLimits =
	Object.freeze({
		maxEntries: 128,
		maxEntrySerializedLength: 64 * 1024,
		maxSnapshotSerializedLength: 1024 * 1024,
	});

/**
 * Key shape. Must match the VM-side rule exactly; if they diverge, each side accepts different
 * keys.
 */
const KEY_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const KEY_MAX_LENGTH = 64;

export const isDurableStateKey = (value: unknown): value is string =>
	typeof value === "string" &&
	value.length <= KEY_MAX_LENGTH &&
	KEY_PATTERN.test(value);

export const isDurableStateVersion = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

export const emptyDurableStateSnapshot = (): RuntimeDurableStateSnapshot =>
	Object.freeze({
		formatVersion: DURABLE_SNAPSHOT_FORMAT_VERSION,
		entries: Object.freeze([]) as readonly RuntimeDurableStateEntry[],
	});

export type DurableStateValidation =
	| { ok: true; snapshot: RuntimeDurableStateSnapshot }
	| { ok: false; reason: string };

/**
 * Whether a snapshot may pass through this host. Having written it earlier is not the basis. Stored
 * JSON can be edited by hand, may have been written by a different code version, or may have been
 * truncated in transit. This is the last check before the trusted host hands the snapshot to the
 * VM. `label` appears only in the rejection message. The verdict is the same for every lifetime.
 */
export function validateDurableStateSnapshot(
	label: string,
	value: unknown,
	limits: RuntimeDurableStateLimits = DEFAULT_DURABLE_STATE_LIMITS,
	wireLimits: RuntimeWireLimits = DEFAULT_WIRE_LIMITS,
): DurableStateValidation {
	if (value === null || value === undefined)
		return { ok: true, snapshot: emptyDurableStateSnapshot() };
	if (typeof value !== "object" || Array.isArray(value))
		return { ok: false, reason: `${label} snapshot must be an object` };
	const shape = value as { formatVersion?: unknown; entries?: unknown };
	if (shape.formatVersion !== DURABLE_SNAPSHOT_FORMAT_VERSION)
		return {
			ok: false,
			reason: `${label} snapshot formatVersion must be ${DURABLE_SNAPSHOT_FORMAT_VERSION}`,
		};
	if (!Array.isArray(shape.entries))
		return {
			ok: false,
			reason: `${label} snapshot entries must be an array`,
		};
	const raw = shape.entries as readonly unknown[];
	if (raw.length > limits.maxEntries)
		return {
			ok: false,
			reason: `${label} snapshot has ${raw.length} entries, limit is ${limits.maxEntries}`,
		};

	const seen = new Set<string>();
	const entries: RuntimeDurableStateEntry[] = [];
	let total = 0;
	for (const item of raw) {
		if (typeof item !== "object" || item === null || Array.isArray(item))
			return { ok: false, reason: `${label} entry must be an object` };
		const entry = item as { key?: unknown; version?: unknown; value?: unknown };
		if (!isDurableStateKey(entry.key))
			return { ok: false, reason: `${label} entry key is not a valid key` };
		if (!isDurableStateVersion(entry.version))
			return {
				ok: false,
				reason: `${label} entry "${entry.key}" version must be a positive safe integer`,
			};
		if (seen.has(entry.key))
			return {
				ok: false,
				reason: `${label} snapshot has duplicate key "${entry.key}"`,
			};
		const wire = checkWireValue(entry.value, wireLimits);
		if (!wire.ok)
			return {
				ok: false,
				reason: `${label} entry "${entry.key}" value is not serializable: ${wire.reason}`,
			};
		const length = JSON.stringify(entry.value).length;
		if (length > limits.maxEntrySerializedLength)
			return {
				ok: false,
				reason: `${label} entry "${entry.key}" is ${length} chars, limit is ${limits.maxEntrySerializedLength}`,
			};
		total += length;
		if (total > limits.maxSnapshotSerializedLength)
			return {
				ok: false,
				reason: `${label} snapshot exceeds ${limits.maxSnapshotSerializedLength} chars`,
			};
		seen.add(entry.key);
		entries.push({
			key: entry.key,
			version: entry.version,
			value: entry.value as RuntimeWireValue,
		});
	}
	return { ok: true, snapshot: canonicalDurableStateSnapshot(entries) };
}

/**
 * Canonical form, sorted by key. The same logical state yields the same bytes regardless of
 * definition module order, import traversal, or update order. Object insertion order is not part of
 * the storage contract.
 */
export function canonicalDurableStateSnapshot(
	entries: readonly RuntimeDurableStateEntry[],
): RuntimeDurableStateSnapshot {
	const sorted = [...entries].sort((left, right) =>
		left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
	);
	return deepFreeze({
		formatVersion: DURABLE_SNAPSHOT_FORMAT_VERSION,
		entries: sorted.map((entry) => ({
			key: entry.key,
			version: entry.version,
			value: entry.value,
		})),
	}) as RuntimeDurableStateSnapshot;
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object") return value;
	for (const entry of Object.values(value as Record<string, unknown>))
		deepFreeze(entry);
	return Object.freeze(value);
}

/**
 * The current durable state the trusted host holds, in memory only. Dexie, SQLite, and servers are
 * not here. This store answers one question: what is the snapshot for this lifetime right now.
 * Where it is kept and for how long is not decided by this file.
 */
export class RuntimeDurableStateStore {
	/**
	 * Values are held serialized and parsed anew on export, so no editable copy exists outside the
	 * store.
	 */
	private readonly entries = new Map<
		string,
		{ version: number; json: string }
	>();
	private commits = 0;

	constructor(snapshot?: RuntimeDurableStateSnapshot) {
		if (snapshot !== undefined) this.restore(snapshot);
	}

	/**
	 * Replaces the whole snapshot; anything already present is removed. This is the input to
	 * hydration. The name is `restore`, not `import`, on purpose. The boundary check in
	 * `boundaries.test.ts` blocks dynamic `import(` by name, and `store.import(...)` would match that
	 * pattern.
	 */
	restore(snapshot: RuntimeDurableStateSnapshot): void {
		this.entries.clear();
		this.apply(snapshot.entries);
	}

	/**
	 * Applies one commit delta. Only changed keys arrive, so this function never removes unknown
	 * entries; keys absent from the list are left alone.
	 */
	apply(entries: readonly RuntimeDurableStateEntry[]): void {
		for (const entry of entries)
			this.entries.set(entry.key, {
				version: entry.version,
				json: JSON.stringify(entry.value),
			});
		if (entries.length > 0) this.commits += 1;
	}

	/** The current canonical snapshot. It is frozen and shares nothing with this store. */
	snapshot(): RuntimeDurableStateSnapshot {
		return canonicalDurableStateSnapshot(
			[...this.entries].map(([key, entry]) => ({
				key,
				version: entry.version,
				value: JSON.parse(entry.json) as RuntimeWireValue,
			})),
		);
	}

	/** Reset. Unknown entries are removed too; that is the intent of this operation. */
	clear(): void {
		this.entries.clear();
	}

	get size(): number {
		return this.entries.size;
	}

	/** Whether the key already exists. A delta counts only newly added entries against the limit. */
	has(key: string): boolean {
		return this.entries.has(key);
	}

	/**
	 * Current serialized length of this key, or 0 if absent. Used to compute the total after a delta
	 * overwrites an entry.
	 */
	serializedLengthOf(key: string): number {
		return this.entries.get(key)?.json.length ?? 0;
	}

	/** Sum of serialized lengths. This is for measurement, not a basis for correctness. */
	get serializedLength(): number {
		let total = 0;
		for (const entry of this.entries.values()) total += entry.json.length;
		return total;
	}

	get appliedCommits(): number {
		return this.commits;
	}
}
