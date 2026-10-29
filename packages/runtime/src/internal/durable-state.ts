import { type RUNTIME_ERROR_CODE, RuntimeError } from "./errors.ts";
import {
	isSerializable,
	type Serializable,
	type SerializableShape,
	serializedLength,
} from "./serializable.ts";

/**
 * The neutral core of the durable state engine. It is a machine that does not know lifetimes.
 *
 * Layers: `durable-state` holds the definition registry, validation, migrations, pending values,
 * commit and the canonical snapshot. `story-state` (this playthrough's values) and
 * `persistent-state` (account and a work's long progress) sit on top.
 *
 * The two lifetimes share one machine but are not the same thing. The same key may appear in both
 * registries without conflict, since `progress` may belong to either lifetime. The two snapshots
 * are separate, so one lifetime's reset does not touch the other.
 *
 * The core was extracted rather than copied because the subtle parts (atomicity of pending values,
 * the failure direction of migrations, canonical ordering, owned copies of initial values) must
 * give the same answer for both lifetimes. Two copies would drift, and the drift would show up as
 * progress vanishing from only one lifetime. Phase 6A had this code in `story-state.ts` alone.
 *
 * The core knows nothing about storage location, accounts, works, save slots, devices or sync
 * revisions. It knows only `key`, `version` and `value`, so the same engine means the same thing in
 * the studio preview, web playback, native playback and tests.
 */

/**
 * Migrates a value from an old version to the shape of the current version. This is creator code
 * and runs inside the VM. The host cannot know the creator's TypeScript types (there is no schema
 * at runtime), so only the creator can write this. The result is always the current definition's
 * shape, and the runtime checks again that it is serializable.
 */
export type DurableStateMigration<T> = (
	stored: Serializable,
	fromVersion: number,
) => T;

/** Structure shared by both lifetimes, before the lifetime brand is applied. */
export interface DurableStateDefinitionBase<T> {
	/**
	 * The storage key is the identity of the definition. It is a string, not a variable name, because
	 * stored values outlive the code. A refactor that renames a variable must not lose stored state.
	 */
	readonly key: string;
	/**
	 * This is the version of the creator's schema, not of the runtime API. It rises when the stored
	 * shape changes. The only way to read an older version is `migrate`.
	 */
	readonly version: number;
	readonly initial: T;
	readonly migrate: DurableStateMigration<T> | null;
}

export interface DurableStateInput<T> {
	key: string;
	version: number;
	initial: T;
	migrate?: DurableStateMigration<T>;
}

/**
 * The serialization check must not sit in the position of `initial`. This is the most error-prone
 * spot in the mechanism. The most natural shape, `initial: T & SerializableShape<T>`, was used in
 * Phase 1. Nobody read that value then, so the problem stayed hidden. `useStoryState` exposed it:
 * the intersection became the inference source, so `{ trust: 40 }` narrowed to the literal 40, and
 * `setStory((c) => ({ ...c, trust: c.trust + 10 }))` then failed because number is not assignable
 * to 40. A state type that cannot change its value is the opposite of this API's meaning.
 *
 * So inference happens only from `initial: T` (literals widen normally), and the check is a
 * conditional intersection that resolves after T is fixed. A deferred conditional type is not an
 * inference source, so it does not disturb widening. The rejection message stating the requirement
 * follows from this structure.
 *
 * The brand name is in English on purpose. TypeScript diagnostics turn non-ASCII characters into
 * unicode escape sequences, so a Korean name would show creators an unreadable message.
 */
export type DurableStateInputChecked<T> = DurableStateInput<T> &
	([T] extends [SerializableShape<T>]
		? unknown
		: {
				readonly "initial must be serializable: no functions, Date, Map, Set, class instances, NaN, or cycles": never;
			});

/**
 * Upper bound of the definition version: all safe integers. While migrations did not exist, this
 * was 1, meaning this runtime could read version 1 only. There was no way to move old values, so no
 * new version could be made. With migrations in place that meaning is gone. The version is the
 * creator's schema version, and the runtime only needs the value to compare deterministically.
 */
export const DURABLE_STATE_VERSION_MAX = Number.MAX_SAFE_INTEGER;

/** Allowed key shape. It is kept narrow to match the runtime path. Widening it later is open. */
const KEY_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const KEY_MAX_LENGTH = 64;

export function checkDurableStateKey(key: unknown): key is string {
	return (
		typeof key === "string" &&
		key.length <= KEY_MAX_LENGTH &&
		KEY_PATTERN.test(key)
	);
}

