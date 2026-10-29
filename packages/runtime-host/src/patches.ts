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
		const born = new Set<number>();
		const died = new Set<number>();
		const attached = new Map<number, Set<number>>();
		const detached = new Map<number, Set<number>>();
		let live = this.alive.size;

		const add = (map: Map<number, Set<number>>, key: number, value: number) => {
			const set = map.get(key);
			if (set === undefined) map.set(key, new Set([value]));
			else set.add(value);
		};
		const isAlive = (id: number): boolean =>
			!died.has(id) && (this.alive.has(id) || born.has(id));
		const parentOf = (id: number): number | undefined => {
			for (const [parent, set] of attached) if (set.has(id)) return parent;
			return this.parents.get(id);
		};
		const childrenOf = (id: number): number[] => {
			const out: number[] = [];
			const gone = detached.get(id);
			for (const child of this.children.get(id) ?? [])
				if (gone === undefined || !gone.has(child)) out.push(child);
			for (const child of attached.get(id) ?? []) out.push(child);
			return out;
		};

		for (const patch of patches) {
			switch (patch.op) {
				case "create": {
					if (isAlive(patch.id)) break;
					died.delete(patch.id);
					born.add(patch.id);
					live += 1;
					break;
				}
				case "insert": {
					const previous = parentOf(patch.child);
					if (previous !== undefined && previous !== patch.parent) {
						add(detached, previous, patch.child);
						attached.get(previous)?.delete(patch.child);
					}
					add(attached, patch.parent, patch.child);
					break;
				}
				case "remove": {
					/** Removing a node removes its whole subtree. The children get no separate remove. */
					const stack = [patch.id];
					while (stack.length > 0) {
						const node = stack.pop() as number;
						if (!isAlive(node)) continue;
						died.add(node);
						born.delete(node);
						live -= 1;
						for (const child of childrenOf(node)) stack.push(child);
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
			const heightWithin = (root: number, budget: number): number => {
				let tallest = 0;
				const stack: [number, number][] = [[root, 1]];
				while (stack.length > 0) {
					const [node, height] = stack.pop() as [number, number];
					if (height > tallest) tallest = height;
					if (tallest > budget) return tallest;
					for (const child of childrenOf(node))
						if (isAlive(child)) stack.push([child, height + 1]);
				}
				return tallest;
			};
			outer: for (const set of attached.values())
				for (const child of set) {
					if (!isAlive(child)) continue;
					let ancestors = 0;
					let cursor = parentOf(child);
					while (cursor !== undefined && cursor !== 0) {
						ancestors += 1;
						if (ancestors > maxDepth) break;
						cursor = parentOf(cursor);
					}
					if (
						ancestors + heightWithin(child, maxDepth + 1 - ancestors) - 1 >
						maxDepth
					) {
						tooDeep = true;
						break outer;
					}
				}
		}

		return {
			live: live < 0 ? 0 : live,
			tooDeep,
			commit: () => {
				for (const id of born) this.alive.add(id);
				for (const [parent, set] of detached)
					for (const child of set) this.children.get(parent)?.delete(child);
				for (const [parent, set] of attached)
					for (const child of set) {
						add(this.children, parent, child);
						this.parents.set(child, parent);
					}
				for (const id of died) {
					this.alive.delete(id);
					this.children.delete(id);
					const parent = this.parents.get(id);
					if (parent !== undefined) this.children.get(parent)?.delete(id);
					this.parents.delete(id);
				}
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
