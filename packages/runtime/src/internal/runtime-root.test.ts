import { afterEach, describe, expect, it } from "vitest";
import {
	Audio,
	asset,
	Button,
	Stack,
	Text,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	View,
} from "../index.ts";
import { Fragment, jsx, jsxs } from "../jsx-runtime.ts";
import type { RuntimeNode } from "../node.ts";
import { RUNTIME_ERROR_CODE, RuntimeError } from "./errors.ts";
import { type RuntimeHostPort, setRuntimeHostPort } from "./host-port.ts";
import { runtimePhase } from "./phase.ts";
import type { RuntimePatch } from "./reconciler.ts";
import {
	dispatchEvent,
	flushEffects,
	flushRender,
	mountRoot,
	type RuntimePatchBatch,
	RuntimeRoot,
	type RuntimeRootDiagnostic,
	type RuntimeRootWork,
	rootMetrics,
	unmountRoot,
} from "./runtime-root.ts";

/**
 * What the root guarantees in this realm, checked without a VM.
 *
 * The rules for the reconciler, hooks, effects and handlers are plain JavaScript, so they run here
 * without QuickJS. Values pinned here are checked again by the `@rowcat/runtime-host` tests on the
 * real VM and the compiled TSX. That path is slower, so most of the matrix lives here.
 *
 * The port is a fake: it collects batches, work requests and diagnostics in arrays. There is no
 * host scheduler, so tests call flushRender and flushEffects directly. That order is the
 * scheduler's priority rule: render before effects.
 */

interface FakePort extends RuntimeHostPort {
	batches: RuntimePatchBatch[];
	work: RuntimeRootWork[];
	diagnostics: RuntimeRootDiagnostic[];
	reject: boolean;
}

const fakePort = (): FakePort => {
	const port: FakePort = {
		batches: [],
		work: [],
		diagnostics: [],
		reject: false,
		emit(channel, json) {
			if (port.reject) return { ok: false, code: "test_reject", message: "no" };
			const value = JSON.parse(json) as unknown;
			if (channel === "commit") port.batches.push(value as RuntimePatchBatch);
			else if (channel === "schedule")
				port.work.push((value as { work: RuntimeRootWork }).work);
			else port.diagnostics.push(value as RuntimeRootDiagnostic);
			return { ok: true };
		},
	};
	return port;
};

interface Node {
	id: number;
	kind: string;
	props: Record<string, unknown>;
	text: string | null;
	children: Node[];
}

class HostTree {
	readonly nodes = new Map<number, Node>();
	readonly root: Node = {
		id: 0,
		kind: "root",
		props: {},
		text: null,
		children: [],
	};
	revision = 0;
	constructor() {
		this.nodes.set(0, this.root);
	}
	apply(batch: RuntimePatchBatch): void {
		if (batch.revision !== this.revision + 1)
			throw new Error(`revision ${batch.revision} after ${this.revision}`);
		this.revision = batch.revision;
		for (const patch of batch.patches) this.patch(patch);
	}
	private node(id: number): Node {
		const node = this.nodes.get(id);
		if (node === undefined) throw new Error(`unknown node ${id}`);
		return node;
	}
	private patch(patch: RuntimePatch): void {
		switch (patch.op) {
			case "create":
				if (this.nodes.has(patch.id)) throw new Error(`duplicate ${patch.id}`);
				this.nodes.set(patch.id, {
					id: patch.id,
					kind: patch.kind,
					props: {},
					text: null,
					children: [],
				});
				return;
			case "remove": {
				const node = this.node(patch.id);
				for (const parent of this.nodes.values()) {
					const at = parent.children.indexOf(node);
					if (at >= 0) parent.children.splice(at, 1);
				}
				const drop = (n: Node): void => {
					this.nodes.delete(n.id);
					for (const child of n.children) drop(child);
				};
				drop(node);
				return;
			}
			case "insert": {
				const parent = this.node(patch.parent);
				const child = this.node(patch.child);
				if (parent.children.includes(child))
					throw new Error("already inserted");
				parent.children.splice(patch.index, 0, child);
				return;
			}
			case "move": {
				const parent = this.node(patch.parent);
				const child = this.node(patch.child);
				const at = parent.children.indexOf(child);
				if (at < 0) throw new Error("move of absent child");
				parent.children.splice(at, 1);
				parent.children.splice(patch.index, 0, child);
				return;
			}
			case "set-prop":
				this.node(patch.id).props[patch.name] = patch.value;
				return;
			case "remove-prop":
				delete this.node(patch.id).props[patch.name];
				return;
			case "set-text":
				this.node(patch.id).text = patch.value;
				return;
		}
	}
	snapshot(node: Node = this.root): unknown {
		if (node.kind === "#text") return node.text;
		const out: Record<string, unknown> = { type: node.kind };
		if (Object.keys(node.props).length > 0) out.props = node.props;
		if (node.children.length > 0)
			out.children = node.children.map((child) => this.snapshot(child));
		return out;
	}
}