export function checkDurableStateVersion(version: unknown): version is number {
	return (
		typeof version === "number" &&
		Number.isSafeInteger(version) &&
		version >= 1 &&
		version <= DURABLE_STATE_VERSION_MAX
	);
}

export interface DurableStateLimits {
	maxDefinitions: number;
	maxEntrySerializedLength: number;
	maxSnapshotSerializedLength: number;
}

/**
 * Not an operating value; the host changes it during hydration. Having a limit is the design:
 * without one, a single interactive story would use durable state as an unbounded object store.
 */
export const DEFAULT_DURABLE_STATE_LIMITS: DurableStateLimits = Object.freeze({
	maxDefinitions: 128,
	maxEntrySerializedLength: 64 * 1024,
	maxSnapshotSerializedLength: 1024 * 1024,
});

export interface DurableStateEntryWire {
	readonly key: string;
	readonly version: number;
	readonly value: Serializable;
}

export interface DurableStateSnapshotWire {
	readonly formatVersion: 1;
	readonly entries: readonly DurableStateEntryWire[];
}

let sealed = false;

/**
 * Closes the registries. The first hydration calls this. The flag is one for both lifetimes, not
 * one per lifetime. That is the quietest decision in this file. With a flag per lifetime there
 * would be a window after the story is hydrated and before the persistent one is, in which
 * `definePersistentState` still succeeds. Its value would show without being in this session's
 * snapshot. All definitions are made during module evaluation, so that window has no reason to
 * exist.
 */
export function sealDurableStateRegistries(): void {
	sealed = true;
}

export function areDurableStateRegistriesSealed(): boolean {
	return sealed;
}

/**
 * The error codes this lifetime uses. The code, not the message, is what tells the lifetimes apart.
 */
export interface DurableScopeCodes {
	invalidDefinition: string;
	definitionLate: string;
	duplicateKey: string;
	valueInvalid: string;
	limitExceeded: string;
	migrationFailed: string;
	migrationInvalid: string;
	versionNewer: string;
	snapshotInvalid: string;
}

export interface DurableScopeConfig {
	/** Name used in diagnostics: `Story state` for story state, `Persistent state` for persistent state. */
	label: string;
	/**
	 * Name of the public function that creates definitions. Error messages use it to tell the creator
	 * what to do next.
	 */
	defineApi: string;
	hookApi: string;
	codes: DurableScopeCodes;
}

interface ScopeEntry {
	readonly definition: DurableStateDefinitionBase<unknown>;
	/** The value on screen. Only a successful commit replaces it. */
	committed: Serializable;
	/**
	 * This turn's update. When `hasPending` is false it has no meaning, since `undefined` is not a
	 * storable value.
	 */
	pending: Serializable;
	hasPending: boolean;
}

export interface DurableScopeCounters {
	definitions: number;
	reads: number;
	updates: number;
	commits: number;
	entriesCommitted: number;
	migrations: number;
	migrationFailures: number;
}

export interface DurableScope {
	readonly config: DurableScopeConfig;
	createDefinition<T>(
		input: DurableStateInputChecked<T>,
	): DurableStateDefinitionBase<T>;
	register(definition: DurableStateDefinitionBase<unknown>): void;
	/** Checks that the value is a definition actually registered here, and returns its key. */
	keyOf(definition: unknown, isDefinition: (value: unknown) => boolean): string;
	hydrate(snapshot: unknown, nextLimits?: unknown): DurableStateSnapshotWire;
	read(key: string): Serializable;
	queue(key: string, action: unknown): boolean;
	pendingDelta(): DurableStateEntryWire[];
	commit(): number;
	metrics(): Readonly<DurableScopeCounters>;
	reset(): void;
}

const describe = (error: unknown): string =>
	error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * An owned copy of a value, so the definition's initial value does not become the state itself. The
 * definition is frozen, but nested objects inside it are not. If the initial value were used
 * directly, a creator's mutation of that object would make the next reset start from an already
 * changed value. The copy rebuilds the structure instead of using a JSON round trip, because the
 * copy must be frozen too.
 */
function ownValue(value: Serializable): Serializable {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return Object.freeze(value.map(ownValue));
	const copy: Record<string, Serializable> = {};
	for (const [key, entry] of Object.entries(
		value as { readonly [key: string]: Serializable },
	))
		copy[key] = ownValue(entry);
	return Object.freeze(copy);
}

