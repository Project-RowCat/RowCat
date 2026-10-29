/**
 * The event handler registry. Functions stay in the VM; the host sees only numbers.
 *
 * At commit, each handler such as `onPress={fn}` gets an id, and the host tree holds it as {
 * "$handler": 41 }. When the host dispatches event 41, the registry finds the function and calls
 * it. When the prop changes or is removed, the id is released, and any later event for it is stale.
 *
 * Identity follows the function. The same function object keeps the same id, so a callback kept
 * stable with `useCallback` keeps its number across re-renders. An arrow function created on every
 * render gets a new id on each commit, and the old one is released. One function may sit in two
 * places, so references are counted: one place releasing an id does not kill it while another still
 * holds it.
 *
 * Ids are never reused. Reuse would let a stale event (one the native queue delivered after a
 * commit) call a different handler, so the user's press would run something else. An event for a
 * released id is simply gone. The outcome is stale, not a failure.
 *
 * Function source is never sent. Closures are not serialized, and sending them would load creator
 * code into the host realm.
 */

type Handler = (...args: unknown[]) => unknown;

interface Entry {
	readonly id: number;
	readonly fn: Handler;
	refs: number;
}

export class HandlerRegistry {
	private readonly byFn = new Map<Handler, Entry>();
	private readonly byId = new Map<number, Entry>();
	private nextId = 1;

	acquire(fn: Handler): number {
		const existing = this.byFn.get(fn);
		if (existing !== undefined) {
			existing.refs += 1;
			return existing.id;
		}
		const entry: Entry = { id: this.nextId++, fn, refs: 1 };
		this.byFn.set(fn, entry);
		this.byId.set(entry.id, entry);
		return entry.id;
	}

	release(id: number): void {
		const entry = this.byId.get(id);
		if (entry === undefined) return;
		entry.refs -= 1;
		if (entry.refs > 0) return;
		this.byId.delete(id);
		this.byFn.delete(entry.fn);
	}

	/**
	 * Returns the function for a live id, or `null` if the id is dead or missing. It does not throw,
	 * because stale events are normal.
	 */
	lookup(id: number): Handler | null {
		return this.byId.get(id)?.fn ?? null;
	}

	get size(): number {
		return this.byId.size;
	}

	clear(): void {
		this.byFn.clear();
		this.byId.clear();
	}
}
