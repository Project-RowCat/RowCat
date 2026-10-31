import type { RuntimeHostKind } from "@rowcat/runtime";
import { isRecord } from "./is-record.ts";

/**
 * The patch protocol: the host-neutral vocabulary between the VM reconciler and the renderer.
 *
 * The spec is docs/creator-runtime/patch-protocol.md. This file is the host-side authority for the
 * shapes (types), validation (validatePatchBatch), and limits (RuntimeRootLimits). A runtime
 * generated inside the VM produces the same shapes, but that code runs in the creator's realm, so
 * the host walks the batch again. This is the same judgment as checking wire values twice.
 *
 * What the renderer may rely on:
 * - revision starts at 1 and increases monotonically. Every batch for a root arrives in order.
 * - An operation never refers to a node that has not been created yet. Subtrees are complete
 *   before they are inserted into a parent.
 * - set-prop follows create and precedes insert. Within one parent, a remove comes before an
 *   insert or move, so the renderer can apply each line without looking ahead.
 * - insert and move indexes refer to the parent's child list at that moment. remove takes the
 *   whole subtree, and children get no separate removes.
 *
 * Values are JSON plus three markers:
 * - { "$handler": n } is a number for a function inside the VM. The renderer calls dispatchEvent
 *   with it.
 * - { "$asset": path } is an asset reference, resolved by the asset host.
 * - { "$control": n } is a controller. The renderer records the number and its node in its own
 *   table, and later control commands go through that table (commands.ts).
 *
 * Function source, asset bytes, and platform objects never cross. Making the controller an ordinary
 * prop value is the design point: no new operation is needed, and attach and detach ride the
 * existing set-prop, remove-prop, and remove rules.
 */

export type RuntimeHostNodeKind = RuntimeHostKind | "#text";

export type RuntimeHostValue =
	| null
	| boolean
	| number
	| string
	| readonly RuntimeHostValue[]
	| { readonly [key: string]: RuntimeHostValue };

export type RuntimePatch =
	| {
			readonly op: "create";
			readonly id: number;
			readonly kind: RuntimeHostNodeKind;
	  }
	| { readonly op: "remove"; readonly id: number }
	| {
			readonly op: "insert";
			readonly parent: number;
			readonly child: number;
			readonly index: number;
	  }
	| {
			readonly op: "move";
			readonly parent: number;
			readonly child: number;
			readonly index: number;
	  }
	| {
			readonly op: "set-prop";
			readonly id: number;
			readonly name: string;
			readonly value: RuntimeHostValue;
	  }
	| { readonly op: "remove-prop"; readonly id: number; readonly name: string }
	| { readonly op: "set-text"; readonly id: number; readonly value: string };

export interface RuntimePatchBatch {
	readonly revision: number;
	readonly patches: readonly RuntimePatch[];
}

/** The synthetic root container. It is not a renderer primitive and never arrives via `create`. */
export const ROOT_HOST_NODE_ID = 0;

/**
 * The root limits. These are not operational values.
 *
 * The earlier limits are enforced first by the reconciler inside the VM (passed to mountRoot as
 * options), and the host counts again when it receives a batch. maxCommitBytes is host-only: it is
 * measured by string length before parsing, so a hostile tree cannot make the host allocate memory
 * first.
 */
export interface RuntimeRootLimits {
	readonly maxTreeDepth: number;
	readonly maxHostNodes: number;
	readonly maxPatchesPerCommit: number;
	readonly maxCommitBytes: number;
	/**
	 * The command limits follow the same pattern. The VM counts first (maxCommandsPerFlush), and the
	 * host counts again. maxCommandBytes is host-only and is measured by string length before parsing.
	 */
	readonly maxCommandsPerBatch: number;
	readonly maxCommandBytes: number;
}

export const DEFAULT_ROOT_LIMITS: RuntimeRootLimits = Object.freeze({
	maxTreeDepth: 64,
	maxHostNodes: 5_000,
	maxPatchesPerCommit: 50_000,
	maxCommitBytes: 4 * 1024 * 1024,
	maxCommandsPerBatch: 64,
	maxCommandBytes: 16 * 1024,
});

const HOST_KINDS: ReadonlySet<string> = new Set([
	"screen",
	"view",
	"stack",
	"row",
	"scroll",
	"text",
	"image",
	"button",
	"pressable",
	"progress",
	"text-input",
	"text-area",
	"audio",
	"#text",
]);

const isId = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0;