/**
 * Creates the engine for one lifetime. Called once per module, at module evaluation. The registry
 * and values live in this closure. With two scopes, each has its own registry, so the same key on
 * both sides is not a conflict, and there is no syntax by which one scope's reset could touch the
 * other's values.
 */
export function createDurableScope(config: DurableScopeConfig): DurableScope {
	const definitions = new Map<string, DurableStateDefinitionBase<unknown>>();
	const entries = new Map<string, ScopeEntry>();
	let hydrated = false;
	let limits: DurableStateLimits = DEFAULT_DURABLE_STATE_LIMITS;
	const counters: DurableScopeCounters = {
		definitions: 0,
		reads: 0,
		updates: 0,
		commits: 0,
		entriesCommitted: 0,
		migrations: 0,
		migrationFailures: 0,
	};

	const fail = (code: string, message: string): RuntimeError =>
		new RuntimeError(
			code as (typeof RUNTIME_ERROR_CODE)[keyof typeof RUNTIME_ERROR_CODE],
			message,
		);

	/** Checks whether a value can be stored. Serializability is checked first, then the limits. */
	function assertStorable(key: string, value: unknown): Serializable {
		if (!isSerializable(value))
			throw fail(
				config.codes.valueInvalid,
				`${config.label} "${key}" must be serializable. Functions, Date, Map, Set, class instances, NaN and circular references are not saved.`,
			);
		if (serializedLength(value) > limits.maxEntrySerializedLength)
			throw fail(
				config.codes.limitExceeded,
				`${config.label} "${key}" exceeds the limit (${limits.maxEntrySerializedLength} characters).`,
			);
		return value;
	}

	function entryOf(key: string): ScopeEntry {
		const entry = entries.get(key);
		if (entry === undefined)
			throw fail(
				config.codes.definitionLate,
				`${config.label} "${key}" has not been hydrated.`,
			);
		return entry;
	}

	function readSnapshotEntries(
		snapshot: unknown,
	): Map<string, DurableStateEntryWire> {
		const table = new Map<string, DurableStateEntryWire>();
		if (snapshot === undefined || snapshot === null) return table;
		const shape = snapshot as { formatVersion?: unknown; entries?: unknown };
		if (shape.formatVersion !== 1)
			throw fail(
				config.codes.snapshotInvalid,
				`The ${config.label} snapshot's formatVersion is not 1.`,
			);
		if (!Array.isArray(shape.entries))
			throw fail(
				config.codes.snapshotInvalid,
				`The ${config.label} snapshot's entries is not an array.`,
			);
		let total = 0;
		for (const raw of shape.entries as readonly unknown[]) {
			const entry = raw as {
				key?: unknown;
				version?: unknown;
				value?: unknown;
			};
			if (!checkDurableStateKey(entry.key))
				throw fail(
					config.codes.snapshotInvalid,
					`A key in the ${config.label} snapshot breaks the rules.`,
				);
			if (!checkDurableStateVersion(entry.version))
				throw fail(
					config.codes.snapshotInvalid,
					`The "${entry.key}" entry in the ${config.label} snapshot has no valid version.`,
				);
			if (table.has(entry.key))
				throw fail(
					config.codes.snapshotInvalid,
					`The ${config.label} snapshot has key "${entry.key}" twice.`,
				);
			if (!isSerializable(entry.value))
				throw fail(
					config.codes.snapshotInvalid,
					`The "${entry.key}" value in the ${config.label} snapshot is not serializable.`,
				);
			const length = serializedLength(entry.value);
			if (length > limits.maxEntrySerializedLength)
				throw fail(
					config.codes.limitExceeded,
					`The "${entry.key}" value in the ${config.label} snapshot exceeds the limit.`,
				);
			total += length;
			if (total > limits.maxSnapshotSerializedLength)
				throw fail(
					config.codes.limitExceeded,
					`The ${config.label} snapshot exceeds the limit.`,
				);
			table.set(entry.key, {
				key: entry.key,
				version: entry.version,
				value: entry.value,
			});
		}
		return table;
	}

	/**
	 * Turns one stored entry into a value of the current version. Migrations are creator code and run
	 * within the VM's budget and memory. If a migration throws, hydration fails and the session does
	 * not start. Silently falling back to `initial` would turn a creator's migration bug into the
	 * deletion of the player's progress.
	 */
	function resolveStored(
		definition: DurableStateDefinitionBase<unknown>,
		entry: DurableStateEntryWire,
	): Serializable {
		if (entry.version === definition.version)
			return ownValue(assertStorable(definition.key, entry.value));
		if (entry.version > definition.version)
			throw fail(
				config.codes.versionNewer,
				`The saved version of "${definition.key}" (${entry.version}) is higher than the current code's (${definition.version}). This saved data was made by newer code.`,
			);
		const { migrate } = definition;
		if (migrate === null)
			throw fail(
				config.codes.migrationFailed,
				`The saved version of "${definition.key}" is ${entry.version}, but there is no migrate. Add migrate to ${config.defineApi}.`,
			);
		let migrated: unknown;
		try {
			counters.migrations += 1;
			migrated = migrate(entry.value, entry.version);
		} catch (error) {
			counters.migrationFailures += 1;
			throw fail(
				config.codes.migrationFailed,
				`The migration of ${config.label} "${definition.key}" (${entry.version} → ${definition.version}) failed: ${describe(error)}`,
			);
		}
		if (!isSerializable(migrated)) {
			counters.migrationFailures += 1;
			throw fail(
				config.codes.migrationInvalid,
				`The migration result of ${config.label} "${definition.key}" is not serializable.`,
			);
		}
		if (serializedLength(migrated) > limits.maxEntrySerializedLength) {
			counters.migrationFailures += 1;
			throw fail(
				config.codes.migrationInvalid,
				`The migration result of ${config.label} "${definition.key}" exceeds the limit.`,
			);
		}
		return ownValue(migrated);
	}

	return {
		config,

		createDefinition<T>(
			input: DurableStateInputChecked<T>,
		): DurableStateDefinitionBase<T> {
			const { key, version, initial, migrate } = input;
			const invalid = (message: string): RuntimeError =>
				fail(config.codes.invalidDefinition, message);

			if (typeof key !== "string" || key.trim().length === 0)
				throw invalid(`A ${config.label} key can't be empty.`);
			if (!checkDurableStateKey(key))
				throw invalid(
					`A ${config.label} key starts with a letter and can use only letters, digits, \`_\` and \`-\`, up to ${KEY_MAX_LENGTH} characters.`,
				);
			if (!checkDurableStateVersion(version))
				throw invalid(
					`A ${config.label} version must be a safe integer of at least 1.`,
				);
			if (migrate !== undefined && typeof migrate !== "function")
				throw invalid(`A ${config.label} migrate must be a function.`);
			if (!isSerializable(initial))
				throw invalid(`A ${config.label} initial must be serializable.`);
			if (serializedLength(initial) > limits.maxEntrySerializedLength)
				throw fail(
					config.codes.limitExceeded,
					`The initial of ${config.label} "${key}" exceeds the limit (${limits.maxEntrySerializedLength} characters).`,
				);
			return {
				key,
				version,
				initial,
				migrate: migrate ?? null,
			};
		},

		/**
		 * Places a definition in the registry. This is the only path the public `define…` functions use.
		 * It runs at module evaluation. An ES module evaluates once even when three modules import it, so
		 * a duplicate key means two genuinely different definitions. The code does not pick one by
		 * evaluation order: the key is the identity of the stored value, and a wrong pick would read
		 * another definition's saved data.
		 */
		register(definition: DurableStateDefinitionBase<unknown>): void {
			if (sealed)
				throw fail(
					config.codes.definitionLate,
					`${config.defineApi}("${definition.key}") can be called only while the module is evaluated. Put ${config.label} definitions at the module top level.`,
				);
			if (definitions.has(definition.key))
				throw fail(
					config.codes.duplicateKey,
					`${config.label} key "${definition.key}" was defined twice. A key is the identity of saved values, so it must be unique within this lifetime.`,
				);
			if (definitions.size >= limits.maxDefinitions)
				throw fail(
					config.codes.limitExceeded,
					`There can be at most ${limits.maxDefinitions} ${config.label} definitions.`,
				);
			definitions.set(definition.key, definition);
			counters.definitions = definitions.size;
		},

		/**
		 * Gets the key from a hook's argument. Only definitions in the registry pass. A definition that
		 * is not registered was either created after sealing or comes from another realm, and neither
		 * belongs to this session's durable state. Definitions from the other lifetime are rejected here
		 * too, since a value in the other registry does not share a reference with this registry's same
		 * key.
		 */
		keyOf(
			definition: unknown,
			isDefinition: (value: unknown) => boolean,
		): string {
			if (!isDefinition(definition))
				throw fail(
					config.codes.valueInvalid,
					`${config.hookApi} must receive a definition made by ${config.defineApi}.`,
				);
			const key = (definition as DurableStateDefinitionBase<unknown>).key;
			if (definitions.get(key) !== definition)
				throw fail(
					config.codes.definitionLate,
					`The definition of ${config.label} "${key}" is not in the registry. Call ${config.defineApi} once at the module top level.`,
				);
			return key;
		},

		/**
		 * Layers a snapshot onto the registry and seals it, before the first render.
		 *
		 * - No entry for the definition: a copy of `initial`.
		 * - Same version: the stored value, after validation.
		 * - Stored version older: migrate, validate, then freeze at the new version.
		 * - Stored version newer: fail. Old code would be opening new storage.
		 * - Entry with no definition: never reaches here. The host's snapshot keeps it as it is.
		 *
		 * There is no async step. The frame where `initial` shows and then changes to the stored value
		 * does not exist. That frame would be a wrong screen, and a player who saw it would read their
		 * progress as lost.
		 */
		hydrate(snapshot: unknown, nextLimits?: unknown): DurableStateSnapshotWire {
			if (hydrated)
				throw fail(
					config.codes.snapshotInvalid,
					`${config.label} is hydrated only once per session.`,
				);
			if (nextLimits !== undefined && nextLimits !== null)
				limits = Object.freeze({
					...DEFAULT_DURABLE_STATE_LIMITS,
					...(nextLimits as Partial<DurableStateLimits>),
				});

			const stored = readSnapshotEntries(snapshot);
			sealDurableStateRegistries();
			hydrated = true;

			const resolved: DurableStateEntryWire[] = [];
			for (const key of [...definitions.keys()].sort()) {
				const definition = definitions.get(
					key,
				) as DurableStateDefinitionBase<unknown>;
				const entry = stored.get(key);
				const value =
					entry === undefined
						? ownValue(definition.initial as Serializable)
						: resolveStored(definition, entry);
				entries.set(key, {
					definition,
					committed: value,
					pending: null,
					hasPending: false,
				});
				resolved.push({ key, version: definition.version, value });
			}
			return { formatVersion: 1, entries: resolved };
		},

		/** Current value: the pending value over the committed value, if there is one. */
		read(key: string): Serializable {
			const entry = entryOf(key);
			counters.reads += 1;
			return entry.hasPending ? entry.pending : entry.committed;
		},

		/**
		 * One update: folds it, validates it, and places it in pending. Returns true when a re-render is
		 * needed. The same value (by `Object.is`) does nothing. The check runs after folding, so
		 * `setState(current => current)` and putting back the same object do not cause a render.
		 */
		queue(key: string, action: unknown): boolean {
			const entry = entryOf(key);
			const current = entry.hasPending ? entry.pending : entry.committed;
			const next =
				typeof action === "function"
					? (action as (value: Serializable) => unknown)(current)
					: action;
			if (Object.is(next, current)) return false;
			const stored = assertStorable(key, next);
			entry.pending = stored;
			entry.hasPending = true;
			counters.updates += 1;
			return true;
		},

		/**
		 * The entries this commit will emit. Does not consume them; they are cleared only after the
		 * commit is accepted.
		 */
		pendingDelta(): DurableStateEntryWire[] {
			const delta: DurableStateEntryWire[] = [];
			for (const key of [...entries.keys()].sort()) {
				const entry = entries.get(key) as ScopeEntry;
				if (!entry.hasPending) continue;
				delta.push({
					key,
					version: entry.definition.version,
					value: entry.pending,
				});
			}
			return delta;
		},

		/**
		 * Pending values become committed values. Called only after the host accepts the root's commit.
		 */
		commit(): number {
			let changed = 0;
			for (const entry of entries.values()) {
				if (!entry.hasPending) continue;
				entry.committed = entry.pending;
				entry.pending = null;
				entry.hasPending = false;
				changed += 1;
			}
			if (changed > 0) {
				counters.commits += 1;
				counters.entriesCommitted += changed;
			}
			return changed;
		},

		metrics(): Readonly<DurableScopeCounters> {
			return { ...counters };
		},

		reset(): void {
			definitions.clear();
			entries.clear();
			hydrated = false;
			limits = DEFAULT_DURABLE_STATE_LIMITS;
			counters.definitions = 0;
			counters.reads = 0;
			counters.updates = 0;
			counters.commits = 0;
			counters.entriesCommitted = 0;
			counters.migrations = 0;
			counters.migrationFailures = 0;
		},
	};
}

/** Lifts the seal. Tests call this after resetting the scope. */
export function unsealDurableStateRegistries(): void {
	sealed = false;
}
