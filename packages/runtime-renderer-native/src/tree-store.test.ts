import {
	ROOT_HOST_NODE_ID,
	type RuntimePatch,
	type RuntimePatchBatch,
} from "@rowcat/runtime-host/patches";
import { describe, expect, it, vi } from "vitest";
import { NATIVE_RENDERER_ERROR_CODE } from "./errors.ts";
import { createNativeRuntimeTreeStore } from "./tree-store.ts";

const batch = (
	revision: number,
	patches: RuntimePatch[],
): RuntimePatchBatch => ({
	revision,
	patches,
});

const seed = (): RuntimePatch[] => [
	{ op: "create", id: 1, kind: "screen" },
	{ op: "create", id: 2, kind: "stack" },
	{ op: "create", id: 3, kind: "text" },
	{ op: "create", id: 4, kind: "#text" },
	{ op: "set-text", id: 4, value: "hi" },
	{ op: "insert", parent: 3, child: 4, index: 0 },
	{ op: "insert", parent: 2, child: 3, index: 0 },
	{ op: "insert", parent: 1, child: 2, index: 0 },
	{ op: "insert", parent: ROOT_HOST_NODE_ID, child: 1, index: 0 },
];

describe("operations", () => {
	it("builds the tree and keeps the topology as is", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		expect(store.revision).toBe(1);
		expect(store.size).toBe(4);
		expect(store.ids()).toEqual([1, 2, 3, 4]);
		expect(store.children(ROOT_HOST_NODE_ID)).toEqual([1]);
		expect(store.node(4)?.text).toBe("hi");
		expect(store.node(4)?.parent).toBe(3);
	});

	it("set-prop makes a render-ready value", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(
			batch(1, [
				{ op: "create", id: 1, kind: "stack" },
				{ op: "set-prop", id: 1, name: "gap", value: 12 },
				{
					op: "set-prop",
					id: 1,
					name: "style",
					value: { padding: 8, gap: 4, justify: "center" },
				},
			]),
		);
		/** An explicit gap prop beats style.gap, the same rule as the web renderer. */
		expect(store.node(1)?.props.boxStyle).toEqual({
			padding: 8,
			gap: 12,
			justifyContent: "center",
		});
	});

	it("remove-prop clears only that axis", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(
			batch(1, [
				{ op: "create", id: 1, kind: "stack" },
				{ op: "set-prop", id: 1, name: "gap", value: 12 },
				{ op: "set-prop", id: 1, name: "style", value: { gap: 4 } },
			]),
		);
		store.apply(batch(2, [{ op: "remove-prop", id: 1, name: "gap" }]));
		expect(store.node(1)?.props.boxStyle).toEqual({ gap: 4 });
	});

	it("remove takes the whole subtree along", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		store.apply(batch(2, [{ op: "remove", id: 2 }]));
		expect(store.ids()).toEqual([1]);
		expect(store.node(3)).toBeNull();
		expect(store.node(4)).toBeNull();
		expect(store.children(1)).toEqual([]);
	});

	it("move changes only sibling order", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(
			batch(1, [
				{ op: "create", id: 1, kind: "stack" },
				{ op: "create", id: 2, kind: "text" },
				{ op: "create", id: 3, kind: "text" },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 1, child: 3, index: 1 },
				{ op: "insert", parent: ROOT_HOST_NODE_ID, child: 1, index: 0 },
			]),
		);
		store.apply(batch(2, [{ op: "move", parent: 1, child: 3, index: 0 }]));
		expect(store.children(1)).toEqual([3, 2]);
	});
});