const isIndex = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Nesting cap for prop values. It must match the VM-side normalization cap. */
const MAX_VALUE_DEPTH = 8;

function checkValue(value: unknown, depth: number): string | null {
	if (value === null) return null;
	switch (typeof value) {
		case "boolean":
		case "string":
			return null;
		case "number":
			return Number.isFinite(value) ? null : "non-finite number";
		case "object":
			break;
		default:
			return `unsupported value type ${typeof value}`;
	}
	if (depth > MAX_VALUE_DEPTH) return "value nested too deeply";
	if (Array.isArray(value)) {
		for (const entry of value) {
			const problem = checkValue(entry, depth + 1);
			if (problem !== null) return problem;
		}
		return null;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null)
		return "not a plain object";
	for (const key of Object.keys(value as object)) {
		const problem = checkValue(
			(value as Record<string, unknown>)[key],
			depth + 1,
		);
		if (problem !== null) return problem;
	}
	return null;
}

function checkPatch(value: unknown): string | null {
	if (!isRecord(value)) return "patch is not an object";
	switch (value.op) {
		case "create":
			if (!isId(value.id)) return "create: invalid id";
			if (value.id === ROOT_HOST_NODE_ID) return "create: root id is reserved";
			if (typeof value.kind !== "string" || !HOST_KINDS.has(value.kind))
				return `create: unknown kind ${String(value.kind)}`;
			return null;
		case "remove":
			return isId(value.id) && value.id !== ROOT_HOST_NODE_ID
				? null
				: "remove: invalid id";
		case "insert":
		case "move":
			if (!isId(value.parent)) return `${value.op}: invalid parent`;
			if (!isId(value.child) || value.child === ROOT_HOST_NODE_ID)
				return `${value.op}: invalid child`;
			if (!isIndex(value.index)) return `${value.op}: invalid index`;
			return null;
		case "set-prop":
			if (!isId(value.id) || value.id === ROOT_HOST_NODE_ID)
				return "set-prop: invalid id";
			if (typeof value.name !== "string" || value.name.length === 0)
				return "set-prop: invalid name";
			if (value.name === "children") return "set-prop: children is structural";
			return checkValue(value.value, 1);
		case "remove-prop":
			if (!isId(value.id) || value.id === ROOT_HOST_NODE_ID)
				return "remove-prop: invalid id";
			return typeof value.name === "string" && value.name.length > 0
				? null
				: "remove-prop: invalid name";
		case "set-text":
			if (!isId(value.id) || value.id === ROOT_HOST_NODE_ID)
				return "set-text: invalid id";
			return typeof value.value === "string"
				? null
				: "set-text: value is not a string";
		default:
			return `unknown op ${String(value.op)}`;
	}
}

/**
 * The host's own node ledger: the tree the renderer holds right now, counted by the host.
 *
 * Why one number cannot do the counting: a `remove` takes out one subtree. If live nodes are
 * counted as +1 per create and -1 per remove, the count drifts upward every time a screen is
 * replaced. For example, a swap that creates 150 nodes and removes one moves the count by +149
 * while the real tree stays the same. After about 23 swaps the tree held 101 real nodes but the
 * count was 5,216, which exceeded the 5,000 limit, so every commit was rejected. Nothing brings the
 * count back down, so the work froze permanently. The failure is silent and appears only after many
 * screen changes, so short scenarios do not reproduce it.
 *
 * So the ledger keeps parent-child links, because whoever knows the subtree size must do the
 * counting. Two alternatives were rejected. Having the VM report the removed count would make the
 * host enforce its limit with a number the VM supplied. Sending one remove per node would turn a
 * single screen change into a hundred patches. Either way, the reason for the limit disappears.
 *
 * project() computes the result without applying it. A rejected batch must not move the ledger, or
 * the next calculation would build on values that are already wrong. The consumer applies the
 * change by calling commit() once it accepts the batch.
 *
 * project() must stay linear in the batch. It runs synchronously inside the VM turn (the session's
 * emit), where no interrupt can cut host work, and its time is charged to the creator's budget. A
 * batch is also a string creator code can shape (see the depth check below), so linear has to hold
 * for every sequence of operations, not only for the ones the reconciler sends. Three walks once
 * were not: finding a node's parent by scanning every parent the batch had attached (an ordinary
 * 3,000-node mount spent 240 ms here and blew the session's 250 ms window, and a forged
 * 50,000-insert batch held the thread for 18 s); walking every attached subtree afresh for its
 * height; and removing a node the batch had re-created, which walked that id's committed children
 * again on every remove (a forged remove/create pair repeated 25,000 times over a parent of 5,000
 * children took 5 to 10 s). So the batch keeps its own child → parent map, a node that dies is cut
 * from its parent and forgets its children on the spot, and heights and depths are computed once per
 * node. A node's committed children are then read at most once by the remove walk and once by the
 * depth walk, and each patch adds a bounded amount of work. Nothing in a projection deletes a key and
 * adds it back (see `state`): even with no walk repeated, that churn alone is quadratic in V8.
 */
