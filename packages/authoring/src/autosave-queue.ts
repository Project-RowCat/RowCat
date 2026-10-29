import type { AuthoringStore } from "./store.ts";

/**
 * Pending queue and single write pass for autosave. It has no timers or React, so web and mobile
 * share it. Moved here from the web app when mobile became a second consumer. Three decisions:
 * - A change that fails to write goes back into the queue. The old code emptied the queue first,
 *   so a failed write lost the text.
 * - A restored change never overwrites a newer value entered during the write.
 * - Changes for different stores are never merged. A change left from a previous account must not
 *   reach another user's database.
 */

export type PendingKind =
	| "draft"
	| "lore"
	| "startScene"
	| "sceneImage"
	/**
	 * Runtime source file. It is typed text, so it behaves like the other four pending kinds. The
	 * studio does not keep its own save path. Code files go through this queue, so the flush rules (on
	 * collapse, navigation and just before publish) apply to them too, and save status is shared.
	 */
	| "runtimeFile";

export interface PendingEntry {
	kind: PendingKind;
	id: string;
	patch: Record<string, unknown>;
	/**
	 * The store this change is destined for. The account can change while a change is pending, and the
	 * current store then belongs to someone else. Flushing into it would write an unrequested change
	 * into another person's database. Holding the store instance lets the queue check before flushing.
	 */
	store: AuthoringStore;
}

export interface AutosaveQueue {
	readonly size: number;
	/** Adds one change. For the same record, it is merged over the earlier pending change. */
	push: (entry: PendingEntry) => void;
	/** Takes out all pending changes in the order they were scheduled, and empties the queue. */
	drain: () => PendingEntry[];
	/** Puts back changes that could not be written. Values that arrived in the meantime win. */
	restore: (entries: PendingEntry[]) => void;
}

/**
 * Queue key. One entry per record, so editing the same field ten times still produces one write.
 */
const keyOf = (entry: PendingEntry): string => `${entry.kind}:${entry.id}`;

export function createAutosaveQueue(): AutosaveQueue {
	const entries = new Map<string, PendingEntry>();

	/**
	 * Folds two changes into one. `winner` is the later value. If the stores differ, nothing is merged
	 * and only the later change is kept. Two accounts never share a draft id, since ids are created on
	 * the device. The same person signing out and back in does keep the id, though. Merging across
	 * those sessions would place old text over the current value.
	 */
	const merge = (older: PendingEntry, winner: PendingEntry): PendingEntry =>
		older.store === winner.store
			? { ...winner, patch: { ...older.patch, ...winner.patch } }
			: winner;

	return {
		get size() {
			return entries.size;
		},

		push(entry) {
			const key = keyOf(entry);
			const previous = entries.get(key);
			entries.set(key, previous ? merge(previous, entry) : entry);
		},

		drain() {
			const drained = [...entries.values()];
			entries.clear();
			return drained;
		},

		restore(failed) {
			for (const entry of failed) {
				const key = keyOf(entry);
				const newer = entries.get(key);
				// The restored entry is the past. If a newer value arrived while writing, that value wins.
				entries.set(key, newer ? merge(entry, newer) : entry);
			}
		},
	};
}

/**
 * Result of one write pass. `pending` is kept apart from `saved` because the screen shows `Saved`
 * only when it is true. If a change arrived during the write, the saved value is already stale, so
 * `Saved` would be false.
 */
export type AutosaveFlushResult =
	| { status: "empty" | "saved" | "pending" }
	/**
	 * The write failed. The failed changes were put back in the queue and will be retried next pass.
	 */
	| { status: "failed"; error: unknown };

export interface CommitQueueInput {
	queue: AutosaveQueue;
	/**
	 * Whether this store still belongs to the active scope right now. It is passed as a predicate
	 * because ownership is decided differently on each platform. When to ask is the same everywhere,
	 * and that order is what this module must enforce.
	 */
	ownsStore: (store: AuthoringStore) => boolean;
	commit: (entry: PendingEntry) => Promise<unknown>;
}

/**
 * Writes pending changes in order. A change whose store is no longer owned is dropped, not retried.
 * Keeping it would re-run the check next pass, and if the original account came back, minutes-old
 * text could overwrite current data. A drop is not counted as failed. On failure, the failed entry
 * and every entry after it are put back. Earlier entries were already written, so restoring them
 * would write old values again. Discarding the failed one would lose the user's text.
 */
export async function commitQueue({
	queue,
	ownsStore,
	commit,
}: CommitQueueInput): Promise<AutosaveFlushResult> {
	if (queue.size === 0) return { status: "empty" };

	const live = queue.drain().filter((entry) => ownsStore(entry.store));
	if (live.length === 0) return { status: "empty" };

	let written = 0;
	try {
		for (const entry of live) {
			await commit(entry);
			written++;
		}
	} catch (error) {
		queue.restore(live.slice(written));
		return { status: "failed", error };
	}

	// If a new change arrived during the write, the result is not `Saved`.
	return { status: queue.size > 0 ? "pending" : "saved" };
}
