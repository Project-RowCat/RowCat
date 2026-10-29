import {
	ROOT_HOST_NODE_ID,
	type RuntimeHostNodeKind,
	type RuntimeHostValue,
	type RuntimePatch,
	type RuntimePatchBatch,
} from "@rowcat/runtime-host/patches";
import {
	NATIVE_RENDERER_ERROR_CODE,
	NativeRuntimeRendererError,
	rendererError,
} from "./errors.ts";
import {
	assertKnownProp,
	EMPTY_PROPS,
	type ResolvedNodeProps,
	resolveProps,
} from "./props.ts";

/**
 * Native host tree: where patch batches are applied imperatively.
 * - Pipeline: RuntimePatchBatch → this store → one revision advance → subscribers notified once →
 *   RN render.
 * - The web renderer applies patches to the DOM directly; here this store does that job. React
 *   only draws the tree that is already decided. Identity and order are fixed here, and the
 *   reconciler exists once, inside the VM.
 * - Why not turn patches into many setState calls: one commit often carries dozens of patches.
 *   That would make React render dozens of times or expose intermediate states. All mutations
 *   happen inside the store; the revision advances and subscribers fire once, after the whole batch
 *   succeeds.
 * - Atomicity uses an undo journal. A failed patch must leave the tree as if the batch never
 *   applied. The tree is not copied, because cloning a 5,000-node tree on every interaction is too
 *   costly. Each mutation pushes an undo closure, run in reverse, so the cost is proportional to
 *   the patches applied before the failure.
 * - Revision and version bumps are not undone. Touched node versions are bumped once, after
 *   success, so subscribers never observe a failed batch.
 * - Strictness matches the web renderer and TestHostTree: missing nodes, duplicate or reused ids,
 *   out-of-range indexes and children not under their parent all throw. Lenient handling would turn
 *   protocol defects into intermittent visual mismatches nobody can trace.
 */

export interface NativeHostNode {
	readonly id: number;
	readonly kind: RuntimeHostNodeKind | "root";
	/** Props ready for rendering. Values outside the contract cannot reach this point. */
	readonly props: ResolvedNodeProps;
	/** A `#text` node's text. On every other kind this is always an empty string. */
	readonly text: string;
	readonly children: readonly number[];
	readonly parent: number | null;
	/**
	 * The mark of the last commit that changed this node; React's getSnapshot reads it. It rises when
	 * the node's own props or text change, or its child list changes. A change only in a grandchild
	 * does not raise it, because this node's render output does not change: children are drawn by id.
	 */
	readonly version: number;
}

interface Record_ {
	id: number;
	kind: RuntimeHostNodeKind | "root";
	raw: Map<string, RuntimeHostValue>;
	props: ResolvedNodeProps;
	text: string;
	children: number[];
	parent: number | null;
	version: number;
}

export interface NativeRuntimeTreeStore {
	readonly revision: number;
	/** Live host node count, excluding the synthetic root. */
	readonly size: number;
	readonly failed: boolean;
	readonly disposed: boolean;
	readonly failure: NativeRuntimeRendererError | null;
	/**
	 * Applies one batch: all of it succeeds or none of it applies. If this throws, the store enters a
	 * failed state and accepts no further batches or events.
	 */
	apply(batch: RuntimePatchBatch): void;
	/** Returns to the empty root so a new session's first batch (revision 1) is accepted. */
	reset(): void;
	dispose(): void;
	/** Called once per commit. Not called for failed batches. */
	subscribe(listener: () => void): () => void;
	getRevision(): number;
	node(id: number): NativeHostNode | null;
	/**
	 * A node's version. A missing node returns -1, so React does not throw while drawing a node that
	 * has just disappeared.
	 */
	nodeVersion(id: number): number;
	children(id: number): readonly number[];
	/**
	 * Live ids in depth-first order. Used to check that the store and the screen describe the same
	 * tree.
	 */
	ids(): number[];
}

const topology = (message: string) =>
	rendererError(NATIVE_RENDERER_ERROR_CODE.topology, message);

function makeRoot(): Record_ {
	return {
		id: ROOT_HOST_NODE_ID,
		kind: "root",
		raw: new Map(),
		props: EMPTY_PROPS,
		text: "",
		children: [],
		parent: null,
		version: 0,
	};
}