export class RuntimeHostNodeLedger {
	/** Live nodes. The synthetic root (0) never comes from `create`, so it is not in this set. */
	private readonly alive = new Set<number>();
	private readonly children = new Map<number, Set<number>>();
	private readonly parents = new Map<number, number>();

	get size(): number {
		return this.alive.size;
	}

	/**
	 * Counts the nodes that would remain if this batch were applied. The ledger itself stays
	 * unchanged. Calling the returned `commit` applies it. Computing and applying walk the same steps,
	 * so the two cannot diverge.
	 */
	project(
		patches: readonly RuntimePatch[],
		maxDepth = Number.POSITIVE_INFINITY,
	): {
		readonly live: number;
		/** Whether a node this batch attached would sit deeper than `maxDepth`. */
		readonly tooDeep: boolean;
		readonly commit: () => void;
	} {
		/**
		 * What this batch did to each id it touched: `true` created and alive, `false` removed. Ids it
		 * did not touch keep their committed state. One value per id, overwritten, never added and
		 * deleted: V8 keeps a deleted Set or Map key in its hash chain until the table is rebuilt, so
		 * removing and re-adding one key thousands of times in a large table makes every later lookup of
		 * that key walk the whole chain. Two sets toggled this way cost about 900 ms for a forged batch
		 * of 25,000 remove/create pairs. Every structure below is likewise only added to or overwritten.
		 */
		const state = new Map<number, boolean>();
		/**
		 * Every id that died at some point in this batch, alive again or not. Its committed children no
		 * longer describe it: a `create` of a dead id is a new node, with no parent until an insert and
		 * no children but the ones this batch attaches afterwards. Without this, each remove of a
		 * re-created id walked the committed children the first remove had already killed.
		 */
		const cleared = new Set<number>();
		/**
		 * Where this batch last put each node it touched. It shadows the committed parents. `undefined`
		 * means the node died here and hangs nowhere until it is inserted again.
		 */
		const placed = new Map<number, number | undefined>();
		/**
		 * The children this batch inserted under each parent, as candidates: one that moved on or died
		 * since stays in the set and is filtered by `placed`. A parent that dies gets a fresh empty set, so
		 * a re-created id never rereads the candidates of its previous life.
		 */
		const attached = new Map<number, Set<number>>();
		let live = this.alive.size;

		const isAlive = (id: number): boolean =>
			state.get(id) ?? this.alive.has(id);
		const parentOf = (id: number): number | undefined =>
			placed.has(id) ? placed.get(id) : this.parents.get(id);
		/** A committed child the batch never touched is still where it was; any it touched is in `placed`. */
		const childrenOf = (id: number): number[] => {
			const out: number[] = [];
			if (!cleared.has(id))
				for (const child of this.children.get(id) ?? [])
					if (!placed.has(child)) out.push(child);
			for (const child of attached.get(id) ?? [])
				if (placed.get(child) === id) out.push(child);
			return out;
		};

		for (const patch of patches) {
			switch (patch.op) {
				case "create": {
					if (isAlive(patch.id)) break;
					state.set(patch.id, true);
					live += 1;
					break;
				}
				case "insert": {
					const set = attached.get(patch.parent);
					if (set === undefined)
						attached.set(patch.parent, new Set([patch.child]));
					else set.add(patch.child);
					placed.set(patch.child, patch.parent);
					break;
				}
				case "remove": {
					/** Removing a node removes its whole subtree. The children get no separate remove. */
					const stack = [patch.id];
					while (stack.length > 0) {
						const node = stack.pop() as number;
						if (!isAlive(node)) continue;
						state.set(node, false);
						live -= 1;
						/**
						 * The dead node leaves its parent and forgets its children here, once. Each live child
						 * goes on the stack and dies with it; a child already dead (one a forged batch inserted
						 * without creating) is cut loose, so nothing points at this id any more and a later
						 * `create` of it starts empty, as a new node.
						 */
						for (const child of childrenOf(node))
							if (isAlive(child)) stack.push(child);
							else placed.set(child, undefined);
						placed.set(node, undefined);
						cleared.add(node);
						if (attached.has(node)) attached.set(node, new Set());
					}
					break;
				}
				default:
					break;
			}
		}

		/**
		 * Depth is checked here too, not only by the reconciler in the VM: a batch is a string the VM
		 * hands over, and creator code can make it whatever it likes (an `Object.prototype.toJSON` reaches
		 * the stringify the root uses). A 5,000-deep chain would then reach the renderers' layout.
		 *
		 * Only what this batch attached can have grown deeper, so only those subtrees are walked: their
		 * ancestors up to the synthetic root, plus their own height. Depth counts ancestors below the root
		 * (a child of the root is 0). The reconciler counts fibers, components included, so for a real tree
		 * this number is never larger than the one the VM already accepted. Both walks stop once past the
		 * limit, which also ends a walk that a cycle would make endless.
		 */
		let tooDeep = false;
		if (Number.isFinite(maxDepth)) {
			/**
			 * Heights are capped one past what any check can accept: a subtree at least that tall is too deep
			 * wherever it hangs, so the exact number past it buys nothing. Each node's height is computed
			 * once and remembered; walking every attached child's subtree afresh made a fresh mount cost the
			 * sum of all subtree sizes. A node met again while its own height is still open is a cycle, and
			 * a cycle counts as too deep, which is also what ends it.
			 */
			const cap = maxDepth + 2;
			const heights = new Map<number, number>();
			const open = new Set<number>();
			const heightOf = (root: number): number => {
				const known = heights.get(root);
				if (known !== undefined) return known;
				const stack: {
					node: number;
					children: number[];
					next: number;
					tallest: number;
				}[] = [];
				const enter = (node: number) => {
					open.add(node);
					stack.push({ node, children: childrenOf(node), next: 0, tallest: 1 });
				};
				enter(root);
				let result = 1;
				while (stack.length > 0) {
					const frame = stack[stack.length - 1] as (typeof stack)[number];
					if (frame.tallest < cap && frame.next < frame.children.length) {
						const child = frame.children[frame.next] as number;
						frame.next += 1;
						if (!isAlive(child)) continue;
						const seen = heights.get(child);
						if (seen !== undefined)
							frame.tallest = Math.max(frame.tallest, Math.min(cap, seen + 1));
						else if (open.has(child)) frame.tallest = cap;
						else if (stack.length >= cap) frame.tallest = cap;
						else enter(child);
						continue;
					}
					stack.pop();
					open.delete(frame.node);
					heights.set(frame.node, frame.tallest);
					result = frame.tallest;
					const parent = stack[stack.length - 1];
					if (parent !== undefined)
						parent.tallest = Math.max(
							parent.tallest,
							Math.min(cap, frame.tallest + 1),
						);
				}
				return result;
			};
			/**
			 * Ancestor counts are remembered the same way: 50,000 attached children each walking up to 64
			 * ancestors is still a walk per child, and siblings share every step of it. A walk that passes
			 * the limit is too deep at once and ends the check, so only counts that reached the root (or a
			 * node hanging nowhere, or one already counted) are remembered, and those are exact. A cycle
			 * never reaches either and so always ends as too deep.
			 */
			const ancestorCounts = new Map<number, number>();
			const ancestorsOf = (node: number): number => {
				const path: number[] = [];
				let cursor: number | undefined = node;
				let above = -1;
				while (cursor !== undefined && cursor !== 0) {
					const known = ancestorCounts.get(cursor);
					if (known !== undefined) {
						above = known;
						break;
					}
					if (path.length > maxDepth + 1) return Number.POSITIVE_INFINITY;
					path.push(cursor);
					cursor = parentOf(cursor);
				}
				for (let i = path.length - 1; i >= 0; i -= 1) {
					above += 1;
					ancestorCounts.set(path[i] as number, above);
				}
				/** `node` itself is not its own ancestor. */
				return above;
			};
			outer: for (const [parent, set] of attached)
				for (const child of set) {
					/** A candidate that moved on is checked under the parent it moved to. */
					if (!isAlive(child) || placed.get(child) !== parent) continue;
					const ancestors = parent === 0 ? 0 : ancestorsOf(parent) + 1;
					if (ancestors + heightOf(child) - 1 > maxDepth) {
						tooDeep = true;
						break outer;
					}
				}
		}

		return {
			live: live < 0 ? 0 : live,
			tooDeep,
			commit: () => {
				/**
				 * A node that died here forgets its committed children. Each of them was moved away or died
				 * with it, so each is in `placed` and is put where it now hangs just below.
				 */
				for (const id of cleared) this.children.delete(id);
				for (const [child, parent] of placed) {
					const before = this.parents.get(child);
					if (before !== undefined) this.children.get(before)?.delete(child);
					if (parent === undefined) {
						this.parents.delete(child);
						continue;
					}
					const set = this.children.get(parent);
					if (set === undefined) this.children.set(parent, new Set([child]));
					else set.add(child);
					this.parents.set(child, parent);
				}
				for (const [id, alive] of state)
					if (alive) this.alive.add(id);
					else this.alive.delete(id);
			},
		};
	}
}

