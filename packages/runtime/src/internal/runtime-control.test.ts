import { describe, expect, it } from "vitest";
import {
	Button,
	ScrollView,
	Stack,
	Text,
	TextArea,
	TextInput,
	useEffect,
	useScrollController,
	useState,
	useTextEntryController,
	View,
} from "../index.ts";
import { jsx, jsxs } from "../jsx-runtime.ts";
import type { RuntimeHostCommand } from "./control.ts";
import { RUNTIME_ERROR_CODE } from "./errors.ts";
import type { RuntimeHostPort } from "./host-port.ts";
import type { HostValue } from "./host-props.ts";
import type { RuntimePatch } from "./reconciler.ts";
import {
	type RuntimeCommandBatch,
	type RuntimePatchBatch,
	RuntimeRoot,
	type RuntimeRootDiagnostic,
	type RuntimeRootWork,
} from "./runtime-root.ts";

/**
 * What controllers and control commands guarantee in this realm.
 *
 * Three things are pinned here by value:
 * - Attachment rules: one prop, one controller per node, and the kind must match.
 * - Call site: commands are not sent during render.
 * - Order: a command goes out after the commit its own execution produced.
 *
 * The last is the whole promise of this slice. Neither the host nor the renderer creates that
 * order. It is created here and carried through unchanged.
 */

interface FakePort extends RuntimeHostPort {
	batches: RuntimePatchBatch[];
	commands: RuntimeCommandBatch[];
	work: RuntimeRootWork[];
	diagnostics: RuntimeRootDiagnostic[];
	/**
	 * The order in which channels were emitted. This is where the before and after of commit and
	 * commands are checked by value.
	 */
	channels: string[];
}

const fakePort = (): FakePort => {
	const port: FakePort = {
		batches: [],
		commands: [],
		work: [],
		diagnostics: [],
		channels: [],
		emit(channel, json) {
			const value = JSON.parse(json) as unknown;
			port.channels.push(channel);
			if (channel === "commit") port.batches.push(value as RuntimePatchBatch);
			else if (channel === "commands")
				port.commands.push(value as RuntimeCommandBatch);
			else if (channel === "schedule")
				port.work.push((value as { work: RuntimeRootWork }).work);
			else if (channel === "diagnostic")
				port.diagnostics.push(value as RuntimeRootDiagnostic);
			return { ok: true };
		},
	};
	return port;
};

/** Minimal host node: kind and props. Child order is not this file's concern. */
interface Node {
	id: number;
	kind: string;
	props: Record<string, HostValue>;
}

class Tree {
	readonly nodes = new Map<number, Node>();
	revision = 0;
	apply(batch: RuntimePatchBatch): void {
		this.revision = batch.revision;
		for (const patch of batch.patches) this.patch(patch);
	}
	private patch(patch: RuntimePatch): void {
		switch (patch.op) {
			case "create":
				this.nodes.set(patch.id, { id: patch.id, kind: patch.kind, props: {} });
				return;
			case "remove":
				this.nodes.delete(patch.id);
				return;
			case "set-prop": {
				const node = this.nodes.get(patch.id);
				if (node !== undefined) node.props[patch.name] = patch.value;
				return;
			}
			case "remove-prop": {
				const node = this.nodes.get(patch.id);
				if (node !== undefined) delete node.props[patch.name];
				return;
			}
			default:
				return;
		}
	}
	byKind(kind: string): Node[] {
		return [...this.nodes.values()].filter((node) => node.kind === kind);
	}
}

