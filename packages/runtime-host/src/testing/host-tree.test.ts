import { describe, expect, it } from "vitest";
import { TestHostTree } from "./host-tree.ts";

/**
 * Whether the test tree strictly enforces the protocol invariants. If this net is loose, reconciler
 * tests report false greens.
 */
describe("TestHostTree", () => {
	it("applies bundles in order and builds a semantic snapshot", () => {
		const tree = new TestHostTree();
		tree.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "stack" },
				{ op: "set-prop", id: 1, name: "gap", value: 12 },
				{ op: "create", id: 2, kind: "text" },
				{ op: "create", id: 3, kind: "#text" },
				{ op: "set-text", id: 3, value: "Count: 0" },
				{ op: "insert", parent: 2, child: 3, index: 0 },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		expect(tree.children()).toEqual([
			{
				type: "stack",
				props: { gap: 12 },
				children: [{ type: "text", children: ["Count: 0"] }],
			},
		]);
		expect(tree.ids()).toEqual([1, 2, 3]);
		expect(tree.findByText("Count: 0")?.id).toBe(2);
		tree.apply({
			revision: 2,
			patches: [{ op: "set-text", id: 3, value: "Count: 1" }],
		});
		expect(tree.findByText("Count: 1")?.id).toBe(2);
		expect(tree.size).toBe(3);
	});

	it("throws when a revision is skipped", () => {
		const tree = new TestHostTree();
		expect(() => tree.apply({ revision: 2, patches: [] })).toThrow(/revision/);
	});

	it("missing nodes, duplicate ids, reused ids and moves to a parent that lacks it all throw", () => {
		const tree = new TestHostTree();
		tree.apply({
			revision: 1,
			patches: [{ op: "create", id: 1, kind: "view" }],
		});
		expect(() =>
			tree.apply({
				revision: 2,
				patches: [{ op: "create", id: 1, kind: "view" }],
			}),
		).toThrow(/exists/);
		expect(() =>
			tree.apply({
				revision: 2,
				patches: [{ op: "set-prop", id: 9, name: "x", value: 1 }],
			}),
		).toThrow(/unknown/);
		expect(() =>
			tree.apply({
				revision: 2,
				patches: [{ op: "move", parent: 0, child: 1, index: 0 }],
			}),
		).toThrow(/not a child/);
		tree.apply({ revision: 2, patches: [{ op: "remove", id: 1 }] });
		expect(() =>
			tree.apply({
				revision: 3,
				patches: [{ op: "create", id: 1, kind: "view" }],
			}),
		).toThrow(/reused/);
	});

	it("removal detaches the whole subtree", () => {
		const tree = new TestHostTree();
		tree.apply({
			revision: 1,
			patches: [
				{ op: "create", id: 1, kind: "view" },
				{ op: "create", id: 2, kind: "view" },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 0, child: 1, index: 0 },
			],
		});
		tree.apply({ revision: 2, patches: [{ op: "remove", id: 1 }] });
		expect(tree.has(2)).toBe(false);
		expect(tree.children()).toEqual([]);
	});
});
