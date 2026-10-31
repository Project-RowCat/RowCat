import { describe, expect, it } from "vitest";
import { CHILD_LIST_BLOCK, ChildList } from "./child-list.ts";

/**
 * The child list answers the three questions a patch asks of a parent — where is this child, who
 * stands at index i, put this child at index i — and it must answer them exactly as an array would.
 * The order it holds is the order the DOM is built in, so one wrong answer is a wrong screen with no
 * error. The model here is a plain array; every operation is checked against it.
 */

interface Item {
	readonly id: number;
}

/** A deterministic sequence, so a failure reproduces from the same seed. */
const sequence = (seed: number) => {
	let state = seed >>> 0;
	return (bound: number): number => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state % bound;
	};
};

const assertSame = (list: ChildList<Item>, model: Item[]): void => {
	expect(list.length).toBe(model.length);
	expect([...list]).toEqual(model);
	for (let index = 0; index < model.length; index += 1) {
		expect(list.at(index)).toBe(model[index]);
		expect(list.indexOf(model[index] as Item)).toBe(index);
	}
	expect(list.at(model.length)).toBeUndefined();
	expect(list.at(-1)).toBeUndefined();
};

describe("child list keeps array order", () => {
	it("insert, remove and move agree with an array model across block splits", () => {
		const next = sequence(7);
		const list = new ChildList<Item>();
		const model: Item[] = [];
		let id = 0;
		for (let step = 0; step < 4_000; step += 1) {
			const choice = model.length === 0 ? 0 : next(10);
			if (choice < 4) {
				const item = { id: id++ };
				const index = next(model.length + 1);
				list.insert(index, item);
				model.splice(index, 0, item);
			} else if (choice < 6) {
				const item = model[next(model.length)] as Item;
				expect(list.remove(item)).toBe(model.indexOf(item));
				model.splice(model.indexOf(item), 1);
			} else {
				const item = model[next(model.length)] as Item;
				list.remove(item);
				model.splice(model.indexOf(item), 1);
				const index = next(model.length + 1);
				list.insert(index, item);
				model.splice(index, 0, item);
			}
			if (step % 250 === 0) assertSame(list, model);
		}
		assertSame(list, model);
	});

	it("an absent child is -1, like an array", () => {
		const list = new ChildList<Item>();
		const present = { id: 1 };
		list.insert(0, present);
		expect(list.indexOf({ id: 2 })).toBe(-1);
		expect(list.remove({ id: 2 })).toBe(-1);
		expect(list.length).toBe(1);
	});

	it("an index past the end is refused rather than clamped", () => {
		const list = new ChildList<Item>();
		expect(() => list.insert(1, { id: 1 })).toThrow(RangeError);
		expect(() => list.insert(-1, { id: 1 })).toThrow(RangeError);
		expect(list.length).toBe(0);
	});

	it("the same child cannot stand twice", () => {
		const list = new ChildList<Item>();
		const item = { id: 1 };
		list.insert(0, item);
		expect(() => list.insert(1, item)).toThrow(RangeError);
		expect(list.length).toBe(1);
	});

	it("clear empties it for reuse", () => {
		const list = new ChildList<Item>();
		for (let index = 0; index < 300; index += 1)
			list.insert(index, { id: index });
		list.clear();
		assertSame(list, []);
		const item = { id: 9 };
		list.insert(0, item);
		assertSame(list, [item]);
	});
});

/**
 * Why this structure exists: a batch of moves inside one wide parent is creator-shaped input that
 * lands on the player's main thread. With an array, each move is a linear search plus two shifts of
 * the whole parent, so 50,000 moves over 5,000 children (the host's own caps) cost about
 * 50,000 × 5,000 steps. The list keeps each move to a walk over blocks plus one block shift.
 *
 * What makes that true is the shape, so the shape is what is asserted: a lookup walks
 * `blockCount` blocks and shifts at most `longestBlock` children. Wall-clock time is not asserted —
 * at this size an array's memmove is fast enough that a timing ratio flakes under load, while the
 * shape does not.
 */
describe("child list stays shallow", () => {
	const CHILDREN = 4_999;
	const ceiling = Math.ceil(CHILDREN / (CHILD_LIST_BLOCK / 4)) + 1;

	it("moves at the host's caps keep blocks bounded in count and length", () => {
		const items = Array.from({ length: CHILDREN }, (_, id) => ({ id }));
		const list = new ChildList<Item>();
		for (const [index, item] of items.entries()) list.insert(index, item);
		const model = [...items];
		for (let step = 0; step < 50_000; step += 1) {
			const item = items[(step * 7_919) % CHILDREN] as Item;
			list.remove(item);
			model.splice(model.indexOf(item), 1);
			const index = (step * 104_729) % CHILDREN;
			list.insert(index, item);
			model.splice(index, 0, item);
		}
		expect([...list]).toEqual(model);
		expect(list.longestBlock).toBeLessThan(CHILD_LIST_BLOCK * 2);
		expect(list.blockCount).toBeLessThanOrEqual(ceiling);
	});

	it("removals do not leave a trail of near-empty blocks", () => {
		const items = Array.from({ length: CHILDREN }, (_, id) => ({ id }));
		const list = new ChildList<Item>();
		for (const [index, item] of items.entries()) list.insert(index, item);
		/**
		 * Fifteen of every sixteen children leave. Without merging, every block would keep a sliver of
		 * four children and a lookup would still walk all ~80 of them for ~300 children.
		 */
		for (let index = 0; index < CHILDREN; index += 1)
			if (index % 16 !== 0) list.remove(items[index] as Item);
		expect(list.length).toBe(Math.ceil(CHILDREN / 16));
		expect(list.blockCount).toBeLessThanOrEqual(
			Math.ceil(list.length / (CHILD_LIST_BLOCK / 4)) + 1,
		);
		expect(list.longestBlock).toBeLessThan(CHILD_LIST_BLOCK * 2);
	});
});