function harness(limits?: ConstructorParameters<typeof RuntimeRoot>[1]) {
	const port = fakePort();
	const tree = new Tree();
	const root = new RuntimeRoot(port, limits);
	const applyNew = (): void => {
		while (tree.revision < port.batches.length)
			tree.apply(port.batches[tree.revision] as RuntimePatchBatch);
	};
	/**
	 * Host scheduler stand-in. Runs requested work in the order render, then commands, then effects.
	 *
	 * The order is this harness's choice, and that is the point. Running in the opposite order should
	 * give the same result. The 'yields' test below checks that separately.
	 */
	const settle = (): void => {
		for (let guard = 0; guard < 50; guard += 1) {
			const work = [...port.work];
			port.work.length = 0;
			if (work.length === 0) return;
			if (work.includes("render")) {
				root.flushRender();
				applyNew();
			}
			if (work.includes("commands")) root.flushCommands();
			if (work.includes("effects")) root.flushEffects();
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
			settle();
		},
		settle,
		press(kind = "button") {
			return this.pressAt(0, kind);
		},
		/**
		 * Presses one control at that index. The handler number is read again on every press.
		 *
		 * An inline arrow function gets a new identity on every render, so it is issued a new number. If
		 * the number were fixed up front, the second press would pass silently as `handled: false,
		 * stale`. A test that checks 'no command went out' would then verify nothing.
		 */
		pressAt(index: number, kind = "button") {
			const node = tree.byKind(kind)[index];
			if (node === undefined) throw new Error(`no ${kind} node at ${index}`);
			const handler = node.props.onPress as { $handler: number };
			return root.dispatchEvent(handler.$handler, null).then((result) => {
				expect(result).toEqual({ handled: true });
				applyNew();
				settle();
				applyNew();
			});
		},
	};
}

const controlOf = (node: Node): number =>
	(node.props.controller as { $control: number }).$control;

describe("controller binding rules", () => {
	it("controller goes out as an ordinary prop value: no new patch operation", () => {
		const h = harness();
		h.mount(function App() {
			const scroll = useScrollController();
			return jsx(ScrollView, { controller: scroll, children: "hi" });
		});
		const scroll = h.tree.byKind("scroll")[0] as Node;
		expect(controlOf(scroll)).toBeTypeOf("number");
		expect(controlOf(scroll)).toBeGreaterThan(0);
		/** The protocol gained no operations. The vocabulary is still seven. */
		const ops = new Set(
			(h.port.batches[0] as RuntimePatchBatch).patches.map((p) => p.op),
		);
		for (const op of ops)
			expect(["create", "insert", "set-prop", "set-text"]).toContain(op);
	});

	it("binds to text input too", () => {
		const h = harness();
		h.mount(function App() {
			const entry = useTextEntryController();
			const area = useTextEntryController();
			return jsxs(Stack, {
				children: [
					jsx(TextInput, { controller: entry, value: "" }),
					jsx(TextArea, { controller: area, value: "" }),
				],
			});
		});
		expect(controlOf(h.tree.byKind("text-input")[0] as Node)).toBeTypeOf(
			"number",
		);
		expect(controlOf(h.tree.byKind("text-area")[0] as Node)).toBeTypeOf(
			"number",
		);
	});

	it("when the kind mismatches, that render is refused", () => {
		const h = harness();
		expect(() =>
			h.mount(function App() {
				const scroll = useScrollController();
				return jsx(View, {
					controller: scroll,
				} as unknown as Record<string, unknown>);
			}),
		).toThrowError(
			expect.objectContaining({
				code: RUNTIME_ERROR_CODE.hostControlWrongKind,
			}),
		);
	});

	it("binding a scroll controller to text input is refused", () => {
		const h = harness();
		expect(() =>
			h.mount(function App() {
				const scroll = useScrollController();
				return jsx(TextInput, {
					value: "",
					controller: scroll,
				} as unknown as Record<string, unknown>);
			}),
		).toThrowError(
			expect.objectContaining({
				code: RUNTIME_ERROR_CODE.hostControlWrongKind,
			}),
		);
	});

	it("putting a non-controller into controller is refused", () => {
		const h = harness();
		expect(() =>
			h.mount(function App() {
				return jsx(ScrollView, {
					controller: 7,
				} as unknown as Record<string, unknown>);
			}),
		).toThrowError(
			expect.objectContaining({
				code: RUNTIME_ERROR_CODE.hostControlWrongKind,
			}),
		);
	});

	it("binding the same controller to two nodes refuses that render", () => {
		const h = harness();
		expect(() =>
			h.mount(function App() {
				const scroll = useScrollController();
				return jsxs(Stack, {
					children: [
						jsx(ScrollView, { controller: scroll, children: "a" }),
						jsx(ScrollView, { controller: scroll, children: "b" }),
					],
				});
			}),
		).toThrowError(
			expect.objectContaining({
				code: RUNTIME_ERROR_CODE.hostControlAlreadyBound,
			}),
		);
	});

	it("a controller inside a style is refused, not quietly turned into {}", () => {
		const h = harness();
		expect(() =>
			h.mount(function App() {
				const scroll = useScrollController();
				return jsx(ScrollView, {
					style: { padding: scroll },
				} as unknown as Record<string, unknown>);
			}),
		).toThrowError(
			expect.objectContaining({ code: RUNTIME_ERROR_CODE.invalidHostProp }),
		);
	});
});