function harness(limits?: ConstructorParameters<typeof RuntimeRoot>[1]) {
	const port = fakePort();
	const tree = new HostTree();
	const root = new RuntimeRoot(port, limits);
	const applyNew = (): void => {
		while (tree.revision < port.batches.length)
			tree.apply(port.batches[tree.revision] as RuntimePatchBatch);
	};
	/**
	 * Renders run before effects, matching the host scheduler's priority. Loops until the queue is
	 * empty.
	 */
	const settle = (): void => {
		for (let guard = 0; guard < 100; guard += 1) {
			const renders = port.work.filter((w) => w === "render").length;
			const effects = port.work.filter((w) => w === "effects").length;
			port.work.length = 0;
			if (renders === 0 && effects === 0) return;
			if (renders > 0) root.flushRender();
			applyNew();
			if (effects > 0) root.flushEffects();
			applyNew();
		}
		throw new Error("did not settle");
	};
	return {
		port,
		tree,
		root,
		mount(app: unknown) {
			root.mount(app);
			applyNew();
		},
		settle,
		snapshot: () => tree.snapshot(),
		children: () => (tree.snapshot() as { children?: unknown[] }).children,
		lastBatch: () => port.batches[port.batches.length - 1] as RuntimePatchBatch,
	};
}

const text = (value: RuntimeNode) => jsx(Text, { children: value });

describe("mount and host tree", () => {
	it("function components descend into host nodes and the components themselves don't remain", () => {
		function Counter() {
			return text("0");
		}
		function Layout({ children }: { children?: RuntimeNode }) {
			return jsx(Stack, { children });
		}
		function App() {
			return jsx(Layout, { children: jsx(Counter, {}) });
		}
		const h = harness();
		h.mount(App);
		expect(h.children()).toEqual([
			{ type: "stack", children: [{ type: "text", children: ["0"] }] },
		]);
		expect(h.lastBatch().revision).toBe(1);
		expect(h.port.batches).toHaveLength(1);
	});

	it("the first commit is a patch bundle starting from an empty root: create · set-prop · insert order", () => {
		function App() {
			return jsxs(Stack, {
				gap: 12,
				children: [
					text("a"),
					jsx(Button, { onPress: () => {}, children: "b" }),
				],
			});
		}
		const h = harness();
		h.mount(App);
		const ops = h.lastBatch().patches.map((p) => p.op);
		expect(ops[0]).toBe("create");
		expect(ops).toContain("set-prop");
		expect(ops[ops.length - 1]).toBe("insert");
		/**
		 * A child is created before it is inserted into its parent, with its own children already in
		 * place.
		 */
		const created: number[] = [];
		for (const patch of h.lastBatch().patches) {
			if (patch.op === "create") created.push(patch.id);
			if (patch.op === "insert") {
				expect(created).toContain(patch.child);
				if (patch.parent !== 0) expect(created).toContain(patch.parent);
			}
			if (patch.op === "set-prop" || patch.op === "set-text")
				expect(created).toContain(patch.id);
		}
	});

	it("adjacent text and numbers are one text node", () => {
		function App() {
			return jsxs(Text, { children: ["Count: ", 0, "!"] });
		}
		const h = harness();
		h.mount(App);
		expect(h.children()).toEqual([{ type: "text", children: ["Count: 0!"] }]);
	});

	it("null, booleans and undefined do not become nodes, and arrays and Fragments are flattened", () => {
		function App() {
			return jsxs(Stack, {
				children: [
					null,
					false,
					undefined,
					[text("a"), [text("b")]],
					jsx(Fragment, { children: [text("c"), true] }),
				],
			});
		}
		const h = harness();
		h.mount(App);
		expect(
			(h.children() as { children: unknown[] }[])[0]?.children,
		).toHaveLength(3);
	});

	it("props are normalized: style objects · handler references · omitting undefined", () => {
		function App() {
			return jsx(Button, {
				onPress: () => {},
				tone: undefined,
				style: { padding: 4 },
				children: "x",
			});
		}
		const h = harness();
		h.mount(App);
		const button = (h.children() as { props: Record<string, unknown> }[])[0];
		expect(button?.props.style).toEqual({ padding: 4 });
		expect(button?.props.onPress).toEqual({ $handler: 1 });
		expect(button?.props).not.toHaveProperty("tone");
	});

	it("non-serializable props are creator errors and are not committed", () => {
		function App() {
			return jsx(View, {
				style: { bad: Symbol("x") } as never,
				children: null,
			});
		}
		const h = harness();
		expect(() => h.mount(App)).toThrow(RuntimeError);
		expect(h.port.batches).toHaveLength(0);
	});

	it("runtime_root_entry_invalid when the entry point is not a function", () => {
		const h = harness();
		expect(() => h.mount(42)).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.rootEntryInvalid }),
		);
		expect(() => h.mount(Stack)).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.rootEntryInvalid }),
		);
	});
});