describe("strictness", () => {
	const failing = (patches: RuntimePatch[], revision = 1) => {
		const store = createNativeRuntimeTreeStore();
		if (revision > 1) store.apply(batch(1, seed()));
		let code: string | null = null;
		try {
			store.apply(batch(revision, patches));
		} catch (error) {
			code = (error as { code?: string }).code ?? null;
		}
		return { store, code };
	};

	it("fails when a revision is skipped", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		expect(() => store.apply(batch(3, []))).toThrow(/does not follow/);
		expect(store.failed).toBe(true);
	});

	it("does not take the same revision twice", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		expect(() => store.apply(batch(1, []))).toThrow();
		expect(store.failure?.code).toBe(
			NATIVE_RENDERER_ERROR_CODE.revisionMismatch,
		);
	});

	it("takes no bundle after failing", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		expect(() => store.apply(batch(9, []))).toThrow();
		let code: string | null = null;
		try {
			store.apply(batch(2, []));
		} catch (error) {
			code = (error as { code?: string }).code ?? null;
		}
		expect(code).toBe(NATIVE_RENDERER_ERROR_CODE.failed);
	});

	it("refuses missing nodes, duplicate ids and reused ids", () => {
		expect(failing([{ op: "set-text", id: 7, value: "x" }]).code).toBe(
			NATIVE_RENDERER_ERROR_CODE.unknownNode,
		);
		expect(
			failing([
				{ op: "create", id: 1, kind: "view" },
				{ op: "create", id: 1, kind: "view" },
			]).code,
		).toBe(NATIVE_RENDERER_ERROR_CODE.nodeReused);
		expect(failing([{ op: "create", id: 3, kind: "view" }], 2).code).toBe(
			NATIVE_RENDERER_ERROR_CODE.nodeReused,
		);
	});

	it("refuses operations with mismatched topology", () => {
		expect(
			failing([{ op: "insert", parent: 1, child: 2, index: 9 }], 2).code,
		).toBe(NATIVE_RENDERER_ERROR_CODE.topology);
		expect(
			failing([{ op: "insert", parent: 1, child: 3, index: 0 }], 2).code,
		).toBe(NATIVE_RENDERER_ERROR_CODE.topology);
		expect(
			failing([{ op: "move", parent: 1, child: 4, index: 0 }], 2).code,
		).toBe(NATIVE_RENDERER_ERROR_CODE.topology);
		expect(failing([{ op: "set-text", id: 2, value: "x" }], 2).code).toBe(
			NATIVE_RENDERER_ERROR_CODE.topology,
		);
	});

	it("refuses props off contract", () => {
		expect(
			failing([{ op: "set-prop", id: 2, name: "onPress", value: 1 }], 2).code,
		).toBe(NATIVE_RENDERER_ERROR_CODE.contract);
		expect(
			failing(
				[{ op: "set-prop", id: 2, name: "style", value: { zIndex: 1 } }],
				2,
			).code,
		).toBe(NATIVE_RENDERER_ERROR_CODE.contract);
	});
});

describe("atomicity", () => {
	it("a failed bundle changes the tree by not one cell", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		const before = {
			ids: store.ids(),
			children: [...store.children(1)],
			text: store.node(4)?.text,
			version: store.nodeVersion(4),
			revision: store.revision,
		};
		expect(() =>
			store.apply(
				batch(2, [
					{ op: "set-text", id: 4, value: "bye" },
					{ op: "create", id: 5, kind: "view" },
					{ op: "insert", parent: 2, child: 5, index: 0 },
					{ op: "set-text", id: 99, value: "x" },
				]),
			),
		).toThrow();
		expect(store.ids()).toEqual(before.ids);
		expect(store.children(1)).toEqual(before.children);
		expect(store.node(4)?.text).toBe(before.text);
		expect(store.nodeVersion(4)).toBe(before.version);
		expect(store.revision).toBe(before.revision);
		/**
		 * A failed batch does not consume the ids of its creates, so the same id can be created again.
		 */
		expect(store.node(5)).toBeNull();
	});

	it("a failed removal restores the subtree", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		expect(() =>
			store.apply(
				batch(2, [
					{ op: "remove", id: 2 },
					{ op: "move", parent: 1, child: 2, index: 0 },
				]),
			),
		).toThrow();
		expect(store.ids()).toEqual([1, 2, 3, 4]);
		expect(store.children(1)).toEqual([2]);
		expect(store.node(4)?.text).toBe("hi");
	});

	it("subscribers cannot observe failed bundles", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		const listener = vi.fn();
		store.subscribe(listener);
		expect(() => store.apply(batch(2, [{ op: "remove", id: 42 }]))).toThrow();
		expect(listener).not.toHaveBeenCalled();
	});
});