/**
 * An app that grows a list by one item and scrolls to the end. This is the canonical scenario for
 * this slice.
 */
function GrowingList() {
	const scroll = useScrollController();
	const [rows, setRows] = useState<string[]>(["A"]);
	return jsxs(Stack, {
		children: [
			jsx(ScrollView, {
				controller: scroll,
				children: rows.map((row) => jsx(Text, { children: row }, row)),
			}),
			jsx(Button, {
				onPress: () => {
					setRows((current) => [...current, `Row ${current.length}`]);
					scroll.scrollToEnd();
				},
				children: "Add",
			}),
		],
	});
}

describe("command order", () => {
	it("scrollToEnd after appending goes out **after the commit** and targets the same revision", async () => {
		const h = harness();
		h.mount(GrowingList);
		const before = h.port.batches.length;
		await h.press();
		expect(h.port.batches.length).toBe(before + 1);
		expect(h.port.commands).toHaveLength(1);
		const batch = h.port.commands[0] as RuntimeCommandBatch;
		expect(batch.commands).toEqual([
			{ op: "scroll", control: expect.any(Number), to: "end" },
		]);
		/** The command targets the tree after it has grown. */
		expect(batch.revision).toBe(h.tree.revision);
		/** The commit for that revision went out first. */
		const commit = h.port.channels.lastIndexOf("commit");
		const commands = h.port.channels.lastIndexOf("commands");
		expect(commit).toBeLessThan(commands);
	});

	it("commands that change no state become one commands task at the current revision", async () => {
		const h = harness();
		h.mount(function App() {
			const scroll = useScrollController();
			return jsxs(Stack, {
				children: [
					jsx(ScrollView, { controller: scroll, children: "x" }),
					jsx(Button, {
						onPress: () => scroll.scrollToStart(),
						children: "Top",
					}),
				],
			});
		});
		const revision = h.tree.revision;
		const commits = h.port.batches.length;
		await h.press();
		/** No extra commits: a command does not trigger a render. */
		expect(h.port.batches.length).toBe(commits);
		expect(h.port.commands).toHaveLength(1);
		expect((h.port.commands[0] as RuntimeCommandBatch).revision).toBe(revision);
	});

	it("flushCommands yields when a render is scheduled, regardless of scheduler order", async () => {
		const h = harness();
		const port = h.port;
		h.mount(GrowingList);
		const node = h.tree.byKind("button")[0] as Node;
		const handler = node.props.onPress as { $handler: number };
		await h.root.dispatchEvent(handler.$handler, null);
		/** Suppose the scheduler runs commands first. The commands yield to the pending render. */
		expect(port.work).toContain("render");
		h.root.flushCommands();
		expect(port.commands).toHaveLength(0);
		/** A render runs first, and the command goes out after the commit from the same run. */
		h.root.flushRender();
		expect(port.commands).toHaveLength(1);
		expect(port.channels.lastIndexOf("commit")).toBeLessThan(
			port.channels.lastIndexOf("commands"),
		);
	});

	it("several commands in the same execution go out in one bundle in written order", async () => {
		const h = harness();
		h.mount(function App() {
			const scroll = useScrollController();
			const entry = useTextEntryController();
			return jsxs(Stack, {
				children: [
					jsx(ScrollView, { controller: scroll, children: "x" }),
					jsx(TextInput, { controller: entry, value: "" }),
					jsx(Button, {
						onPress: () => {
							scroll.scrollToStart();
							scroll.scrollTo({ offset: 40 });
							entry.focus();
							entry.blur();
							scroll.scrollToEnd();
						},
						children: "Go",
					}),
				],
			});
		});
		await h.press();
		const batch = h.port.commands[0] as RuntimeCommandBatch;
		expect(
			batch.commands.map(
				(command) => `${command.op}:${"to" in command ? command.to : ""}`,
			),
		).toEqual([
			"scroll:start",
			"scroll:offset",
			"focus:",
			"blur:",
			"scroll:end",
		]);
	});

	it("commands inside effects do not call render: dep-less effects do not become a loop", () => {
		const h = harness();
		let effects = 0;
		h.mount(function App() {
			const scroll = useScrollController();
			useEffect(() => {
				effects += 1;
				scroll.scrollToEnd();
			});
			return jsx(ScrollView, { controller: scroll, children: "x" });
		});
		expect(effects).toBe(1);
		expect(h.port.commands).toHaveLength(1);
		h.settle();
		expect(effects).toBe(1);
	});
});