describe("state and events", () => {
	function Counter() {
		const [count, setCount] = useState(0);
		return jsxs(Stack, {
			gap: 12,
			children: [
				jsx(Text, { children: `Count: ${count}` }),
				jsx(Button, {
					onPress: () => setCount((v) => v + 1),
					children: "Increment",
				}),
			],
		});
	}

	it("event → update → render → one set-text on the same node", async () => {
		const h = harness();
		h.mount(Counter);
		const before = h.lastBatch().patches.find((p) => p.op === "set-text");
		const textId = before?.op === "set-text" ? before.id : -1;
		const button = h.tree.root.children[0]?.children[1] as Node;
		const handler = (button.props.onPress as { $handler: number }).$handler;
		expect(await h.root.dispatchEvent(handler, null)).toEqual({
			handled: true,
		});
		expect(h.port.work).toEqual(["render"]);
		h.settle();
		expect(h.lastBatch().revision).toBe(2);
		/**
		 * One text change and one new handler number (arrow functions are recreated on every render). The
		 * node itself is unchanged.
		 */
		expect(
			h
				.lastBatch()
				.patches.map((p) => p.op)
				.sort(),
		).toEqual(["set-prop", "set-text"]);
		expect(h.lastBatch().patches).toContainEqual({
			op: "set-text",
			id: textId,
			value: "Count: 1",
		});
		expect(h.children()).toEqual([
			{
				type: "stack",
				props: { gap: 12 },
				children: [
					{ type: "text", children: ["Count: 1"] },
					{
						type: "button",
						props: { onPress: { $handler: expect.any(Number) } },
						children: ["Increment"],
					},
				],
			},
		]);
	});

	it("three updates in one task are one render and one commit", () => {
		let set: ((v: number) => void) | null = null;
		function App() {
			const [a, setA] = useState(0);
			set = setA;
			return text(String(a));
		}
		const h = harness();
		h.mount(App);
		(set as unknown as (v: number) => void)(1);
		(set as unknown as (v: number) => void)(2);
		(set as unknown as (v: number) => void)(3);
		expect(h.port.work).toEqual(["render"]);
		h.settle();
		expect(h.port.batches).toHaveLength(2);
		expect(h.children()).toEqual([{ type: "text", children: ["3"] }]);
		expect(h.root.metrics().componentRenders).toBe(2);
	});

	it("functional updates fold in order and the initializer runs once at mount", () => {
		let inits = 0;
		let set: ((v: (p: number) => number) => void) | null = null;
		function App() {
			const [a, setA] = useState(() => {
				inits += 1;
				return 10;
			});
			set = setA;
			return text(String(a));
		}
		const h = harness();
		h.mount(App);
		const s = set as unknown as (v: (p: number) => number) => void;
		s((v) => v + 1);
		s((v) => v * 2);
		h.settle();
		expect(h.children()).toEqual([{ type: "text", children: ["22"] }]);
		expect(inits).toBe(1);
	});

	it("the setter's identity is stable across renders, and same-value updates make no render", () => {
		const setters: unknown[] = [];
		function App() {
			const [a, setA] = useState(1);
			setters.push(setA);
			return text(String(a));
		}
		const h = harness();
		h.mount(App);
		(setters[0] as (v: number) => void)(2);
		h.settle();
		expect(setters[0]).toBe(setters[1]);
		(setters[0] as (v: (p: number) => number) => void)((v) => v);
		expect(h.port.work).toEqual([]);
		(setters[0] as (v: number) => void)(2);
		expect(h.port.work).toEqual([]);
	});

	it("updates during render are runtime_state_update_during_render and the previous commit stays", () => {
		let phase = 0;
		function App() {
			const [a, setA] = useState(0);
			if (phase === 1) setA(1);
			return text(String(a));
		}
		const h = harness();
		h.mount(App);
		phase = 1;
		expect(() => h.mount(App)).toThrowError(
			expect.objectContaining({
				code: RUNTIME_ERROR_CODE.stateUpdateDuringRender,
			}),
		);
		expect(h.port.batches).toHaveLength(1);
		expect(h.root.metrics().renderFailures).toBe(1);
	});

	it("setters of vanished components are ignored and leave one warning", () => {
		let set: ((v: number) => void) | null = null;
		function Child() {
			const [a, setA] = useState(0);
			set = setA;
			return text(String(a));
		}
		function App({ show }: { show: boolean }) {
			return show ? jsx(Child, {}) : null;
		}
		const h = harness();
		h.mount(() => jsx(App, { show: true }));
		h.mount(() => jsx(App, { show: false }));
		expect(h.children()).toBeUndefined();
		(set as unknown as (v: number) => void)(5);
		expect(h.port.work).toEqual([]);
		expect(h.port.diagnostics.map((d) => d.code)).toEqual([
			RUNTIME_ERROR_CODE.updateAfterUnmount,
		]);
		expect(h.port.diagnostics[0]?.kind).toBe("warning");
	});

	it("useReducer: three dispatches in one task are one render, applied in order", () => {
		let dispatch: ((a: number) => void) | null = null;
		function App() {
			const [state, d] = useReducer((s: number, a: number) => s + a, 0);
			dispatch = d;
			return text(String(state));
		}
		const h = harness();
		h.mount(App);
		const first = dispatch;
		(dispatch as unknown as (a: number) => void)(1);
		(dispatch as unknown as (a: number) => void)(1);
		(dispatch as unknown as (a: number) => void)(1);
		expect(h.port.work).toEqual(["render"]);
		h.settle();
		expect(h.children()).toEqual([{ type: "text", children: ["3"] }]);
		expect(dispatch).toBe(first);
		expect(h.root.metrics().componentRenders).toBe(2);
	});

	it("stale handler numbers are stale, not failures", async () => {
		let set: ((v: number) => void) | null = null;
		function App() {
			const [n, setN] = useState(0);
			set = setN;
			return jsx(Button, { onPress: () => {}, children: String(n) });
		}
		const h = harness();
		h.mount(App);
		expect(await h.root.dispatchEvent(1, null)).toEqual({ handled: true });
		(set as unknown as (v: number) => void)(1);
		h.settle();
		/**
		 * A new arrow function on every render gets a new number. The old number is released, so
		 * dispatching it returns stale.
		 */
		expect(await h.root.dispatchEvent(1, null)).toEqual({
			handled: false,
			reason: "stale",
		});
		expect(await h.root.dispatchEvent(2, null)).toEqual({ handled: true });
		expect(h.root.metrics().liveHandlers).toBe(1);
	});

	it("when a handler throws, only that event fails", async () => {
		function App() {
			return jsx(Button, {
				onPress: () => {
					throw new TypeError("boom");
				},
				children: "x",
			});
		}
		const h = harness();
		h.mount(App);
		await expect(h.root.dispatchEvent(1, null)).rejects.toThrow("boom");
		await expect(h.root.dispatchEvent(1, null)).rejects.toThrow("boom");
		expect(h.root.disposed).toBe(false);
	});

	it("the event phase is visible inside the handler and idle outside", async () => {
		let seen = "";
		function App() {
			return jsx(Button, {
				onPress: () => {
					seen = runtimePhase();
				},
				children: "x",
			});
		}
		const h = harness();
		h.mount(App);
		await h.root.dispatchEvent(1, null);
		expect(seen).toBe("event");
		expect(runtimePhase()).toBe("idle");
	});
});

