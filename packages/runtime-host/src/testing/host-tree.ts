import {
	ROOT_HOST_NODE_ID,
	type RuntimeHostNodeKind,
	type RuntimeHostValue,
	type RuntimePatch,
	type RuntimePatchBatch,
} from "../patches.ts";

/**
 * Test host tree: applies patch batches and builds the tree in memory. It is not a renderer and
 * creates no DOM nodes or native views. It lets tests check whether the patch protocol applies in
 * order, and what the reconciler emitted, as values. The Phase 5 renderer applies batches under the
 * same rules but creates platform nodes instead.
 *
 * Strict by design: referencing a missing node, recreating an existing id, skipping a revision, or
 * moving a child that is not in the parent all throw. These are protocol invariant violations.
 * Lenient handling would show the defect later as an intermittent renderer mismatch.
 *
 * snapshot() records only kind, props, and children. Tests compare meaning there. Identity is
 * checked separately through node(id) and ids().
 */

export interface TestHostNode {
	readonly id: number;
	readonly kind: RuntimeHostNodeKind | "root";
	readonly props: Record<string, RuntimeHostValue>;
	text: string | null;
	readonly children: TestHostNode[];
	parent: TestHostNode | null;
}

export type TestHostSnapshot =
	| string
	| {
			type: string;
			props?: Record<string, RuntimeHostValue>;
			children?: TestHostSnapshot[];
	  };

export class TestHostTree {
	readonly root: TestHostNode = {
		id: ROOT_HOST_NODE_ID,
		kind: "root",
		props: {},
		text: null,
		children: [],
		parent: null,
	};
	private readonly nodes = new Map<number, TestHostNode>([
		[ROOT_HOST_NODE_ID, this.root],
	]);
	private readonly seen = new Set<number>();
	revision = 0;
	/** All batches received, so tests can compare the patches themselves. */
	readonly batches: RuntimePatchBatch[] = [];

	apply(batch: RuntimePatchBatch): void {
		if (batch.revision !== this.revision + 1)
			throw new Error(
				`patch batch revision ${batch.revision} does not follow ${this.revision}`,
			);
		/**
		 * A batch that throws does not advance the revision, so the next batch can arrive with the same
		 * number.
		 */
		for (const patch of batch.patches) this.applyPatch(patch);
		this.revision = batch.revision;
		this.batches.push(batch);
	}

	node(id: number): TestHostNode {
		const node = this.nodes.get(id);
		if (node === undefined) throw new Error(`unknown host node ${id}`);
		return node;
	}

	has(id: number): boolean {
		return this.nodes.has(id);
	}

	get size(): number {
		return this.nodes.size - 1;
	}

	private applyPatch(patch: RuntimePatch): void {
		switch (patch.op) {
			case "create": {
				if (this.nodes.has(patch.id))
					throw new Error(`node ${patch.id} already exists`);
				if (this.seen.has(patch.id))
					throw new Error(`node id ${patch.id} was reused after removal`);
				this.seen.add(patch.id);
				this.nodes.set(patch.id, {
					id: patch.id,
					kind: patch.kind,
					props: {},
					text: null,
					children: [],
					parent: null,
				});
				return;
			}
			case "remove": {
				const node = this.node(patch.id);
				if (node.parent !== null) {
					const at = node.parent.children.indexOf(node);
					node.parent.children.splice(at, 1);
					node.parent = null;
				}
				const drop = (target: TestHostNode): void => {
					this.nodes.delete(target.id);
					for (const child of target.children) drop(child);
				};
				drop(node);
				return;
			}
			case "insert": {
				const parent = this.node(patch.parent);
				const child = this.node(patch.child);
				if (child.parent !== null)
					throw new Error(`node ${patch.child} is already inserted`);
				if (patch.index > parent.children.length)
					throw new Error(`insert index ${patch.index} is past the end`);
				parent.children.splice(patch.index, 0, child);
				child.parent = parent;
				return;
			}
			case "move": {
				const parent = this.node(patch.parent);
				const child = this.node(patch.child);
				if (child.parent !== parent)
					throw new Error(
						`node ${patch.child} is not a child of ${patch.parent}`,
					);
				const at = parent.children.indexOf(child);
				parent.children.splice(at, 1);
				if (patch.index > parent.children.length)
					throw new Error(`move index ${patch.index} is past the end`);
				parent.children.splice(patch.index, 0, child);
				return;
			}
			case "set-prop":
				this.node(patch.id).props[patch.name] = patch.value;
				return;
			case "remove-prop":
				delete this.node(patch.id).props[patch.name];
				return;
			case "set-text": {
				const node = this.node(patch.id);
				if (node.kind !== "#text")
					throw new Error(`set-text on a ${node.kind} node ${patch.id}`);
				node.text = patch.value;
				return;
			}
		}
	}

	snapshot(node: TestHostNode = this.root): TestHostSnapshot {
		if (node.kind === "#text") return node.text ?? "";
		const out: Exclude<TestHostSnapshot, string> = { type: node.kind };
		if (Object.keys(node.props).length > 0) out.props = { ...node.props };
		if (node.children.length > 0)
			out.children = node.children.map((child) => this.snapshot(child));
		return out;
	}

	children(): TestHostSnapshot[] {
		return this.root.children.map((child) => this.snapshot(child));
	}

	/** Node ids in depth-first order, used to check that identities stay stable. */
	ids(node: TestHostNode = this.root): number[] {
		const out: number[] = [];
		const walk = (target: TestHostNode): void => {
			if (target !== this.root) out.push(target.id);
			for (const child of target.children) walk(child);
		};
		walk(node);
		return out;
	}

	find(predicate: (node: TestHostNode) => boolean): TestHostNode | null {
		for (const node of this.nodes.values())
			if (node !== this.root && predicate(node)) return node;
		return null;
	}

	/**
	 * Finds the first `#text` node with this text and returns its nearest ancestor. A convenience for
	 * locating `Text` nodes by their string.
	 */
	findByText(text: string): TestHostNode | null {
		const leaf = this.find(
			(node) => node.kind === "#text" && node.text === text,
		);
		return leaf?.parent ?? null;
	}
}
