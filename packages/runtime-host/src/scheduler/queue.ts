import {
	PRIORITY_RANK,
	RUNTIME_WORK_PRIORITIES,
	type RuntimeWorkPriority,
} from "./priority.ts";

/**
 * Priority queue with four buckets, each a FIFO array. Not a heap. With only four priorities, a
 * bucket array makes dequeue constant-time, and insertion order holds by construction. A heap does
 * not guarantee stable ordering, so FIFO would need a separate rule.
 *
 * The queue holds logical work only: module and export names, wire strings, and execution refs the
 * session issued. Engine handles never enter it. vm/quickjs.ts owns them, and dispose releases them
 * in one pass.
 */

export interface QueuedWork<T> {
	/**
	 * Monotonically increasing within the session. This sequence sets the order among items of the
	 * same priority.
	 */
	readonly sequence: number;
	readonly priority: RuntimeWorkPriority;
	readonly item: T;
}

export class RuntimeWorkQueue<T> {
	private readonly buckets: QueuedWork<T>[][] = RUNTIME_WORK_PRIORITIES.map(
		() => [],
	);
	private nextSequence = 1;
	private count = 0;

	enqueue(item: T, priority: RuntimeWorkPriority): QueuedWork<T> {
		const work: QueuedWork<T> = {
			sequence: this.nextSequence++,
			priority,
			item,
		};
		(this.buckets[PRIORITY_RANK[priority]] as QueuedWork<T>[]).push(work);
		this.count += 1;
		return work;
	}

	dequeue(): QueuedWork<T> | null {
		for (const bucket of this.buckets) {
			const work = bucket.shift();
			if (work !== undefined) {
				this.count -= 1;
				return work;
			}
		}
		return null;
	}

	get size(): number {
		return this.count;
	}

	/** Queue depth per priority. For instrumentation only. */
	depth(): Readonly<Record<RuntimeWorkPriority, number>> {
		const out = {} as Record<RuntimeWorkPriority, number>;
		RUNTIME_WORK_PRIORITIES.forEach((priority, index) => {
			out[priority] = (this.buckets[index] as QueuedWork<T>[]).length;
		});
		return out;
	}

	/**
	 * Removes and returns every item, in execution order. Called when cancellation or a fatal failure
	 * empties the queue.
	 */
	drain(): QueuedWork<T>[] {
		const out: QueuedWork<T>[] = [];
		for (const bucket of this.buckets) out.push(...bucket.splice(0));
		this.count = 0;
		return out;
	}
}