describe("identity and key", () => {
	function Item({ label }: { label: string }) {
		const [n, setN] = useState(0);
		return jsx(Button, {
			onPress: () => setN((v) => v + 1),
			children: `${label}:${n}`,
		});
	}
	const bump = async (h: ReturnType<typeof harness>, index: number) => {
		const node = h.tree.root.children[0]?.children[index] as Node;
		await h.root.dispatchEvent(
			(node.props.onPress as { $handler: number }).$handler,
			null,
		);
		h.settle();
	};
	const labels = (h: ReturnType<typeof harness>) =>
		(h.tree.root.children[0] as Node).children.map((c) => c.children[0]?.text);
	const ids = (h: ReturnType<typeof harness>) =>
		(h.tree.root.children[0] as Node).children.map((c) => c.id);

	it("the same key keeps state, and reordering stable keys follows state and node ids", async () => {
		let order = ["a", "b", "c"];
		function App() {
			return jsx(Stack, {
				children: order.map((k) => jsx(Item, { label: k }, k)),
			});
		}
		const h = harness();
		h.mount(App);
		await bump(h, 0);
		expect(labels(h)).toEqual(["a:1", "b:0", "c:0"]);
		const before = ids(h);
		order = ["c", "a", "b"];
		h.mount(App);
		expect(labels(h)).toEqual(["c:0", "a:1", "b:0"]);
		expect(ids(h)).toEqual([before[2], before[0], before[1]]);
		const ops = h.lastBatch().patches.map((p) => p.op);
		expect(ops).not.toContain("create");
		expect(ops).not.toContain("remove");
		expect(ops).toContain("move");
	});

	it("a changed key unmounts the old, mounts the new and resets state", async () => {
		let key = "x";
		function App() {
			return jsx(Stack, { children: [jsx(Item, { label: "i" }, key)] });
		}
		const h = harness();
		h.mount(App);
		await bump(h, 0);
		expect(labels(h)).toEqual(["i:1"]);
		const [oldId] = ids(h);
		key = "y";
		h.mount(App);
		expect(labels(h)).toEqual(["i:0"]);
		expect(ids(h)[0]).not.toBe(oldId);
		const ops = h.lastBatch().patches.map((p) => p.op);
		expect(ops).toContain("remove");
		expect(ops).toContain("create");
	});

	it("children without keys are judged by position: the same kind at the same position keeps state, a different kind is replaced", async () => {
		let middle: "item" | "text" = "item";
		function App() {
			return jsx(Stack, {
				children: [
					jsx(Item, { label: "a" }),
					middle === "item" ? jsx(Item, { label: "b" }) : text("B"),
					jsx(Item, { label: "c" }),
				],
			});
		}
		const h = harness();
		h.mount(App);
		await bump(h, 1);
		await bump(h, 2);
		expect(labels(h)).toEqual(["a:0", "b:1", "c:1"]);
		middle = "text";
		h.mount(App);
		/**
		 * The middle one is replaced, so its state is lost. The third, with the same position and kind,
		 * keeps its state.
		 */
		expect(labels(h)).toEqual(["a:0", "B", "c:1"]);
		middle = "item";
		h.mount(App);
		expect(labels(h)).toEqual(["a:0", "b:0", "c:1"]);
	});

	it("a changed component kind is a new instance even at the same position", async () => {
		let which = 0;
		function One() {
			const [n, setN] = useState(0);
			return jsx(Button, { onPress: () => setN(n + 1), children: `one:${n}` });
		}
		function Two() {
			const [n] = useState(9);
			return jsx(Button, { onPress: () => {}, children: `two:${n}` });
		}
		function App() {
			return jsx(Stack, {
				children: [which === 0 ? jsx(One, {}) : jsx(Two, {})],
			});
		}
		const h = harness();
		h.mount(App);
		await bump(h, 0);
		expect(labels(h)).toEqual(["one:1"]);
		which = 1;
		h.mount(App);
		expect(labels(h)).toEqual(["two:9"]);
		which = 0;
		h.mount(App);
		expect(labels(h)).toEqual(["one:0"]);
	});

	it("duplicate keys are a deterministic warning and later ones are judged by position", () => {
		function App() {
			return jsx(Stack, {
				children: [
					text("a"),
					jsx(Item, { label: "1" }, "k"),
					jsx(Item, { label: "2" }, "k"),
				],
			});
		}
		const h = harness();
		h.mount(App);
		expect(labels(h)).toEqual(["a", "1:0", "2:0"]);
		expect(h.port.diagnostics.map((d) => d.code)).toEqual([
			RUNTIME_ERROR_CODE.duplicateKey,
		]);
		h.port.diagnostics.length = 0;
		h.mount(App);
		expect(h.port.diagnostics.map((d) => d.code)).toEqual([
			RUNTIME_ERROR_CODE.duplicateKey,
		]);
		/** The trailing node is also reused by position, not remounted. */
		const ops = h.lastBatch().patches.map((p) => p.op);
		expect(ops).not.toContain("create");
		expect(ops).not.toContain("remove");
	});
});

