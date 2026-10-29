import {
	assetPathOf,
	controlIdOf,
	handlerIdOf,
	type RuntimeCommandBatch,
	type RuntimeHostNodeKind,
	type RuntimeHostValue,
	type RuntimePatchBatch,
} from "@rowcat/runtime-host";
import {
	type TestHostNode,
	TestHostTree,
} from "@rowcat/runtime-host/testing/host-tree";
import { RUNTIME_MCP_ERROR_CODE, RuntimeMcpError } from "../errors.ts";
import { RUNTIME_MCP_LIMITS } from "../limits.ts";

/**
 * The host tree the agent reads. It is an observer, not a renderer.
 *
 * - It does not rewrite the patch applier. Rules such as revision continuity, missing nodes,
 *   reused ids, and children absent from their parent live in TestHostTree, which this class wraps.
 *   A second applier would eventually drift, and the agent would see a tree that differs from what
 *   the renderer draws. The 'Test' in the name is historical, since the first consumer was tests;
 *   the class is the protocol's reference implementation regardless. Observation must be as strict
 *   as the tests.
 * - Kinds are translated into the creator's names. The protocol says `text-input`, and the
 *   creator writes `<TextInput>`. If the tree spoke only protocol vocabulary, the agent could not
 *   connect its code to the screen. The Record<RuntimeHostNodeKind, string> type is the guard:
 *   adding a kind breaks compilation.
 * - Node numbers are tied to revisions. Host node ids increase monotonically within a session and
 *   are never reused, so an operation aimed at a removed number is rejected as stale_node instead
 *   of reaching another node. This rejection is the layer's safety. Guessing a replacement by text
 *   or position would let the agent succeed without knowing what it pressed.
 */

const COMPONENT_NAME: Readonly<Record<RuntimeHostNodeKind, string>> = {
	screen: "Screen",
	view: "View",
	stack: "Stack",
	row: "Row",
	scroll: "ScrollView",
	text: "Text",
	image: "Image",
	button: "Button",
	pressable: "Pressable",
	progress: "Progress",
	"text-input": "TextInput",
	"text-area": "TextArea",
	audio: "Audio",
	"#text": "#text",
};

/** The prop and node kind each action requires. The table itself is the policy. */
const ACTIONS = {
	press: {
		prop: "onPress",
		kinds: new Set<RuntimeHostNodeKind>(["button", "pressable"]),
	},
	input: {
		prop: "onChangeText",
		kinds: new Set<RuntimeHostNodeKind>(["text-input", "text-area"]),
	},
	submit: {
		prop: "onSubmit",
		kinds: new Set<RuntimeHostNodeKind>(["text-input"]),
	},
} as const;

export type RuntimeMcpAction = keyof typeof ACTIONS;

export interface RuntimeMcpTreeNode {
	readonly nodeId: number;
	readonly type: string;
	/**
	 * Set only when all children are text. Modeling that common shape as separate nodes would double
	 * the tree.
	 */
	readonly text?: string;
	readonly props?: Readonly<Record<string, unknown>>;
	/** Actions currently available on this node. Empty when the node is disabled. */
	readonly actions?: readonly RuntimeMcpAction[];
	readonly children?: readonly RuntimeMcpTreeNode[];
	/** Focus is currently on this node, as a result of creator code calling focus(). */
	readonly focused?: true;
}

export interface RuntimeMcpTreeSnapshot {
	readonly revision: number;
	readonly nodes: number;
	/** Whether a limit cut the response. It is never reduced silently. */
	readonly truncated: boolean;
	readonly root: RuntimeMcpTreeNode;
	/**
	 * Last scroll intent. It records intent, not pixels. The headless host has no layout, so it cannot
	 * say what pixel offset the view is at. Pretending to would produce a number unrelated to the real
	 * screen. Instead it records what creator code requested, which is the part an agent can check.
	 */
	readonly scroll?: {
		readonly nodeId: number;
		readonly to: "start" | "end" | "offset";
		readonly offset?: number;
	};
}

const clampValue = (value: RuntimeHostValue): unknown => {
	const asset = assetPathOf(value);
	if (asset !== null) return { asset };
	const json = JSON.stringify(value) ?? "null";
	if (json.length <= RUNTIME_MCP_LIMITS.treePropChars) return value;
	return `${json.slice(0, RUNTIME_MCP_LIMITS.treePropChars)}…`;
};

export class RuntimeMcpTree {
	private readonly tree = new TestHostTree();
	/**
	 * Every node number this session has ever created. This is the only basis for telling stale from
	 * nonexistent.
	 */
	private readonly everSeen = new Set<number>();
	/**
	 * Observation of control commands. This is not browser automation. The layer has no real view, so
	 * there is no scroll position and no focus ring. What can be recorded is which node the creator
	 * code asked for and which node the request reached. That is the only honest way for an agent to
	 * confirm that a press moved focus to the reply field.
	 */
	private focusedNode: number | null = null;
	private lastScroll: RuntimeMcpTreeSnapshot["scroll"] = undefined;

	get revision(): number {
		return this.tree.revision;
	}

	apply(batch: RuntimePatchBatch): void {
		this.tree.apply(batch);
		for (const patch of batch.patches)
			if (patch.op === "create") this.everSeen.add(patch.id);
		/** A removed node cannot hold focus. Real platforms behave the same way. */
		if (this.focusedNode !== null && !this.tree.has(this.focusedNode))
			this.focusedNode = null;
		if (this.lastScroll !== undefined && !this.tree.has(this.lastScroll.nodeId))
			this.lastScroll = undefined;
	}

