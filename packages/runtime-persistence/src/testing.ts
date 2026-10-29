import type { Rev } from "@rowcat/contracts/sync";
import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import {
	DEFAULT_RUNTIME_SAVE_SLOT,
	type RuntimePersistentRecord,
	type RuntimePlaythroughRecord,
	type RuntimeSaveSlot,
	runtimePersistentIdFor,
	runtimePlaythroughIdFor,
} from "./model.ts";
import type {
	RuntimePersistentWrite,
	RuntimePlaythroughWrite,
	RuntimeSaveStore,
} from "./store.ts";

/**
 * In-memory save store. It is a tool for measuring the coordinator's rules, not a product adapter.
 * Product adapters are Dexie and SQLite, and both pass the contract suite (store-contract.ts). This
 * implementation only opens the axes that suite cannot measure: slow writes, failed writes, and
 * corrupt rows. A real store cannot make those three deterministic. Issuing revisions here is how
 * the contract is expressed: the store issues them inside its own transaction.
 */
export interface MemorySaveStoreOptions {
	initialSyncDone?: boolean;
	deviceId?: string;
}

export interface MemorySaveStore extends RuntimeSaveStore {
	/**
	 * Order of committed writes. Snapshots are kept too, so 'which write came later' can be asserted
	 * by value.
	 */
	readonly writes: { kind: "playthrough" | "persistent"; snapshot: unknown }[];
	/** Holds all writes until open() is called. Writes must be slow for merging to be measurable. */
	gate(): void;
	/**
	 * Holds only the next write. Later writes pass through. This measures races between coordinators.
	 * gate() puts every write behind one door and releases them FIFO, so 'a late write from an old
	 * session overwrites a new session's write' cannot be expressed. Real store writes are
	 * independent, so the one that started first may finish last.
	 */
	gateNext(): void;
	open(): void;
	failNext(message: string): void;
	failReads(message: string): void;
	corruptPlaythrough(): void;
	rawPlaythrough(storyId: string): Promise<unknown>;
}

export function createMemorySaveStore(
	options: MemorySaveStoreOptions = {},
): MemorySaveStore {
	const playthroughs = new Map<string, RuntimePlaythroughRecord>();
	const persistents = new Map<string, RuntimePersistentRecord>();
	const writes: { kind: "playthrough" | "persistent"; snapshot: unknown }[] =
		[];
	const deviceId = options.deviceId ?? "memory-device";
	let counter = 0;
	let gateResolve: (() => void) | null = null;
	let gated: Promise<void> | null = null;
	let nextGated: Promise<void> | null = null;
	let failNextMessage: string | null = null;
	let readFailure: string | null = null;

	const nextRev = (): Rev => ({ t: ++counter, c: 0, d: deviceId });

	const passGate = async (): Promise<void> => {
		if (nextGated !== null) {
			const held = nextGated;
			nextGated = null;
			await held;
		}
		if (gated !== null) await gated;
		if (failNextMessage !== null) {
			const message = failNextMessage;
			failNextMessage = null;
			throw new Error(message);
		}
	};

	const assertReadable = (): void => {
		if (readFailure !== null) throw new Error(readFailure);
	};

	return {
		writes,
		gate() {
			gated = new Promise<void>((resolve) => {
				gateResolve = resolve;
			});
		},
		gateNext() {
			nextGated = new Promise<void>((resolve) => {
				gateResolve = resolve;
			});
		},
		open() {
			gateResolve?.();
			gated = null;
			nextGated = null;
			gateResolve = null;
		},
		failNext(message: string) {
			failNextMessage = message;
		},
		failReads(message: string) {
			readFailure = message;
		},
		corruptPlaythrough() {
			for (const [id, record] of playthroughs)
				playthroughs.set(id, {
					...record,
					snapshot: { formatVersion: 9 } as never,
				});
		},
		async rawPlaythrough(storyId: string) {
			return playthroughs.get(runtimePlaythroughIdFor(storyId)) ?? null;
		},

		async getPlaythrough(
			storyId: string,
			slot: RuntimeSaveSlot = DEFAULT_RUNTIME_SAVE_SLOT,
		) {
			assertReadable();
			return playthroughs.get(runtimePlaythroughIdFor(storyId, slot)) ?? null;
		},

		async putPlaythrough(write: RuntimePlaythroughWrite) {
			await passGate();
			const slot = write.slot ?? DEFAULT_RUNTIME_SAVE_SLOT;
			const id = runtimePlaythroughIdFor(write.storyId, slot);
			const previous = playthroughs.get(id) ?? null;
			const record: RuntimePlaythroughRecord = {
				id,
				storyId: write.storyId,
				slot,
				snapshot: write.snapshot as RuntimeStoryStateSnapshot,
				updatedAt: write.updatedAt,
				deletedAt: null,
				dirty: 1,
				serverVersion: previous?.serverVersion ?? 0,
				rev: nextRev(),
			};
			playthroughs.set(id, record);
			writes.push({ kind: "playthrough", snapshot: write.snapshot });
			return record;
		},

		async getPersistent(storyId: string) {
			assertReadable();
			return persistents.get(runtimePersistentIdFor(storyId)) ?? null;
		},

		async putPersistent(write: RuntimePersistentWrite) {
			await passGate();
			const id = runtimePersistentIdFor(write.storyId);
			const previous = persistents.get(id) ?? null;
			const record: RuntimePersistentRecord = {
				id,
				storyId: write.storyId,
				snapshot: write.snapshot as RuntimePersistentStateSnapshot,
				updatedAt: write.updatedAt,
				deletedAt: null,
				dirty: 1,
				serverVersion: previous?.serverVersion ?? 0,
				rev: nextRev(),
			};
			persistents.set(id, record);
			writes.push({ kind: "persistent", snapshot: write.snapshot });
			return record;
		},

		async initialSyncDone() {
			assertReadable();
			return options.initialSyncDone ?? false;
		},
	};
}