describe("hooks", () => {
	it("custom hooks use the calling component's slots as is", async () => {
		function useCounter() {
			const [count, setCount] = useState(0);
			return { count, increment: () => setCount((v) => v + 1) };
		}
		function App() {
			const counter = useCounter();
			return jsx(Button, {
				onPress: counter.increment,
				children: String(counter.count),
			});
		}
		const h = harness();
		h.mount(App);
		await h.root.dispatchEvent(1, null);
		h.settle();
		expect(h.children()).toEqual([
			{ type: "button", props: { onPress: { $handler: 2 } }, children: ["1"] },
		]);
	});

	it("a changed hook count is runtime_hook_order_changed; the first render passes", () => {
		let enabled = false;
		function App() {
			if (enabled) useState(0);
			return text("hi");
		}
		const h = harness();
		h.mount(App);
		enabled = true;
		expect(() => h.mount(App)).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.hookOrderChanged }),
		);
		expect(h.port.batches).toHaveLength(1);
	});

	it("a changed hook kind at the same position throws rather than being reinterpreted", () => {
		let kind = "ref";
		function App() {
			if (kind === "ref") useRef(1);
			else useMemo(() => 1, []);
			return text("x");
		}
		const h = harness();
		h.mount(App);
		kind = "memo";
		expect(() => h.mount(App)).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.hookOrderChanged }),
		);
	});

	it("useMemo and useCallback do not recompute with the same deps and keep their identity", () => {
		let dep = 1;
		let computed = 0;
		const callbacks: unknown[] = [];
		function App() {
			const value = useMemo(() => {
				computed += 1;
				return dep * 10;
			}, [dep]);
			const cb = useCallback(() => value, [dep]);
			callbacks.push(cb);
			return text(String(value));
		}
		const h = harness();
		h.mount(App);
		h.mount(App);
		expect(computed).toBe(1);
		expect(callbacks[0]).toBe(callbacks[1]);
		dep = 2;
		h.mount(App);
		expect(computed).toBe(2);
		expect(callbacks[2]).not.toBe(callbacks[1]);
		expect(h.children()).toEqual([{ type: "text", children: ["20"] }]);
	});

	it("useMemo without deps runs every render; with an empty array, once at mount", () => {
		let every = 0;
		let once = 0;
		function App() {
			useMemo(() => {
				every += 1;
				return 0;
			}, undefined);
			useMemo(() => {
				once += 1;
				return 0;
			}, []);
			return null;
		}
		const h = harness();
		h.mount(App);
		h.mount(App);
		h.mount(App);
		expect(every).toBe(3);
		expect(once).toBe(1);
	});

	it("useRef is the same object and changing current makes no render", () => {
		const refs: unknown[] = [];
		function App() {
			const ref = useRef(0);
			refs.push(ref);
			ref.current += 1;
			return text("x");
		}
		const h = harness();
		h.mount(App);
		h.mount(App);
		expect(refs[0]).toBe(refs[1]);
		expect((refs[0] as { current: number }).current).toBe(2);
		expect(h.port.work).toEqual([]);
	});

	it("calling a hook outside render is runtime_hook_outside_render", () => {
		expect(() => useState(0)).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.hookOutsideRender }),
		);
	});
});