describe("notification", () => {
	it("a bundle of a hundred patches calls subscribers once", () => {
		const store = createNativeRuntimeTreeStore();
		const listener = vi.fn();
		store.subscribe(listener);
		const patches: RuntimePatch[] = [];
		for (let id = 1; id <= 50; id += 1) {
			patches.push({ op: "create", id, kind: "view" });
			patches.push({
				op: "insert",
				parent: ROOT_HOST_NODE_ID,
				child: id,
				index: id - 1,
			});
		}
		expect(patches).toHaveLength(100);
		store.apply(batch(1, patches));
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("untouched nodes' versions do not rise", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		const untouched = store.nodeVersion(1);
		const text = store.nodeVersion(4);
		store.apply(batch(2, [{ op: "set-text", id: 4, value: "bye" }]));
		expect(store.nodeVersion(1)).toBe(untouched);
		expect(store.nodeVersion(4)).toBe(text + 1);
	});

	it("reordering children raises only the parent's version", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(
			batch(1, [
				{ op: "create", id: 1, kind: "stack" },
				{ op: "create", id: 2, kind: "text" },
				{ op: "create", id: 3, kind: "text" },
				{ op: "insert", parent: 1, child: 2, index: 0 },
				{ op: "insert", parent: 1, child: 3, index: 1 },
				{ op: "insert", parent: ROOT_HOST_NODE_ID, child: 1, index: 0 },
			]),
		);
		const parent = store.nodeVersion(1);
		const child = store.nodeVersion(2);
		store.apply(batch(2, [{ op: "move", parent: 1, child: 3, index: 0 }]));
		expect(store.nodeVersion(1)).toBe(parent + 1);
		expect(store.nodeVersion(2)).toBe(child);
	});
});

describe("identity", () => {
	it("the host id stays when the text changes", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		const before = store.ids();
		store.apply(batch(2, [{ op: "set-text", id: 4, value: "bye" }]));
		expect(store.ids()).toEqual(before);
	});

	it("a key reorder does not recreate nodes", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(
			batch(1, [
				{ op: "create", id: 1, kind: "stack" },
				{ op: "create", id: 10, kind: "text" },
				{ op: "create", id: 20, kind: "button" },
				{ op: "insert", parent: 1, child: 10, index: 0 },
				{ op: "insert", parent: 1, child: 20, index: 1 },
				{ op: "insert", parent: ROOT_HOST_NODE_ID, child: 1, index: 0 },
			]),
		);
		store.apply(batch(2, [{ op: "move", parent: 1, child: 20, index: 0 }]));
		expect(store.children(1)).toEqual([20, 10]);
		expect(store.ids().sort((a, b) => a - b)).toEqual([1, 10, 20]);
	});
});

describe("lifetime", () => {
	it("reset returns to an empty root and takes revision 1 again", () => {
		const store = createNativeRuntimeTreeStore();
		store.apply(batch(1, seed()));
		expect(() => store.apply(batch(5, []))).toThrow();
		store.reset();
		expect(store.failed).toBe(false);
		expect(store.revision).toBe(0);
		expect(store.ids()).toEqual([]);
		store.apply(batch(1, [{ op: "create", id: 1, kind: "view" }]));
		expect(store.node(1)?.kind).toBe("view");
	});

	it("a disposed store takes no bundles", () => {
		const store = createNativeRuntimeTreeStore();
		store.dispose();
		let code: string | null = null;
		try {
			store.apply(batch(1, []));
		} catch (error) {
			code = (error as { code?: string }).code ?? null;
		}
		expect(code).toBe(NATIVE_RENDERER_ERROR_CODE.disposed);
	});
});
