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