describe("effects", () => {
	it("effects run in the effects task after the commit, and setState inside is the next render task", () => {
		const log: string[] = [];
		function App() {
			const [ready, setReady] = useState(false);
			useEffect(() => {
				log.push(`effect:${ready}`);
				if (!ready) setReady(true);
				return () => log.push(`cleanup:${ready}`);
			}, [ready]);
			return text(ready ? "ready" : "loading");
		}
		const h = harness();
		h.mount(App);
		/** The commit went out first. Effects have not run yet. */
		expect(h.port.batches).toHaveLength(1);
		expect(log).toEqual([]);
		expect(h.port.work).toEqual(["effects"]);
		h.settle();
		expect(log).toEqual(["effect:false", "cleanup:false", "effect:true"]);
		expect(h.children()).toEqual([{ type: "text", children: ["ready"] }]);
		expect(h.port.batches).toHaveLength(2);
	});

	it("the same deps do not rerun; changed deps run cleanup → effect", () => {
		const log: string[] = [];
		let dep = 1;
		function App() {
			const current = dep;
			useEffect(() => {
				log.push(`run:${current}`);
				return () => log.push(`clean:${current}`);
			}, [current]);
			return text(String(current));
		}
		const h = harness();
		h.mount(App);
		h.settle();
		h.mount(App);
		h.settle();
		expect(log).toEqual(["run:1"]);
		dep = 2;
		h.mount(App);
		h.settle();
		expect(log).toEqual(["run:1", "clean:1", "run:2"]);
	});

	it("effects without deps run every commit; empty deps run only at mount", () => {
		let every = 0;
		let once = 0;
		function App() {
			useEffect(() => {
				every += 1;
			});
			useEffect(() => {
				once += 1;
			}, []);
			return text("x");
		}
		const h = harness();
		h.mount(App);
		h.settle();
		h.mount(App);
		h.settle();
		expect(every).toBe(2);
		expect(once).toBe(1);
	});

	it("unmount runs cleanups, and root disposal runs live cleanups exactly once", () => {
		const log: string[] = [];
		function Child({ id }: { id: string }) {
			useEffect(() => () => log.push(`clean:${id}`), []);
			return text(id);
		}
		let show = true;
		function App() {
			return jsx(Stack, {
				children: [
					jsx(Child, { id: "a" }),
					show ? jsx(Child, { id: "b" }) : null,
				],
			});
		}
		const h = harness();
		h.mount(App);
		h.settle();
		show = false;
		h.mount(App);
		h.settle();
		expect(log).toEqual(["clean:b"]);
		expect(h.root.dispose().cleanups).toBe(1);
		expect(log).toEqual(["clean:b", "clean:a"]);
		expect(h.root.dispose().cleanups).toBe(0);
		h.tree.apply(h.lastBatch());
		expect(h.children()).toBeUndefined();
		expect(h.root.metrics().liveHandlers).toBe(0);
	});

	it("effect exceptions remain as diagnostics, and other effects and the session live", () => {
		let ran = false;
		function App() {
			useEffect(() => {
				throw new Error("effect boom");
			}, []);
			useEffect(() => {
				ran = true;
			}, []);
			return text("x");
		}
		const h = harness();
		h.mount(App);
		h.settle();
		expect(ran).toBe(true);
		expect(h.port.diagnostics.map((d) => [d.code, d.kind])).toEqual([
			[RUNTIME_ERROR_CODE.effectFailed, "creator"],
		]);
		h.mount(App);
		h.settle();
		expect(h.port.diagnostics).toHaveLength(1);
	});

	it("a cleanup exception does not block the remaining cleanups", () => {
		const log: string[] = [];
		function A() {
			useEffect(
				() => () => {
					throw new Error("cleanup boom");
				},
				[],
			);
			return null;
		}
		function B() {
			useEffect(() => () => log.push("b"), []);
			return null;
		}
		const h = harness();
		h.mount(() => jsxs(Fragment, { children: [jsx(A, {}), jsx(B, {})] }));
		h.settle();
		h.root.dispose();
		expect(log).toEqual(["b"]);
		expect(h.port.diagnostics.map((d) => d.code)).toEqual([
			RUNTIME_ERROR_CODE.effectFailed,
		]);
	});

	it("an effect returning a promise is a warning and is not read as cleanup", () => {
		function App() {
			useEffect(() => Promise.resolve() as unknown as undefined, []);
			return null;
		}
		const h = harness();
		h.mount(App);
		h.settle();
		expect(h.port.diagnostics.map((d) => d.code)).toEqual([
			RUNTIME_ERROR_CODE.effectReturnedPromise,
		]);
		expect(h.root.dispose().cleanups).toBe(0);
	});
});