import {
	isVisibleRuntimeConversation,
	nextRuntimeConversation,
	type RuntimeConversationRecord,
	type RuntimeConversationRemoval,
	type RuntimeConversationStore,
	type RuntimeConversationTouch,
	runtimeConversationIdFor,
} from "./conversation.ts";

/**
 * In-memory library-metadata implementation. The contract suite measures it. It is not a product
 * adapter.
 */
export function createMemoryConversationStore(
	options: { deviceId?: string } = {},
): RuntimeConversationStore {
	const records = new Map<string, RuntimeConversationRecord>();
	const deviceId = options.deviceId ?? "memory-device";
	let counter = 0;
	const nextRev = (): Rev => ({ t: ++counter, c: 0, d: deviceId });

	return {
		async get(storyId, slot = DEFAULT_RUNTIME_SAVE_SLOT) {
			return records.get(runtimeConversationIdFor(storyId, slot)) ?? null;
		},
		async list() {
			return [...records.values()]
				.filter(isVisibleRuntimeConversation)
				.sort((a, b) =>
					a.updatedAt === b.updatedAt
						? b.id < a.id
							? -1
							: b.id > a.id
								? 1
								: 0
						: a.updatedAt < b.updatedAt
							? 1
							: -1,
				);
		},
		async touch(write: RuntimeConversationTouch) {
			const slot = write.slot ?? DEFAULT_RUNTIME_SAVE_SLOT;
			const id = runtimeConversationIdFor(write.storyId, slot);
			const previous = records.get(id) ?? null;
			const record: RuntimeConversationRecord = {
				...nextRuntimeConversation(previous, write),
				dirty: 1,
				serverVersion: previous?.serverVersion ?? 0,
				rev: nextRev(),
			};
			records.set(id, record);
			return record;
		},
		async remove(write: RuntimeConversationRemoval) {
			const id = runtimeConversationIdFor(
				write.storyId,
				write.slot ?? DEFAULT_RUNTIME_SAVE_SLOT,
			);
			const previous = records.get(id);
			if (!previous) return null;
			const record: RuntimeConversationRecord = {
				...previous,
				removedAt: previous.removedAt ?? write.now,
				updatedAt: write.now,
				dirty: 1,
				rev: nextRev(),
			};
			records.set(id, record);
			return record;
		},
	};
}
