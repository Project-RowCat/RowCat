import type { RuntimeHostNodeKind } from "@rowcat/runtime-host/patches";
import type { WebAudioController } from "./audio.ts";
import { rendererError, WEB_RENDERER_ERROR_CODE } from "./errors.ts";
import { newNodeMotion, type WebNodeMotion } from "./motion.ts";
import type { CssMap } from "./styles.ts";

/**
 * The node registry: host node id to DOM node, plus its topology.
 *
 * Lookup uses one Map, so it is O(1), and no patch searches the DOM by selector. The reverse path
 * (DOM node back to record) uses a WeakMap, which event delegation needs. Neither the author's
 * function nor its source is attached to the DOM; only renderer metadata is.
 *
 * This is as strict as TestHostTree. A missing node, duplicate id, reused id, out-of-range index,
 * or a child not under its parent all throw. Lenient handling would turn protocol defects into
 * occasional wrong screens that nobody can trace back to their cause.
 */

export interface NodeRecord {
	readonly id: number;
	readonly kind: RuntimeHostNodeKind | "root";
	readonly node: HTMLElement | Text;
	parent: NodeRecord | null;
	readonly children: NodeRecord[];
	/** Prop name to handler id. Handler ids stay in this record and never reach the DOM. */
	readonly handlers: Map<string, number>;
	/** Current prop values. Axes computed together, such as style and gap, read each other here. */
	readonly props: Map<string, unknown>;
	/**
	 * Inline declarations this renderer has written. `syncInlineCss` compares them against the target.
	 */
	readonly css: CssMap;
	disabled: boolean;
	/**
	 * Whether IME is composing text. Only text-input nodes ever set this to true.
	 *
	 * This flag carries all of the Korean input handling. While composing: (1) the controlled value is
	 * not written back to the DOM, because doing so breaks the composition at that point, and (2)
	 * Enter is not read as submit, because that Enter confirms the candidate.
	 */
	composing: boolean;
	/**
	 * The last text sent to the host. The same value is never sent twice.
	 *
	 * Some browsers fire one more `input` after `compositionend`, describing the same fact. The
	 * duplicate looks harmless, but each one costs a VM turn, and those turns happen on every
	 * character.
	 */
	sentText: string | null;
	/**
	 * The number of texts sent whose answers have not arrived yet. The host round trip is
	 * asynchronous, so the count is needed.
	 *
	 * The author owns the controlled value, but its answer returns a turn later, through the worker
	 * (preview) or the bridge (playback). The user keeps typing in the meantime, so an arriving commit
	 * can be older than the screen. Writing it straight in would undo the character just typed. For
	 * Korean, the undo misaligns with the IME composition range and duplicates or scrambles jamo (a two-syllable word
	 * comes out with a repeated or missing syllable).
	 *
	 * So the controlled value rewrites the screen only when the answer to the most recent send
	 * arrives. The count exists because the VM's returned value has no sequence number and the patch
	 * protocol does not add one. If the count is wrong, it should err toward not erasing what the user
	 * typed.
	 */
	pendingSends: number;
	/**
	 * This node's sound lifetime holder. Null for every other kind.
	 *
	 * The record holds it because removal must mean stop. The release path (`release`) is the one
	 * place that knows about sound. Without it, the renderer would need a separate scan of removed
	 * nodes, and a removal that skips that scan shows up as a sound that keeps playing after it left
	 * the screen.
	 */
	audio: WebAudioController | null;
	/**
	 * The controller number attached to this node. Null if none is attached.
	 *
	 * Like sound, this is kept on the record because every path out of the tree passes through
	 * `release`, so clearing the controller table there leaves no place to forget it. A missed removal
	 * would leave a controller pointing at a node that is gone, and that state is invisible on screen.
	 */
	control: number | null;
	/**
	 * This node's transition policy and whether it is armed. See motion.ts.
	 *
	 * Like sound and controllers, this lives on the record because every path by which a node
	 * disappears passes through `release`, so cleanup placed there cannot be forgotten.
	 */
	readonly motion: WebNodeMotion;
}

export class NodeRegistry {
	private readonly byId = new Map<number, NodeRecord>();
	private readonly byNode = new WeakMap<Node, NodeRecord>();
	private readonly seen = new Set<number>();
	/**
	 * Maps a controller number to its node. The lookup is a table, O(1), and never walks the tree.
	 *
	 * This table is also this slice's security property. A command carries only a controller number,
	 * and only what the renderer recorded from its own props says which node that is. A number the
	 * author made up or guessed is not in the table.
	 */
	private readonly byControl = new Map<number, NodeRecord>();
	readonly root: NodeRecord;