describe("atomicity and limits", () => {
	it("when render throws no bundle goes out and the previous tree and state stay", () => {
		let fail = false;
		let set: ((v: number) => void) | null = null;
		function App() {
			const [n, setN] = useState(1);
			set = setN;
			if (fail) throw new Error("render boom");
			return text(String(n));
		}
		const h = harness();
		h.mount(App);
		fail = true;
		(set as unknown as (v: number) => void)(2);
		expect(() => h.root.flushRender()).toThrow("render boom");
		expect(h.port.batches).toHaveLength(1);
		fail = false;
		/** A failed render does not consume the queue. The next render folds the same update. */
		(set as unknown as (v: number) => void)(2);
		h.settle();
		expect(h.children()).toEqual([{ type: "text", children: ["2"] }]);
	});

	it("when the first render throws the committed tree is empty", () => {
		function App(): RuntimeNode {
			throw new Error("first boom");
		}
		const h = harness();
		expect(() => h.mount(App)).toThrow("first boom");
		expect(h.port.batches).toHaveLength(0);
		expect(h.root.metrics().hostNodes).toBe(0);
	});

	it("creator errors carry a component stack", () => {
		function Leaf(): RuntimeNode {
			throw new TypeError("leaf");
		}
		function Panel() {
			return jsx(Leaf, {});
		}
		function App() {
			return jsx(Panel, {});
		}
		const h = harness();
		let caught: unknown;
		try {
			h.mount(App);
		} catch (error) {
			caught = error;
		}
		expect((caught as Record<string, unknown>).rowcatComponentStack).toBe(
			"App > Panel > Leaf",
		);
	});

	it("when the host refuses a bundle the plan is dropped and handler numbers do not leak", () => {
		let n = 0;
		function App() {
			return jsx(Button, { onPress: () => n, children: String(n) });
		}
		const h = harness();
		h.mount(App);
		h.port.reject = true;
		n = 1;
		expect(() => h.mount(App)).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.commitRejected }),
		);
		h.port.reject = false;
		expect(h.root.metrics().liveHandlers).toBe(1);
		expect(h.root.metrics().revision).toBe(1);
	});

	it("async components are runtime_async_component_unsupported", () => {
		async function App() {
			return text("x");
		}
		const h = harness();
		expect(() => h.mount(App)).toThrowError(
			expect.objectContaining({
				code: RUNTIME_ERROR_CODE.asyncComponentUnsupported,
			}),
		);
	});

	it("values that cannot be placed in the tree are runtime_invalid_runtime_node", () => {
		function App() {
			return { not: "an element" } as unknown as RuntimeNode;
		}
		const h = harness();
		expect(() => h.mount(App)).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.invalidRuntimeNode }),
		);
	});

	it("a deep tree fails structurally at the limit", () => {
		function Deep({ n }: { n: number }): RuntimeNode {
			return n === 0
				? text("leaf")
				: jsx(View, { children: jsx(Deep, { n: n - 1 }) });
		}
		const h = harness({ maxTreeDepth: 20 });
		expect(() => h.mount(() => jsx(Deep, { n: 500 }))).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.treeDepthExceeded }),
		);
		expect(h.port.batches).toHaveLength(0);
		h.mount(() => jsx(Deep, { n: 3 }));
		expect(h.port.batches).toHaveLength(1);
	});

	it("a huge tree fails at the node limit", () => {
		function App() {
			return jsx(Stack, {
				children: Array.from({ length: 100 }, (_, i) => text(String(i))),
			});
		}
		const h = harness({ maxHostNodes: 50 });
		expect(() => h.mount(App)).toThrowError(
			expect.objectContaining({
				code: RUNTIME_ERROR_CODE.hostNodeLimitExceeded,
			}),
		);
	});

	it("commits past the patch limit are dropped and the handler numbers gained are released", () => {
		function App() {
			return jsx(Stack, {
				children: Array.from({ length: 10 }, (_, i) =>
					jsx(Button, { onPress: () => i, children: "b" }),
				),
			});
		}
		const h = harness({ maxPatchesPerCommit: 5 });
		expect(() => h.mount(App)).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.patchLimitExceeded }),
		);
		expect(h.root.metrics().liveHandlers).toBe(0);
	});

	it("a render with no change emits no bundle", () => {
		function App() {
			return jsx(Stack, {
				gap: 1,
				style: { padding: 2 },
				children: [text("a"), jsx(View, { children: null })],
			});
		}
		const h = harness();
		h.mount(App);
		h.mount(App);
		expect(h.port.batches).toHaveLength(1);
		expect(h.root.metrics().commits).toBe(2);
	});

	it("props, text, inserts and removes emit only targeted patches", () => {
		let n = 0;
		function App() {
			return jsxs(Stack, {
				gap: n,
				children: [
					text(`t${n}`),
					n === 1 ? jsx(View, { children: null }) : null,
					jsx(Button, {
						onPress: () => {},
						tone: n === 0 ? "primary" : undefined,
						children: "b",
					}),
				],
			});
		}
		const h = harness();
		h.mount(App);
		n = 1;
		h.mount(App);
		const ops = h
			.lastBatch()
			.patches.map((p) => p.op)
			.sort();
		expect(ops).toEqual([
			"create",
			"insert",
			"remove-prop",
			"set-prop",
			"set-prop",
			"set-text",
		]);
		n = 2;
		h.mount(App);
		expect(
			h
				.lastBatch()
				.patches.map((p) => p.op)
				.sort(),
		).toEqual(["remove", "set-prop", "set-prop", "set-text"]);
		expect(
			(h.children() as { children: unknown[] }[])[0]?.children,
		).toHaveLength(2);
	});

	it("handler numbers stay the same for the same function, and after 10,000 renders one live number remains", () => {
		let n = 0;
		function App() {
			return jsx(Button, { onPress: () => n, children: "b" });
		}
		const h = harness();
		h.mount(App);
		for (let i = 0; i < 10_000; i += 1) {
			n = i;
			h.mount(App);
		}
		expect(h.root.metrics().liveHandlers).toBe(1);
		/** Numbers only increase. They are never reused. */
		const button = h.tree.root.children[0] as Node;
		expect((button.props.onPress as { $handler: number }).$handler).toBe(
			10_001,
		);
	});
});