describe("where they are called", () => {
	it("commands during render are refused", () => {
		const h = harness();
		expect(() =>
			h.mount(function App() {
				const scroll = useScrollController();
				scroll.scrollToEnd();
				return jsx(ScrollView, { controller: scroll, children: "x" });
			}),
		).toThrowError(
			expect.objectContaining({
				code: RUNTIME_ERROR_CODE.hostCommandInvalidPhase,
			}),
		);
	});

	it("focus during render is refused too", () => {
		const h = harness();
		expect(() =>
			h.mount(function App() {
				const entry = useTextEntryController();
				entry.focus();
				return jsx(TextInput, { controller: entry, value: "" });
			}),
		).toThrowError(
			expect.objectContaining({
				code: RUNTIME_ERROR_CODE.hostCommandInvalidPhase,
			}),
		);
	});

	it.each([
		["negative", -1],
		["NaN", Number.NaN],
		["infinite", Number.POSITIVE_INFINITY],
	])("scrollTo is refused when offset is %s", async (_label, offset) => {
		const h = harness();
		h.mount(function App() {
			const scroll = useScrollController();
			return jsxs(Stack, {
				children: [
					jsx(ScrollView, { controller: scroll, children: "x" }),
					jsx(Button, {
						onPress: () => scroll.scrollTo({ offset }),
						children: "Go",
					}),
				],
			});
		});
		const node = h.tree.byKind("button")[0] as Node;
		const handler = node.props.onPress as { $handler: number };
		await expect(
			h.root.dispatchEvent(handler.$handler, null),
		).rejects.toMatchObject({
			code: RUNTIME_ERROR_CODE.scrollInvalidOffset,
		});
		expect(h.port.commands).toHaveLength(0);
	});

	it("there is a cap on commands sent at once", async () => {
		const h = harness({ maxCommandsPerFlush: 3 });
		h.mount(function App() {
			const scroll = useScrollController();
			return jsxs(Stack, {
				children: [
					jsx(ScrollView, { controller: scroll, children: "x" }),
					jsx(Button, {
						onPress: () => {
							for (let index = 0; index < 10; index += 1) scroll.scrollToEnd();
						},
						children: "Spam",
					}),
				],
			});
		});
		const node = h.tree.byKind("button")[0] as Node;
		const handler = node.props.onPress as { $handler: number };
		await expect(
			h.root.dispatchEvent(handler.$handler, null),
		).rejects.toMatchObject({
			code: RUNTIME_ERROR_CODE.hostCommandLimitExceeded,
		});
	});
});

