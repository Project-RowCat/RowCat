/**
 * The "something changed on this device" signal, the only one automatic sync listens to.
 *
 * It carries one fact and no arguments: no room title, no message body, no draft id. The scheduling
 * layer only needs to know that something is ready to upload. Carrying more would let manuscript
 * text pass through the scheduler and eventually reach logs and diagnostics
 * (docs/sync/ARCHITECTURE.md §26).
 *
 * Why not liveQuery: Dexie's change observation also fires for changes sync itself applied. Pulled
 * records written to the database would come back as local changes, which trigger sync, which pulls
 * again, forever. So the signal comes from the write path. Only user actions pass through it, and
 * applyPull does not.
 *
 * Lifetime: one signal per scope, created at the same moment as the stores (activation.ts). A
 * module-level signal would keep a logged-out member's subscription alive for as long as the tab
 * lives, and that subscription holds the previous member's store instance.
 */

export interface LocalMutationSignal {
	/** Called after a local change commits. A failed write has nothing to report. */
	notify(): void;
	subscribe(listener: () => void): () => void;
}

export function createLocalMutationSignal(): LocalMutationSignal {
	const listeners = new Set<() => void>();
	return {
		notify() {
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

/**
 * Wraps the store's write methods so each successful write emits the signal.
 *
 * The read list is the input, and every other method is treated as a write. The direction matters
 * because of the costs of each mistake. A missed write leaves the change on this device until the
 * next lifecycle signal, and nothing reports it. A fail-safe default is the right one for a store
 * that will gain methods later.
 *
 * The opposite error is costly too. If a read is classified as a write, every read wakes sync. If a
 * screen subscribes to that read, the result is read, signal, read, forever. stores.test.ts checks
 * real keys to confirm that read-named methods are on the read list.
 *
 * Wrapping happens at the assembly point, not inside the ChatStore or AuthoringStore
 * implementations. If those called notify() directly, the product stores would know about sync, and
 * every new write method would need that line too.
 *
 * Only successful calls emit the signal. A write that throws did not commit, and an uncommitted
 * change cannot be uploaded.
 */
export function withMutationSignal<T extends object>(
	store: T,
	reads: ReadonlySet<keyof T & string>,
	signal: LocalMutationSignal,
): T {
	const wrapped: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(store)) {
		if (typeof value !== "function" || reads.has(key as keyof T & string)) {
			wrapped[key] = value;
			continue;
		}
		const method = value as (...args: unknown[]) => unknown;
		wrapped[key] = async (...args: unknown[]): Promise<unknown> => {
			const result = await method.apply(store, args);
			signal.notify();
			return result;
		};
	}
	return wrapped as T;
}