describe("module-level API: one active root per session", () => {
	afterEach(() => {
		unmountRoot();
		setRuntimeHostPort(null);
	});

	it("without a port, mount throws with runtime_host_port_missing", () => {
		expect(() => mountRoot(() => null)).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.hostPortMissing }),
		);
	});

	it("mount → flushRender → flushEffects → dispatchEvent → unmount runs on one root", async () => {
		const port = fakePort();
		setRuntimeHostPort(port);
		function App() {
			const [n, setN] = useState(0);
			useEffect(() => {}, []);
			return jsx(Button, { onPress: () => setN(n + 1), children: String(n) });
		}
		expect(mountRoot(App, JSON.stringify({ maxHostNodes: 10 }))).toEqual({
			revision: 1,
		});
		expect(port.work).toEqual(["effects"]);
		expect(flushEffects()).toEqual({ cleanups: 0, effects: 1 });
		expect(flushRender()).toEqual({ rendered: false, revision: 1 });
		expect(await dispatchEvent(1, null)).toEqual({ handled: true });
		expect(flushRender()).toEqual({ rendered: true, revision: 2 });
		expect(rootMetrics()?.revision).toBe(2);
		expect(unmountRoot().revision).toBe(3);
		expect(rootMetrics()).toBeNull();
		expect(await dispatchEvent(1, null)).toEqual({
			handled: false,
			reason: "no-root",
		});
	});

	it("swapping the root is an ordinary reconcile, and mounting after disposal is a new root", () => {
		const port = fakePort();
		setRuntimeHostPort(port);
		const A = () => text("a");
		const B = () => text("b");
		mountRoot(A);
		mountRoot(B);
		/** `<Text>b</Text>` is two nodes: the Text and its string. */
		expect(port.batches[1]?.patches.map((p) => p.op)).toEqual([
			"remove",
			"create",
			"create",
			"set-text",
			"insert",
			"insert",
		]);
		unmountRoot();
		expect(mountRoot(A)).toEqual({ revision: 1 });
	});
});

describe("Audio", () => {
	it("asset references and playback state ride on the host node", () => {
		function App() {
			return jsx(Audio, {
				source: asset("audio/bgm/main"),
				playing: true,
				loop: true,
				volume: 0.6,
			});
		}
		const h = harness();
		h.mount(App);
		expect(h.children()).toEqual([
			{
				type: "audio",
				props: {
					source: { $asset: "audio/bgm/main" },
					playing: true,
					loop: true,
					volume: 0.6,
				},
			},
		]);
	});

	/** Handlers cross the boundary as numbers. The creator's function stays inside the VM. */
	it("onEnded becomes a handler number", () => {
		function App() {
			return jsx(Audio, {
				source: asset("audio/sfx/click"),
				onEnded: () => {},
			});
		}
		const h = harness();
		h.mount(App);
		const node = (h.children() as { props: Record<string, unknown> }[])[0];
		expect(node?.props.onEnded).toEqual({ $handler: expect.any(Number) });
	});

	describe("values the type cannot stop", () => {
		/**
		 * `volume?: number` accepts 5 as well. If that value reached the renderer, each platform would
		 * clamp it on its own, and the same code would sound different on each device.
		 *
		 * Rejecting it inside the VM keeps that divergence from ever appearing. The creator gets an error
		 * for their own code.
		 */
		it("refuses out-of-range volume rather than folding it", () => {
			function App() {
				return jsx(Audio, {
					source: asset("audio/bgm/main"),
					volume: 5 as number,
				});
			}
			const h = harness();
			expect(() => h.mount(App)).toThrow(RuntimeError);
			try {
				h.mount(App);
			} catch (error) {
				expect((error as RuntimeError).code).toBe(
					RUNTIME_ERROR_CODE.invalidHostProp,
				);
			}
		});

		it("refuses NaN volume too", () => {
			function App() {
				return jsx(Audio, {
					source: asset("audio/bgm/main"),
					volume: Number.NaN,
				});
			}
			expect(() => harness().mount(App)).toThrow(RuntimeError);
		});

		it("accepts the boundary values 0 and 1", () => {
			function App() {
				return jsxs(Stack, {
					children: [
						jsx(Audio, { source: asset("audio/a"), volume: 0 }),
						jsx(Audio, { source: asset("audio/b"), volume: 1 }),
					],
				});
			}
			expect(() => harness().mount(App)).not.toThrow();
		});

		it("restartKey must be a string or a number", () => {
			function App() {
				return jsx(Audio, {
					source: asset("audio/bgm/main"),
					restartKey: { nope: true } as unknown as string,
				});
			}
			expect(() => harness().mount(App)).toThrow(RuntimeError);
		});
	});

	/**
	 * Audio plays sound; it does not contain content. Silently placing children elsewhere would make
	 * the screen differ from the creator's code. Dropping them would lose the content without a word.
	 */
	it("holds no children", () => {
		function App() {
			return jsx(Audio, {
				source: asset("audio/bgm/main"),
				children: "hello",
			} as never);
		}
		const h = harness();
		expect(() => h.mount(App)).toThrow(RuntimeError);
	});
});
