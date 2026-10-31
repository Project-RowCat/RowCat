import {
	ROOT_HOST_NODE_ID,
	type RuntimePatch,
} from "@rowcat/runtime-host/patches";
import { describe, expect, it } from "vitest";
import { createNativeRuntimeTreeStore } from "./tree-store.ts";

/**
 * **What one batch costs Hermes is bounded by the tree, not by patches × children.**
 *
 * The host caps a batch at 50,000 patches and 5,000 nodes, and the VM budget never sees what
 * applying it costs on this side. Each `move` used to copy its parent's whole child list twice and
 * keep the old copy in the undo journal, so one batch of moves inside a wide parent held patches ×
 * children numbers alive until the commit point: 2.4 GB in Node for 50,000 moves over 5,000
 * children — on a phone, the app is killed. A parent's list is now copied once per batch (the undo
 * target) and edited in place after that.
 */

const WIDTH = 5_000;
const MOVES = 50_000;

function wideParent() {
	const store = createNativeRuntimeTreeStore();
	const patches: RuntimePatch[] = [
		{ op: "create", id: 1, kind: "stack" },
		{ op: "insert", parent: ROOT_HOST_NODE_ID, child: 1, index: 0 },
	];
	for (let i = 0; i < WIDTH; i++)
		patches.push(
			{ op: "create", id: 10 + i, kind: "view" },
			{ op: "insert", parent: 1, child: 10 + i, index: i },
		);
	store.apply({ revision: 1, patches });
	return store;
}

const moves = (): RuntimePatch[] =>
	Array.from({ length: MOVES }, (_, i) => ({
		op: "move" as const,
		parent: 1,
		child: 10 + (i % WIDTH),
		index: (i * 7) % WIDTH,
	}));

describe("move cost", () => {
	it("a batch of the largest size the host admits keeps memory bounded", () => {
		const store = wideParent();
		const patches = moves();
		const before = process.memoryUsage().heapUsed;
		store.apply({ revision: 2, patches });
		const grown = process.memoryUsage().heapUsed - before;
		/** Generous on purpose: the old shape grew by gigabytes, the new one by one list. */
		expect(grown).toBeLessThan(256 * 1024 * 1024);
		expect(store.revision).toBe(2);
		expect(store.children(1)).toHaveLength(WIDTH);
	}, 60_000);

	it("the result equals moving one by one on a plain array", () => {
		const store = wideParent();
		const patches = moves().slice(0, 2_000);
		const expected = Array.from({ length: WIDTH }, (_, i) => 10 + i);
		for (const patch of patches) {
			if (patch.op !== "move") continue;
			expected.splice(expected.indexOf(patch.child), 1);
			expected.splice(patch.index, 0, patch.child);
		}
		store.apply({ revision: 2, patches });
		expect([...store.children(1)]).toEqual(expected);
	});

	it("a failing batch restores the list it started from", () => {
		const store = wideParent();
		const original = store.children(1);
		const snapshot = [...original];
		expect(() =>
			store.apply({
				revision: 2,
				patches: [
					...moves().slice(0, 100),
					{ op: "remove", id: 10 },
					{ op: "insert", parent: 1, child: 11, index: 0 },
				],
			}),
		).toThrow();
		/** The same array object as before the batch, with the same contents. */
		expect(store.children(1)).toBe(original);
		expect([...store.children(1)]).toEqual(snapshot);
		expect(store.node(10)).not.toBeNull();
	});

	it("a successful batch hands subscribers a new list object", () => {
		const store = wideParent();
		const before = store.children(1);
		store.apply({
			revision: 2,
			patches: [{ op: "move", parent: 1, child: 10, index: 3 }],
		});
		expect(store.children(1)).not.toBe(before);
		expect(before[0]).toBe(10);
	});
});
