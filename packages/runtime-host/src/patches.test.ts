import { describe, expect, it } from "vitest";
import {
	assetPathOf,
	DEFAULT_ROOT_LIMITS,
	handlerIdOf,
	RuntimeHostNodeLedger,
	validatePatchBatch,
} from "./patches.ts";

/**
 * The host does not trust the batch. It checks shape, revision, and limits both before and after
 * parsing.
 */

const batch = (patches: unknown[], revision = 1): string =>
	JSON.stringify({ revision, patches });

describe("shape", () => {
	it("all seven operations pass", () => {
		const result = validatePatchBatch(
			batch([
				{ op: "create", id: 1, kind: "stack" },
				{ op: "create", id: 2, kind: "#text" },
				{ op: "set-prop", id: 1, name: "gap", value: 12 },
				{ op: "set-prop", id: 1, name: "onPress", value: { $handler: 3 } },
				{ op: "set-text", id: 2, value: "hi" },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 0, child: 1, index: 0 },
				{ op: "move", parent: 1, child: 2, index: 0 },
				{ op: "remove-prop", id: 1, name: "gap" },
				{ op: "remove", id: 2 },
			]),
			DEFAULT_ROOT_LIMITS,
		);
		expect(result.ok).toBe(true);
	});

	it.each([
		["not JSON", "{", "malformed"],
		["not an object", "[]", "not an object"],
		["no revision", JSON.stringify({ patches: [] }), "revision"],
		[
			"patches is not an array",
			JSON.stringify({ revision: 1, patches: {} }),
			"not an array",
		],
		["unknown operation", batch([{ op: "teleport", id: 1 }]), "unknown op"],
		[
			"unknown kind",
			batch([{ op: "create", id: 1, kind: "div" }]),
			"unknown kind",
		],
		[
			"creates the root",
			batch([{ op: "create", id: 0, kind: "view" }]),
			"reserved",
		],
		["removes the root", batch([{ op: "remove", id: 0 }]), "invalid id"],
		[
			"negative id",
			batch([{ op: "create", id: -1, kind: "view" }]),
			"invalid id",
		],
		[
			"children prop",
			batch([{ op: "set-prop", id: 1, name: "children", value: 1 }]),
			"structural",
		],
		[
			"a function rode along",
			batch([{ op: "set-prop", id: 1, name: "x", value: { a: undefined } }]),
			"ok",
		],
		[
			"set-text on a non-text node",
			batch([{ op: "set-text", id: 1, value: 3 }]),
			"not a string",
		],
		[
			"negative insert index",
			batch([{ op: "insert", parent: 0, child: 1, index: -1 }]),
			"invalid index",
		],
	])("%s → refused", (_label, json, reason) => {
		const result = validatePatchBatch(json, DEFAULT_ROOT_LIMITS);
		if (reason === "ok") {
			/**
			 * `undefined` does not exist in JSON. It is dropped during serialization, so the value becomes a
			 * plain object.
			 */
			expect(result.ok).toBe(true);
			return;
		}
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain(reason);
			expect(result.limit).toBe(false);
		}
	});

	it("prop values are the JSON vocabulary plus two markers: no class instances or deep nesting", () => {
		let deep: unknown = 1;
		for (let i = 0; i < 12; i += 1) deep = [deep];
		const result = validatePatchBatch(
			batch([{ op: "set-prop", id: 1, name: "x", value: deep }]),
			DEFAULT_ROOT_LIMITS,
		);
		expect(result.ok).toBe(false);
		expect(handlerIdOf({ $handler: 4 })).toBe(4);
		expect(handlerIdOf({ $asset: "a/b" })).toBeNull();
		expect(assetPathOf({ $asset: "a/b" })).toBe("a/b");
		expect(assetPathOf(4)).toBeNull();
	});
});