export type PatchBatchValidation =
	| {
			ok: true;
			batch: RuntimePatchBatch;
			/** The consumer calls this after accepting the batch. The ledger changes only then. */
			commit: () => void;
	  }
	| { ok: false; reason: string; limit: boolean };

/**
 * Turns a batch from the VM's JSON into a batch object. It is not trusted: the length is checked
 * first, then the JSON is parsed and each entry is walked.
 *
 * If expectedRevision is given, the revision must match it exactly. Missing or regressed batches
 * are rejected. Node counts come from the ledger (tree). A single remove covers a whole subtree, so
 * one number cannot count them. Without a ledger, only this batch is counted.
 */
export function validatePatchBatch(
	json: string,
	limits: RuntimeRootLimits,
	options: { expectedRevision?: number; tree?: RuntimeHostNodeLedger } = {},
): PatchBatchValidation {
	if (json.length > limits.maxCommitBytes)
		return {
			ok: false,
			reason: `commit exceeds ${limits.maxCommitBytes} bytes`,
			limit: true,
		};
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { ok: false, reason: "malformed json", limit: false };
	}
	if (!isRecord(parsed))
		return { ok: false, reason: "batch is not an object", limit: false };
	const { revision, patches } = parsed;
	if (!isId(revision) || revision < 1)
		return { ok: false, reason: "invalid revision", limit: false };
	if (
		options.expectedRevision !== undefined &&
		revision !== options.expectedRevision
	)
		return {
			ok: false,
			reason: `revision ${revision} does not follow ${options.expectedRevision - 1}`,
			limit: false,
		};
	if (!Array.isArray(patches))
		return { ok: false, reason: "patches is not an array", limit: false };
	if (patches.length > limits.maxPatchesPerCommit)
		return {
			ok: false,
			reason: `commit has ${patches.length} patches, limit is ${limits.maxPatchesPerCommit}`,
			limit: true,
		};
	for (let index = 0; index < patches.length; index += 1) {
		const problem = checkPatch(patches[index]);
		if (problem !== null)
			return { ok: false, reason: `patch ${index}: ${problem}`, limit: false };
	}
	const checked = patches as RuntimePatch[];
	const projected = (options.tree ?? new RuntimeHostNodeLedger()).project(
		checked,
		limits.maxTreeDepth,
	);
	if (projected.tooDeep)
		return {
			ok: false,
			reason: `commit would nest host nodes deeper than ${limits.maxTreeDepth}`,
			limit: true,
		};
	if (projected.live > limits.maxHostNodes)
		return {
			ok: false,
			reason: `commit would leave ${projected.live} host nodes, limit is ${limits.maxHostNodes}`,
			limit: true,
		};
	return {
		ok: true,
		batch: { revision, patches: checked },
		commit: projected.commit,
	};
}

/**
 * Whether a host value is a handler reference. This is where the renderer turns `onPress` into a
 * number.
 */
export const handlerIdOf = (value: RuntimeHostValue): number | null =>
	isRecord(value) && typeof value.$handler === "number" ? value.$handler : null;

export const assetPathOf = (value: RuntimeHostValue): string | null =>
	isRecord(value) && typeof value.$asset === "string" ? value.$asset : null;

/**
 * Whether a host value is a controller reference. The renderer records `controller` in its own
 * table here. An invalid value yields null, and the renderer then fails the batch with a contract
 * error. Silently ignoring it would leave no trace of why the creator's controller does nothing.
 */
export const controlIdOf = (value: RuntimeHostValue): number | null =>
	isRecord(value) &&
	typeof value.$control === "number" &&
	Number.isInteger(value.$control) &&
	value.$control > 0
		? value.$control
		: null;
