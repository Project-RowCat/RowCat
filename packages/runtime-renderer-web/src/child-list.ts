/**
 * The ordered children of one parent, in the order the DOM holds them.
 *
 * - Why not an array: every `move` and `remove` patch asks "where is this child" and every
 *   `insert`/`move` asks "who stands at index i", then shifts the parent. With an array that is a
 *   linear search plus two shifts of the whole parent per patch. The batch is creator-shaped input
 *   that the player's main thread applies, so 50,000 moves inside a parent of 5,000 children (both
 *   within the host's caps) became about 250 million steps on the thread that also runs the trusted
 *   shell. The VM budget never sees that cost: it is spent after the batch left the worker.
 * - What it is instead: the children split into blocks of bounded length, plus a map from child to
 *   its block. A lookup walks block lengths, not children, and a shift moves one block. At the
 *   host's node cap that is on the order of a hundred steps per patch instead of thousands, so a
 *   batch's cost follows its patch count rather than patch count times parent width.
 * - What it is not: a general collection. It holds each child once (inserting one already present
 *   throws), refuses indexes past the end instead of clamping, and answers -1 for an absent child,
 *   because the renderer's strictness rests on those answers. Order is the only thing it keeps.
 */

/**
 * Target block length. A block splits when it reaches twice this and merges into a neighbour when
 * it falls below a quarter, so every block but a lone one holds BLOCK / 4 to 2 × BLOCK children.
 * Smaller blocks make the walk over blocks longer; larger ones make each shift longer. Measured at
 * the host's cap (5,000 children, 50,000 moves), 64 was the fastest of 16–128.
 */
export const CHILD_LIST_BLOCK = 64;
const BLOCK = CHILD_LIST_BLOCK;

export class ChildList<T extends object> implements Iterable<T> {
	private blocks: T[][] = [];
	private readonly blockOf = new Map<T, T[]>();
	private count = 0;

	get length(): number {
		return this.count;
	}

	/**
	 * How many blocks a lookup walks. For tests and diagnostics: the cost bound above rests on this
	 * staying near length / BLOCK, and nothing else shows it.
	 */
	get blockCount(): number {
		return this.blocks.length;
	}

	/** The longest block, for the same reason as blockCount. */
	get longestBlock(): number {
		let longest = 0;
		for (const block of this.blocks) longest = Math.max(longest, block.length);
		return longest;
	}

	/** The child at `index`, or undefined outside the list, as an array would answer. */
	at(index: number): T | undefined {
		if (!Number.isInteger(index) || index < 0 || index >= this.count)
			return undefined;
		let rest = index;
		for (const block of this.blocks) {
			if (rest < block.length) return block[rest];
			rest -= block.length;
		}
		return undefined;
	}

	/** Position of `child`, or -1 when it is not in this list. */
	indexOf(child: T): number {
		const home = this.blockOf.get(child);
		if (home === undefined) return -1;
		let offset = 0;
		for (const block of this.blocks) {
			if (block === home) return offset + block.indexOf(child);
			offset += block.length;
		}
		return -1;
	}

	/** Puts `child` at `index`; children from `index` on move one place later. */
	insert(index: number, child: T): void {
		if (!Number.isInteger(index) || index < 0 || index > this.count)
			throw new RangeError(
				`index ${index} is outside a list of ${this.count} children`,
			);
		if (this.blockOf.has(child))
			throw new RangeError("child is already in this list");
		if (this.blocks.length === 0) {
			const block = [child];
			this.blocks.push(block);
			this.blockOf.set(child, block);
			this.count = 1;
			return;
		}
		let rest = index;
		let at = 0;
		/** An index equal to a block's length appends to that block only if it is the last one. */
		while (at < this.blocks.length - 1) {
			const length = (this.blocks[at] as T[]).length;
			if (rest < length) break;
			rest -= length;
			at += 1;
		}
		const block = this.blocks[at] as T[];
		block.splice(rest, 0, child);
		this.blockOf.set(child, block);
		this.count += 1;
		this.split(at);
	}

	/** Takes `child` out and returns where it stood, or -1 when it was not here. */
	remove(child: T): number {
		const home = this.blockOf.get(child);
		if (home === undefined) return -1;
		let offset = 0;
		for (let at = 0; at < this.blocks.length; at += 1) {
			const block = this.blocks[at] as T[];
			if (block !== home) {
				offset += block.length;
				continue;
			}
			const within = block.indexOf(child);
			block.splice(within, 1);
			this.blockOf.delete(child);
			this.count -= 1;
			this.merge(at);
			return offset + within;
		}
		return -1;
	}

	/** Splits block `at` in two once it reaches twice the target length. */
	private split(at: number): void {
		const block = this.blocks[at] as T[];
		if (block.length < BLOCK * 2) return;
		const tail = block.splice(BLOCK);
		this.blocks.splice(at + 1, 0, tail);
		for (const moved of tail) this.blockOf.set(moved, tail);
	}

	/**
	 * Folds a block that shrank below a quarter into its neighbour. Without it, removals leave a trail
	 * of near-empty blocks that every later walk passes over, and the bound above drifts back toward
	 * one step per child. An empty block is dropped outright.
	 */
	private merge(at: number): void {
		const block = this.blocks[at] as T[];
		if (block.length === 0) {
			this.blocks.splice(at, 1);
			return;
		}
		if (block.length >= BLOCK / 4 || this.blocks.length === 1) return;
		const into = at > 0 ? at - 1 : at + 1;
		const target = this.blocks[into] as T[];
		if (into < at) target.push(...block);
		else target.unshift(...block);
		for (const moved of block) this.blockOf.set(moved, target);
		this.blocks.splice(at, 1);
		this.split(into < at ? into : at);
	}

	clear(): void {
		this.blocks = [];
		this.blockOf.clear();
		this.count = 0;
	}

	*[Symbol.iterator](): Iterator<T> {
		for (const block of this.blocks) yield* block;
	}
}