describe("revisions", () => {
	it("refuses an unexpected revision, whether skipped or going back", () => {
		expect(
			validatePatchBatch(batch([], 3), DEFAULT_ROOT_LIMITS, {
				expectedRevision: 2,
			}).ok,
		).toBe(false);
		expect(
			validatePatchBatch(batch([], 1), DEFAULT_ROOT_LIMITS, {
				expectedRevision: 2,
			}).ok,
		).toBe(false);
		expect(
			validatePatchBatch(batch([], 2), DEFAULT_ROOT_LIMITS, {
				expectedRevision: 2,
			}).ok,
		).toBe(true);
	});
});

describe("limits", () => {
	it("the byte limit stands before parsing", () => {
		const json = batch([{ op: "set-text", id: 1, value: "x".repeat(1000) }]);
		const result = validatePatchBatch(json, {
			...DEFAULT_ROOT_LIMITS,
			maxCommitBytes: 100,
		});
		expect(result).toEqual({
			ok: false,
			reason: expect.stringContaining("bytes"),
			limit: true,
		});
	});

	it("patch count limit", () => {
		const json = batch(
			Array.from({ length: 6 }, (_, i) => ({ op: "remove", id: i + 1 })),
		);
		const result = validatePatchBatch(json, {
			...DEFAULT_ROOT_LIMITS,
			maxPatchesPerCommit: 5,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.limit).toBe(true);
	});

	it("the node count limit counts this bundle's creates and removes on top of the ledger", () => {
		const creates = (n: number, from = 1) =>
			batch(
				Array.from({ length: n }, (_, i) => ({
					op: "create",
					id: from + i,
					kind: "view",
				})),
			);
		const limits = { ...DEFAULT_ROOT_LIMITS, maxHostNodes: 3 };
		expect(validatePatchBatch(creates(3), limits).ok).toBe(true);
		expect(validatePatchBatch(creates(4), limits).ok).toBe(false);

		const tree = new RuntimeHostNodeLedger();
		const three = validatePatchBatch(creates(3), limits, { tree });
		if (!three.ok) throw new Error("three creates should pass");
		three.commit();
		expect(tree.size).toBe(3);
		expect(validatePatchBatch(creates(1, 5), limits, { tree }).ok).toBe(false);
		expect(
			validatePatchBatch(
				batch([
					{ op: "remove", id: 1 },
					{ op: "create", id: 5, kind: "view" },
				]),
				limits,
				{ tree },
			).ok,
		).toBe(true);
	});

	/**
	 * A `remove` takes out one subtree.
	 *
	 * Before this check existed, the live count only ever grew whenever a screen was swapped. After
	 * about 23 swaps, the tree held roughly 100 real nodes but the count exceeded the 5,000 limit, so
	 * every commit was rejected. The count had no way back down, so the work froze permanently.
	 */
	it("detaching a subtree removes every node in it", () => {
		const tree = new RuntimeHostNodeLedger();
		const limits = { ...DEFAULT_ROOT_LIMITS, maxHostNodes: 10 };
		const built = validatePatchBatch(
			batch([
				{ op: "create", id: 1, kind: "view" },
				{ op: "create", id: 2, kind: "view" },
				{ op: "create", id: 3, kind: "#text" },
				{ op: "insert", parent: 2, child: 3, index: 0 },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			]),
			limits,
			{ tree },
		);
		if (!built.ok) throw new Error("build should pass");
		built.commit();
		expect(tree.size).toBe(3);

		const torn = validatePatchBatch(
			batch([{ op: "remove", id: 1 }], 2),
			limits,
			{ tree },
		);
		if (!torn.ok) throw new Error("teardown should pass");
		torn.commit();
		expect(tree.size).toBe(0);
	});

	/**
	 * A rejected batch must leave the ledger unchanged, so the next calculation does not build on
	 * wrong values.
	 */
	it("the ledger does not move before acceptance", () => {
		const tree = new RuntimeHostNodeLedger();
		const limits = { ...DEFAULT_ROOT_LIMITS, maxHostNodes: 10 };
		const ok = validatePatchBatch(
			batch([{ op: "create", id: 1, kind: "view" }]),
			limits,
			{ tree },
		);
		expect(tree.size).toBe(0);
		if (!ok.ok) throw new Error("should pass");
		ok.commit();
		expect(tree.size).toBe(1);
	});
});

/**
 * A batch is a string creator code can shape, so depth is counted on the host too, not only by the
 * reconciler. A chain directly under the root at exactly the limit passes; one more level does not,
 * whether it arrives in one batch or by attaching a deep subtree under an existing deep node.
 */
describe("depth", () => {
	const chain = (from: number, length: number, under: number): unknown[] => {
		const patches: unknown[] = [];
		let parent = under;
		for (let id = from; id < from + length; id += 1) {
			patches.push({ op: "create", id, kind: "stack" });
			patches.push({ op: "insert", parent, child: id, index: 0 });
			parent = id;
		}
		return patches;
	};
	const limits = { ...DEFAULT_ROOT_LIMITS, maxTreeDepth: 8 };

	it("a chain at the limit passes and one level more is refused", () => {
		expect(validatePatchBatch(batch(chain(1, 9, 0)), limits).ok).toBe(true);
		const over = validatePatchBatch(batch(chain(1, 10, 0)), limits);
		expect(over.ok).toBe(false);
		if (over.ok) return;
		expect(over.limit).toBe(true);
	});

	it("attaching a subtree is measured against where it lands", () => {
		const tree = new RuntimeHostNodeLedger();
		const first = validatePatchBatch(batch(chain(1, 5, 0)), limits, { tree });
		if (!first.ok) throw new Error(first.reason);
		first.commit();
		/** A detached five-node chain, then attached under node 5 (four ancestors deep): 4 + 5 > 8. */
		const detached = chain(100, 5, 0).filter(
			(_, index) => index !== 1,
		) as unknown[];
		const second = validatePatchBatch(
			batch(
				[...detached, { op: "insert", parent: 5, child: 100, index: 0 }],
				2,
			),
			limits,
			{ tree, expectedRevision: 2 },
		);
		expect(second.ok).toBe(false);
	});
});

/**
 * The ledger runs synchronously inside the VM turn, where no interrupt can cut it, and its time is
 * charged to the creator's budget. It used to find a node's parent by scanning every parent the batch
 * had attached: 3,000 ordinary nodes cost 240 ms of a 250 ms session window, and a forged batch held
 * the thread for many seconds. A forged batch of remove/create pairs on one id did the same through
 * the remove walk.
 *
 * The cost is counted, not timed. A wall-clock bound measures the machine as much as the walk (CI's
 * oversubscribed runner is several times slower than a desktop), while these two numbers are the same
 * on every machine:
 * - steps: every value a Set, Map or array iterator hands out. The ledger's walks are for-of loops, so
 *   a walk repeated per patch makes the count grow with the square of the batch. Each case runs at n
 *   and at 4n: a linear ledger takes about 4 times the steps, a quadratic one about 16.
 * - churn: the most times one key was deleted from one Set or Map. V8 keeps a deleted key in its hash
 *   chain until the table is rebuilt, so deleting and re-adding the same key thousands of times makes
 *   each lookup of it walk that chain: quadratic time that no iteration count shows.
 */
describe("ledger cost", () => {
	type Next = (this: unknown, ...args: unknown[]) => unknown;
	type Delete = (this: object, key: unknown) => boolean;

	const workOf = (run: () => void): { steps: number; churn: number } => {
		const iterators = [
			new Set<number>().values(),
			new Map<number, number>().entries(),
			[].values(),
		].map((iterator) => Object.getPrototypeOf(iterator) as { next: Next });
		const nexts = iterators.map((prototype) => prototype.next);
		const collections = [Set.prototype, Map.prototype] as unknown as {
			delete: Delete;
		}[];
		const deletes = collections.map((prototype) => prototype.delete);
		const deleted = new WeakMap<object, Map<unknown, number>>();
		let steps = 0;
		let churn = 0;
		iterators.forEach((prototype, index) => {
			const next = nexts[index] as Next;
			prototype.next = function (this: unknown, ...args: unknown[]) {
				steps += 1;
				return next.apply(this, args);
			};
		});
		collections.forEach((prototype, index) => {
			const remove = deletes[index] as Delete;
			prototype.delete = function (this: object, key: unknown) {
				let counts = deleted.get(this);
				if (counts === undefined) {
					counts = new Map();
					deleted.set(this, counts);
				}
				const times = (counts.get(key) ?? 0) + 1;
				counts.set(key, times);
				churn = Math.max(churn, times);
				return remove.call(this, key);
			};
		});
		try {
			run();
		} finally {
			iterators.forEach((prototype, index) => {
				prototype.next = nexts[index] as Next;
			});
			collections.forEach((prototype, index) => {
				prototype.delete = deletes[index] as Delete;
			});
		}
		return { steps, churn };
	};

	/**
	 * Validates `committed` (if any) into a fresh ledger, then counts the work of validating `json`
	 * against it. Only the second batch is counted.
	 */
	const costOf = (
		json: string,
		committed?: string,
	): { ok: boolean; steps: number; churn: number } => {
		const tree = new RuntimeHostNodeLedger();
		if (committed !== undefined) {
			const first = validatePatchBatch(committed, DEFAULT_ROOT_LIMITS, {
				tree,
			});
			if (!first.ok)
				throw new Error(`committed batch refused: ${first.reason}`);
			first.commit();
		}
		let ok = false;
		const work = workOf(() => {
			ok = validatePatchBatch(json, DEFAULT_ROOT_LIMITS, { tree }).ok;
		});
		return { ok, ...work };
	};

	/** The same case at n and at 4n: how much more work, and whether each was accepted. */
	const growth = (
		n: number,
		build: (size: number) => { json: string; committed?: string },
	) => {
		const small = build(n);
		const large = build(4 * n);
		const a = costOf(small.json, small.committed);
		const b = costOf(large.json, large.committed);
		return {
			ok: [a.ok, b.ok],
			ratio: b.steps / a.steps,
			churn: Math.max(a.churn, b.churn),
		};
	};

	/** Linear is about 4 and quadratic about 16; the bound sits well clear of both. */
	const LINEAR = 7;

	/** What the reconciler sends for a scroll of rows, each a row with a label and a button. */
	const listMount = (rows: number): unknown[] => {
		const patches: unknown[] = [{ op: "create", id: 1, kind: "scroll" }];
		let id = 2;
		for (let row = 0; row < rows; row += 1) {
			const [box, label, labelText, button, buttonText] = [
				id,
				id + 1,
				id + 2,
				id + 3,
				id + 4,
			];
			id += 5;
			patches.push(
				{ op: "create", id: box, kind: "row" },
				{ op: "create", id: label, kind: "text" },
				{ op: "create", id: labelText, kind: "#text" },
				{ op: "set-text", id: labelText, value: `row ${row}` },
				{ op: "insert", parent: label, child: labelText, index: 0 },
				{ op: "create", id: button, kind: "button" },
				{
					op: "set-prop",
					id: button,
					name: "onPress",
					value: { $handler: id },
				},
				{ op: "create", id: buttonText, kind: "#text" },
				{ op: "set-text", id: buttonText, value: "go" },
				{ op: "insert", parent: button, child: buttonText, index: 0 },
				{ op: "insert", parent: box, child: label, index: 0 },
				{ op: "insert", parent: box, child: button, index: 1 },
				{ op: "insert", parent: 1, child: box, index: row },
			);
		}
		patches.push({ op: "insert", parent: 0, child: 1, index: 0 });
		return patches;
	};

	/** One parent at the root with `children` children under it. */
	const wideParent = (children: number): string => {
		const patches: unknown[] = [
			{ op: "create", id: 1, kind: "view" },
			{ op: "insert", parent: 0, child: 1, index: 0 },
		];
		for (let id = 2; id < children + 2; id += 1)
			patches.push(
				{ op: "create", id, kind: "view" },
				{ op: "insert", parent: 1, child: id, index: id - 2 },
			);
		return batch(patches);
	};

	it("a mount grows linearly, up to 5,000 nodes", () => {
		const { ok, ratio, churn } = growth(240, (rows) => ({
			json: batch(listMount(rows)),
		}));
		expect(ok).toEqual([true, true]);
		expect(ratio).toBeLessThan(LINEAR);
		expect(churn).toBeLessThanOrEqual(2);
	});

	it("deep chains under the depth limit grow linearly", () => {
		const { ok, ratio, churn } = growth(16, (chains) => {
			const patches: unknown[] = [];
			let id = 1;
			for (let chain = 0; chain < chains; chain += 1) {
				let parent = 0;
				for (let level = 0; level < 60; level += 1) {
					patches.push({ op: "create", id, kind: "view" });
					patches.push({ op: "insert", parent, child: id, index: 0 });
					parent = id;
					id += 1;
				}
			}
			return { json: batch(patches) };
		});
		expect(ok).toEqual([true, true]);
		expect(ratio).toBeLessThan(LINEAR);
		expect(churn).toBeLessThanOrEqual(2);
	});

	it("a forged batch of inserts under distinct parents grows linearly", () => {
		const { ok, ratio, churn } = growth(6_000, (count) => {
			const patches: unknown[] = [];
			for (let id = 1; id <= count; id += 1) {
				patches.push({ op: "create", id, kind: "view" });
				patches.push({ op: "insert", parent: id + count, child: id, index: 0 });
			}
			return { json: batch(patches) };
		});
		expect(ok).toEqual([false, false]);
		expect(ratio).toBeLessThan(LINEAR);
		expect(churn).toBeLessThanOrEqual(2);
	});

	/**
	 * A re-created id is a new node. Each remove of it used to walk the committed children the first
	 * remove had already killed: pairs times children. Both grow here, so that product is quadratic.
	 */
	it("a forged batch removing and re-creating one parent grows linearly", () => {
		const { ok, ratio, churn } = growth(1_200, (size) => {
			const patches: unknown[] = [];
			for (let pair = 0; pair < size; pair += 1)
				patches.push(
					{ op: "remove", id: 1 },
					{ op: "create", id: 1, kind: "view" },
				);
			return { committed: wideParent(size), json: batch(patches, 2) };
		});
		expect(ok).toEqual([true, true]);
		expect(ratio).toBeLessThan(LINEAR);
		expect(churn).toBeLessThanOrEqual(2);
	});

	/**
	 * One child moved between two wide parents and back, over and over: a committed parent and one
	 * this batch filled. Taking the child out of the second parent's set and putting it back is the
	 * churn the header describes.
	 */
	it("a forged batch moving one child back and forth grows linearly", () => {
		const other = 100_000;
		const moved = 200_000;
		const { ok, ratio, churn } = growth(1_200, (size) => {
			const patches: unknown[] = [
				{ op: "create", id: other, kind: "view" },
				{ op: "insert", parent: 0, child: other, index: 1 },
				{ op: "create", id: moved, kind: "view" },
			];
			for (let id = other + 1; id <= other + size / 2; id += 1)
				patches.push(
					{ op: "create", id, kind: "view" },
					{ op: "insert", parent: other, child: id, index: 0 },
				);
			for (let move = 0; move < size; move += 1)
				patches.push(
					{ op: "insert", parent: other, child: moved, index: 0 },
					{ op: "insert", parent: 1, child: moved, index: 0 },
				);
			return { committed: wideParent(size / 2), json: batch(patches, 2) };
		});
		expect(ok).toEqual([true, true]);
		expect(ratio).toBeLessThan(LINEAR);
		expect(churn).toBeLessThanOrEqual(2);
	});

	it("a cycle the batch draws is too deep, not endless", () => {
		const result = validatePatchBatch(
			batch([
				{ op: "create", id: 1, kind: "view" },
				{ op: "create", id: 2, kind: "view" },
				{ op: "insert", parent: 0, child: 1, index: 0 },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 2, child: 1, index: 0 },
			]),
			DEFAULT_ROOT_LIMITS,
		);
		expect(result.ok).toBe(false);
	});
});
