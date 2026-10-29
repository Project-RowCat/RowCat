/**
 * The one signal that tells the later auto-sync "something changed on this device".
 *
 * It carries exactly one fact, which is the point of this file: no arguments. No room title,
 * message body or draft id is passed. The scheduler only needs to know that something is ready to
 * upload; carrying more would let the user's manuscript pass through the scheduler and eventually
 * reach logs and diagnostics.
 *
 * ## Why not database change observation
 *
 * SQLite has change hooks and Expo offers notifications on top of them. Not used: that kind of
 * observation also reacts to changes the sync itself applied. Pulled records written locally would
 * come back as "local changes" and re-trigger sync: pull → write → signal → pull, forever. So the
 * signal is emitted from the write path instead. Only user actions pass through it; `applyPull`
 * does not (`stores.ts`).
 *
 * ## Lifetime
 *
 * One signal per scope. At module scope a signed-out member's subscription would survive for the
 * whole life of the app, and it would hold the previous member's store instance.
 */

export interface LocalMutationSignal {
	/** Called after the local change is committed. A failed write has nothing to signal. */
	notify(): void;
	subscribe(listener: () => void): () => void;
	/** Snapshot axis for screen subscriptions; read by `useSyncExternalStore`. */
	version(): number;
}

export function createLocalMutationSignal(): LocalMutationSignal {
	const listeners = new Set<() => void>();
	let version = 0;
	return {
		notify() {
			version++;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		version: () => version,
	};
}

/**
 * Wraps the store's methods so each write emits a signal when it finishes.
 *
 * Every method not listed in `reads` is treated as a write, so the default fails safe. The
 * direction matters because the two mistakes cost differently: a missed write leaves that change on
 * this device until the next lifecycle signal, silently. Nobody updates this list when a method is
 * added, so the default must be the safe one.
 *
 * ⚠️ Misclassifying a read as a write is not cheap either. Every run of that read wakes sync, and
 * if a screen subscribes to that read through this signal you get a read → signal → read loop. So
 * `stores.test.ts` checks, by actual keys, that read-named methods are in the read list.
 *
 * Only successful calls signal. A thrown write was not committed, and an uncommitted change cannot
 * be uploaded.
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