	constructor(rootId: number, rootElement: HTMLElement) {
		this.root = {
			id: rootId,
			kind: "root",
			node: rootElement,
			parent: null,
			children: [],
			handlers: new Map(),
			props: new Map(),
			css: new Map(),
			disabled: false,
			composing: false,
			sentText: null,
			pendingSends: 0,
			audio: null,
			control: null,
			motion: newNodeMotion(),
		};
		this.byId.set(rootId, this.root);
		this.byNode.set(rootElement, this.root);
	}

	get size(): number {
		return this.byId.size - 1;
	}

	has(id: number): boolean {
		return this.byId.has(id);
	}

	get(id: number): NodeRecord {
		const record = this.byId.get(id);
		if (record === undefined)
			throw rendererError(
				WEB_RENDERER_ERROR_CODE.unknownNode,
				`unknown host node ${id}`,
			);
		return record;
	}

	fromNode(node: Node): NodeRecord | null {
		return this.byNode.get(node) ?? null;
	}

	create(
		id: number,
		kind: RuntimeHostNodeKind,
		node: HTMLElement | Text,
	): NodeRecord {
		if (this.byId.has(id))
			throw rendererError(
				WEB_RENDERER_ERROR_CODE.nodeReused,
				`host node ${id} already exists`,
			);
		if (this.seen.has(id))
			throw rendererError(
				WEB_RENDERER_ERROR_CODE.nodeReused,
				`host node id ${id} was reused after removal`,
			);
		this.seen.add(id);
		const record: NodeRecord = {
			id,
			kind,
			node,
			parent: null,
			children: [],
			handlers: new Map(),
			props: new Map(),
			css: new Map(),
			disabled: false,
			composing: false,
			sentText: null,
			pendingSends: 0,
			audio: null,
			control: null,
			motion: newNodeMotion(),
		};
		this.byId.set(id, record);
		this.byNode.set(node, record);
		return record;
	}

	/**
	 * Releases the registration of a whole subtree, so no DOM from a removed node stays in the
	 * registry.
	 *
	 * Sound ends here. Every path by which a node leaves the tree (removal, removal of its parent,
	 * session reset) goes through this function, so the stop belongs here where nothing can be missed.
	 */
	release(record: NodeRecord): void {
		this.byId.delete(record.id);
		this.byNode.delete(record.node);
		this.unbindControl(record);
		record.audio?.dispose();
		record.audio = null;
		for (const child of record.children) this.release(child);
		record.children.length = 0;
	}

	/**
	 * Called before a new session's tree is accepted. The id space starts over from scratch.
	 *
	 * This also walks nodes that are not attached. A node that has been created but not yet inserted
	 * into a parent is not reached by the walk down from the root, yet its sound can play as soon as
	 * `source` is set. Cleanup that follows only the tree would let that sound carry into the next
	 * session.
	 */
	clear(): void {
		for (const record of this.byId.values()) {
			if (record === this.root) continue;
			record.audio?.dispose();
			record.audio = null;
		}
		for (const child of this.root.children) this.release(child);
		this.root.children.length = 0;
		this.byId.clear();
		this.seen.clear();
		this.byControl.clear();
		this.byId.set(this.root.id, this.root);
	}

	/**
	 * Binds a controller to this node. If another node already uses that number, it is a contract
	 * error.
	 *
	 * The VM already rejects duplicates during render (`runtime_host_control_already_bound`), but this
	 * realm is the final authority for props as well. A silent overwrite would make commands go to
	 * whichever node's patch arrived last, and that mismatch raises no error.
	 */
	bindControl(record: NodeRecord, control: number): void {
		const existing = this.byControl.get(control);
		if (existing !== undefined && existing !== record)
			throw rendererError(
				WEB_RENDERER_ERROR_CODE.contract,
				`control ${control} is already bound to host node ${existing.id}`,
			);
		if (record.control !== null && record.control !== control)
			this.byControl.delete(record.control);
		record.control = control;
		this.byControl.set(control, record);
	}

	unbindControl(record: NodeRecord): void {
		if (record.control === null) return;
		if (this.byControl.get(record.control) === record)
			this.byControl.delete(record.control);
		record.control = null;
	}

	/** Returns the node bound to a controller number, or null. Null is not a failure here. */
	control(id: number): NodeRecord | null {
		return this.byControl.get(id) ?? null;
	}

	/** Live ids in depth-first order. Tests use this to check for leaks. */
	ids(): number[] {
		const out: number[] = [];
		const walk = (record: NodeRecord): void => {
			if (record !== this.root) out.push(record.id);
			for (const child of record.children) walk(child);
		};
		walk(this.root);
		return out;
	}
}