	/**
	 * Observes a batch of control commands. It does not apply them. Target lookup follows the
	 * renderer's rule: a command carries only a controller number, and only the `controller` prop
	 * written in the tree says which node that is.
	 */
	applyCommands(batch: RuntimeCommandBatch): void {
		if (batch.revision !== this.tree.revision) return;
		for (const command of batch.commands) {
			const nodeId = this.nodeForControl(command.control);
			if (nodeId === null) continue;
			switch (command.op) {
				case "focus":
					if (this.tree.node(nodeId).props.disabled !== true)
						this.focusedNode = nodeId;
					break;
				case "blur":
					if (this.focusedNode === nodeId) this.focusedNode = null;
					break;
				case "scroll":
					this.lastScroll =
						command.to === "offset"
							? { nodeId, to: "offset", offset: command.offset }
							: { nodeId, to: command.to };
					break;
			}
		}
	}

	private nodeForControl(control: number): number | null {
		const walk = (node: TestHostNode): number | null => {
			if (controlIdOf(node.props.controller ?? null) === control)
				return node.id;
			for (const child of node.children) {
				const found = walk(child);
				if (found !== null) return found;
			}
			return null;
		};
		return walk(this.tree.root);
	}

	snapshot(): RuntimeMcpTreeSnapshot {
		let nodes = 0;
		let truncated = false;

		const walk = (node: TestHostNode, depth: number): RuntimeMcpTreeNode => {
			nodes += 1;
			const type = node.kind === "root" ? "#root" : COMPONENT_NAME[node.kind];
			const props: Record<string, unknown> = {};
			const actions: RuntimeMcpAction[] = [];
			const disabled = node.props.disabled === true;
			for (const [name, value] of Object.entries(node.props)) {
				if (handlerIdOf(value) !== null) continue;
				/**
				 * The controller number is host identity, not a creator value. Like hiding handler numbers,
				 * exposing it would lead agents to use it as an operation argument. This server has no tool for
				 * that.
				 */
				if (name === "controller" && controlIdOf(value) !== null) continue;
				props[name] = clampValue(value);
			}
			if (node.kind !== "root" && node.kind !== "#text" && !disabled)
				for (const action of Object.keys(ACTIONS) as RuntimeMcpAction[]) {
					const rule = ACTIONS[action];
					if (!rule.kinds.has(node.kind)) continue;
					if (handlerIdOf(node.props[rule.prop] ?? null) === null) continue;
					actions.push(action);
				}

			const textOnly =
				node.children.length > 0 &&
				node.children.every((child) => child.kind === "#text");
			const children: RuntimeMcpTreeNode[] = [];
			if (!textOnly)
				for (const child of node.children) {
					if (nodes >= RUNTIME_MCP_LIMITS.treeNodes) {
						truncated = true;
						break;
					}
					if (depth + 1 > RUNTIME_MCP_LIMITS.treeDepth) {
						truncated = true;
						break;
					}
					children.push(walk(child, depth + 1));
				}

			return {
				nodeId: node.id,
				type,
				...(node.kind === "#text"
					? { text: node.text ?? "" }
					: textOnly
						? {
								text: node.children.map((child) => child.text ?? "").join(""),
							}
						: {}),
				...(Object.keys(props).length > 0 ? { props } : {}),
				...(actions.length > 0 ? { actions } : {}),
				...(this.focusedNode === node.id ? { focused: true as const } : {}),
				...(children.length > 0 ? { children } : {}),
			};
		};

		const root = walk(this.tree.root, 0);
		return {
			revision: this.tree.revision,
			nodes,
			truncated,
			root,
			...(this.lastScroll === undefined ? {} : { scroll: this.lastScroll }),
		};
	}

	/**
	 * Finds the target of one operation and distinguishes missing, stale, and not interactable.
	 * Collapsing the three leaves retry as the only option, and retry fixes none of them. Stale
	 * requires re-reading the tree. Missing means the number is wrong. Not interactable means the code
	 * never attached a handler to that node.
	 */
	handlerFor(nodeId: number, action: RuntimeMcpAction): number {
		if (!this.tree.has(nodeId))
			throw this.everSeen.has(nodeId)
				? new RuntimeMcpError(
						RUNTIME_MCP_ERROR_CODE.staleNode,
						`Node ${nodeId} is not in the tree now. Read it again with preview_get_tree.`,
						{ nodeId, currentRevision: this.tree.revision },
					)
				: new RuntimeMcpError(
						RUNTIME_MCP_ERROR_CODE.nodeNotFound,
						`Node ${nodeId} was never in this session.`,
						{ nodeId, currentRevision: this.tree.revision },
					);
		const node = this.tree.node(nodeId);
		const rule = ACTIONS[action];
		if (
			node.kind === "root" ||
			node.kind === "#text" ||
			!rule.kinds.has(node.kind)
		)
			throw new RuntimeMcpError(
				RUNTIME_MCP_ERROR_CODE.nodeNotInteractable,
				`${node.kind === "root" ? "The root" : COMPONENT_NAME[node.kind]} does not support ${action}.`,
				{ nodeId, action, type: node.kind },
			);
		if (node.props.disabled === true)
			throw new RuntimeMcpError(
				RUNTIME_MCP_ERROR_CODE.nodeNotInteractable,
				`Node ${nodeId} is disabled.`,
				{ nodeId, action },
			);
		const handler = handlerIdOf(node.props[rule.prop] ?? null);
		if (handler === null)
			throw new RuntimeMcpError(
				RUNTIME_MCP_ERROR_CODE.nodeNotInteractable,
				`Node ${nodeId} has no ${rule.prop}.`,
				{ nodeId, action, prop: rule.prop },
			);
		return handler;
	}

	/** Lookup by text, so the agent can continue the next operation without re-reading the tree. */
	findByText(text: string): number | null {
		return this.tree.findByText(text)?.id ?? null;
	}
}