describe("unbound controllers", () => {
	it("not yet drawn, it leaves one warning and drops the command", async () => {
		const h = harness();
		h.mount(function App() {
			const entry = useTextEntryController();
			const [open, setOpen] = useState(false);
			return jsxs(Stack, {
				children: [
					open ? jsx(TextInput, { controller: entry, value: "" }) : null,
					jsx(Button, { onPress: () => entry.focus(), children: "Focus" }),
					jsx(Button, { onPress: () => setOpen(true), children: "Open" }),
				],
			});
		});
		await h.press();
		expect(h.port.commands).toHaveLength(0);
		expect(h.port.diagnostics.map((d) => d.code)).toContain(
			RUNTIME_ERROR_CODE.hostControlUnbound,
		);
		expect(
			h.port.diagnostics.find(
				(d) => d.code === RUNTIME_ERROR_CODE.hostControlUnbound,
			)?.kind,
		).toBe("warning");
	});

	it("commands after it vanished are dropped too: a stale controller cannot point at a new node", async () => {
		const h = harness();
		h.mount(function App() {
			const entry = useTextEntryController();
			const [open, setOpen] = useState(true);
			return jsxs(Stack, {
				children: [
					open ? jsx(TextInput, { controller: entry, value: "" }) : null,
					jsx(Button, {
						onPress: () => {
							setOpen(false);
						},
						children: "Close",
					}),
					jsx(Button, { onPress: () => entry.focus(), children: "Focus" }),
				],
			});
		});
		await h.pressAt(0);
		expect(h.tree.byKind("text-input")).toHaveLength(0);
		h.port.commands.length = 0;
		await h.pressAt(1);
		expect(h.port.commands).toHaveLength(0);
		expect(h.port.diagnostics.map((d) => d.code)).toContain(
			RUNTIME_ERROR_CODE.hostControlUnbound,
		);
	});

	it("it binds again when redrawn", async () => {
		const h = harness();
		h.mount(function App() {
			const entry = useTextEntryController();
			const [open, setOpen] = useState(false);
			return jsxs(Stack, {
				children: [
					open ? jsx(TextInput, { controller: entry, value: "" }) : null,
					jsx(Button, {
						onPress: () => {
							setOpen(true);
						},
						children: "Open",
					}),
					jsx(Button, { onPress: () => entry.focus(), children: "Focus" }),
				],
			});
		});
		await h.pressAt(0);
		expect(h.tree.byKind("text-input")).toHaveLength(1);
		await h.pressAt(1);
		const commands = h.port.commands.flatMap((batch) => batch.commands);
		expect(commands.map((command: RuntimeHostCommand) => command.op)).toEqual([
			"focus",
		]);
	});

	it("a reorder does not break binding: the controller prop does not go out again", async () => {
		const h = harness();
		h.mount(function App() {
			const scroll = useScrollController();
			const [flipped, setFlipped] = useState(false);
			const rows = flipped ? ["b", "a"] : ["a", "b"];
			return jsxs(Stack, {
				children: [
					...rows.map((row) =>
						row === "a"
							? jsx(ScrollView, { controller: scroll, children: "A" }, "a")
							: jsx(Text, { children: "B" }, "b"),
					),
					jsx(Button, {
						onPress: () => {
							setFlipped(true);
							scroll.scrollToEnd();
						},
						children: "Flip",
					}),
				],
			});
		});
		const control = controlOf(h.tree.byKind("scroll")[0] as Node);
		await h.press();
		const moved = (h.port.batches.at(-1) as RuntimePatchBatch).patches;
		expect(moved.some((patch) => patch.op === "move")).toBe(true);
		expect(
			moved.some(
				(patch) => patch.op === "set-prop" && patch.name === "controller",
			),
		).toBe(false);
		expect(
			(h.port.commands[0] as RuntimeCommandBatch).commands[0]?.control,
		).toBe(control);
	});
});