export function createNativeRuntimeTreeStore(): NativeRuntimeTreeStore {
	let records = new Map<number, Record_>();
	let seen = new Set<number>();
	let root = makeRoot();
	records.set(ROOT_HOST_NODE_ID, root);

	let revision = 0;
	let failure: NativeRuntimeRendererError | null = null;
	let disposed = false;
	const listeners = new Set<() => void>();

	const get = (id: number): Record_ => {
		const record = records.get(id);
		if (record === undefined)
			throw rendererError(
				NATIVE_RENDERER_ERROR_CODE.unknownNode,
				`unknown host node ${id}`,
			);
		return record;
	};

	/** Depth-first list of a subtree. Removal records it so the removal can be undone on rollback. */
	const subtree = (record: Record_, out: Record_[] = []): Record_[] => {
		out.push(record);
		for (const child of record.children) out.push(...subtree(get(child)));
		return out;
	};

	interface Journal {
		undo: (() => void)[];
		touched: Set<number>;
		created: number[];
	}

	function applyPatch(patch: RuntimePatch, journal: Journal): void {
		switch (patch.op) {
			case "create": {
				if (records.has(patch.id))
					throw rendererError(
						NATIVE_RENDERER_ERROR_CODE.nodeReused,
						`host node ${patch.id} already exists`,
					);
				if (seen.has(patch.id))
					throw rendererError(
						NATIVE_RENDERER_ERROR_CODE.nodeReused,
						`host node id ${patch.id} was reused after removal`,
					);
				const record: Record_ = {
					id: patch.id,
					kind: patch.kind,
					raw: new Map(),
					props: EMPTY_PROPS,
					text: "",
					children: [],
					parent: null,
					version: 0,
				};
				records.set(patch.id, record);
				seen.add(patch.id);
				journal.created.push(patch.id);
				journal.undo.push(() => {
					records.delete(patch.id);
					seen.delete(patch.id);
				});
				return;
			}
			case "remove": {
				const record = get(patch.id);
				const parent = record.parent === null ? null : get(record.parent);
				const at = parent === null ? -1 : parent.children.indexOf(patch.id);
				const detached = subtree(record);
				if (parent !== null) {
					parent.children = parent.children.filter((id) => id !== patch.id);
					journal.touched.add(parent.id);
				}
				record.parent = null;
				for (const node of detached) records.delete(node.id);
				journal.undo.push(() => {
					for (const node of detached) records.set(node.id, node);
					record.parent = parent === null ? null : parent.id;
					if (parent !== null && at >= 0)
						parent.children = [
							...parent.children.slice(0, at),
							patch.id,
							...parent.children.slice(at),
						];
				});
				return;
			}
			case "insert": {
				const parent = get(patch.parent);
				const child = get(patch.child);
				if (child.parent !== null)
					throw topology(`host node ${patch.child} is already inserted`);
				if (patch.index > parent.children.length)
					throw topology(
						`insert index ${patch.index} is past the end of ${patch.parent}`,
					);
				const before = parent.children;
				parent.children = [
					...before.slice(0, patch.index),
					patch.child,
					...before.slice(patch.index),
				];
				child.parent = patch.parent;
				journal.touched.add(parent.id);
				journal.undo.push(() => {
					parent.children = before;
					child.parent = null;
				});
				return;
			}
			case "move": {
				const parent = get(patch.parent);
				const child = get(patch.child);
				if (child.parent !== patch.parent)
					throw topology(
						`host node ${patch.child} is not a child of ${patch.parent}`,
					);
				const before = parent.children;
				const without = before.filter((id) => id !== patch.child);
				if (patch.index > without.length)
					throw topology(
						`move index ${patch.index} is past the end of ${patch.parent}`,
					);
				parent.children = [
					...without.slice(0, patch.index),
					patch.child,
					...without.slice(patch.index),
				];
				journal.touched.add(parent.id);
				journal.undo.push(() => {
					parent.children = before;
				});
				return;
			}
			case "set-prop": {
				const record = get(patch.id);
				if (record.kind === "root")
					throw rendererError(
						NATIVE_RENDERER_ERROR_CODE.contract,
						`the root container has no props (got ${patch.name})`,
					);
				assertKnownProp(record.kind, patch.name);
				/** Compute first, then record: invalid values never remain on the record. */
				const raw = new Map(record.raw);
				raw.set(patch.name, patch.value);
				const props = resolveProps(record.kind, raw);
				const beforeRaw = record.raw;
				const beforeProps = record.props;
				record.raw = raw;
				record.props = props;
				journal.touched.add(record.id);
				journal.undo.push(() => {
					record.raw = beforeRaw;
					record.props = beforeProps;
				});
				return;
			}
			case "remove-prop": {
				const record = get(patch.id);
				if (record.kind === "root")
					throw rendererError(
						NATIVE_RENDERER_ERROR_CODE.contract,
						`the root container has no props (got ${patch.name})`,
					);
				assertKnownProp(record.kind, patch.name);
				const raw = new Map(record.raw);
				raw.delete(patch.name);
				const props = resolveProps(record.kind, raw);
				const beforeRaw = record.raw;
				const beforeProps = record.props;
				record.raw = raw;
				record.props = props;
				journal.touched.add(record.id);
				journal.undo.push(() => {
					record.raw = beforeRaw;
					record.props = beforeProps;
				});
				return;
			}
			case "set-text": {
				const record = get(patch.id);
				if (record.kind !== "#text")
					throw topology(`set-text on a ${record.kind} node ${patch.id}`);
				const before = record.text;
				record.text = patch.value;
				journal.touched.add(record.id);
				journal.undo.push(() => {
					record.text = before;
				});
				return;
			}
		}
	}

	const fail = (error: NativeRuntimeRendererError): never => {
		if (failure === null) failure = error;
		throw error;
	};

	return {
		get revision() {
			return revision;
		},
		get size() {
			return records.size - 1;
		},
		get failed() {
			return failure !== null;
		},
		get disposed() {
			return disposed;
		},
		get failure() {
			return failure;
		},
		apply(batch) {
			if (disposed)
				throw rendererError(
					NATIVE_RENDERER_ERROR_CODE.disposed,
					"renderer is disposed",
				);
			if (failure !== null)
				throw rendererError(
					NATIVE_RENDERER_ERROR_CODE.failed,
					`renderer failed earlier: ${failure.message}`,
				);
			if (batch.revision !== revision + 1)
				fail(
					rendererError(
						NATIVE_RENDERER_ERROR_CODE.revisionMismatch,
						`patch batch revision ${batch.revision} does not follow ${revision}`,
					),
				);
			const journal: Journal = {
				undo: [],
				touched: new Set(),
				created: [],
			};
			try {
				for (const patch of batch.patches) applyPatch(patch, journal);
			} catch (error) {
				for (let i = journal.undo.length - 1; i >= 0; i -= 1)
					(journal.undo[i] as () => void)();
				fail(
					error instanceof NativeRuntimeRendererError
						? error
						: topology(error instanceof Error ? error.message : String(error)),
				);
			}
			/** The commit point: bump touched node versions, advance the revision, then notify once. */
			for (const id of journal.touched) {
				const record = records.get(id);
				if (record !== undefined) record.version += 1;
			}
			revision = batch.revision;
			for (const listener of [...listeners]) listener();
		},
		reset() {
			if (disposed) return;
			records = new Map();
			seen = new Set();
			root = makeRoot();
			records.set(ROOT_HOST_NODE_ID, root);
			revision = 0;
			failure = null;
			for (const listener of [...listeners]) listener();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			records.clear();
			seen.clear();
			root = makeRoot();
			records.set(ROOT_HOST_NODE_ID, root);
			revision = 0;
			for (const listener of [...listeners]) listener();
			listeners.clear();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getRevision() {
			return revision;
		},
		node(id) {
			return records.get(id) ?? null;
		},
		nodeVersion(id) {
			return records.get(id)?.version ?? -1;
		},
		children(id) {
			return records.get(id)?.children ?? EMPTY_CHILDREN;
		},
		ids() {
			const out: number[] = [];
			const walk = (record: Record_): void => {
				if (record.id !== ROOT_HOST_NODE_ID) out.push(record.id);
				for (const child of record.children) {
					const node = records.get(child);
					if (node !== undefined) walk(node);
				}
			};
			walk(root);
			return out;
		},
	};
}

/**
 * The child list of a missing node. A stable reference keeps useSyncExternalStore from re-rendering
 * repeatedly.
 */
const EMPTY_CHILDREN: readonly number[] = Object.freeze([]);
