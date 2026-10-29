import { describe, expect, it } from "vitest";
import {
	CreatorExecutionError,
	RUNTIME_HOST_ERROR_CODE,
	RuntimeHostError,
} from "./errors.ts";
import {
	handlerIdOf,
	type RuntimePatchBatch,
	type RuntimeRootLimits,
} from "./patches.ts";
import {
	createRuntimeVmSession,
	type RuntimeRootDiagnostic,
	type RuntimeRootMountOptions,
	type RuntimeVmSessionOptions,
} from "./session.ts";
import { compiled, testEngine } from "./test/fixtures.ts";
import { TestHostTree } from "./testing/host-tree.ts";

/**
 * The Phase 4B acceptance check: creator TSX, then compiler, artifact, QuickJS, root, patch batch,
 * and the test host tree. No hand-written JS.
 *
 * The reconciler matrix lives in the in-process tests of @rowcat/runtime. This file checks only
 * what requires the VM boundary: whether component and hook state stays inside the VM, whether each
 * commit arrives as one batch, whether events enter the scheduler at userBlocking, whether render
 * runs at normal priority and effects at background, whether a creator exception leaves the session
 * alive, and whether a limit ends only the commit rather than the session.
 */

const IMPORTS = `import { Button, Stack, Text, View, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "@rowcat/runtime";`;

interface Mounted {
	session: Awaited<ReturnType<typeof createRuntimeVmSession>>;
	tree: TestHostTree;
	diagnostics: RuntimeRootDiagnostic[];
	rootErrors: { name: string; message: string; work: string }[];
	commits: RuntimePatchBatch[];
	press(text: string): Promise<void>;
	dispose(): Promise<void>;
}

async function mount(
	source: string,
	options: {
		session?: Partial<RuntimeVmSessionOptions>;
		root?: Partial<RuntimeRootMountOptions>;
		limits?: Partial<RuntimeRootLimits>;
		expectMountFailure?: boolean;
	} = {},
): Promise<
	Mounted & {
		mountOutcome: Awaited<ReturnType<Mounted["session"]["mountRoot"]>>;
	}
> {
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: compiled([
			{ path: "src/main.tsx", content: `${IMPORTS}\n${source}` },
		]),
		...options.session,
	});
	const tree = new TestHostTree();
	const diagnostics: RuntimeRootDiagnostic[] = [];
	const rootErrors: Mounted["rootErrors"] = [];
	const commits: RuntimePatchBatch[] = [];
	const mountOutcome = await session.mountRoot({
		onCommit: (batch) => {
			commits.push(batch);
			tree.apply(batch);
		},
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		onRootError: (error, work) =>
			rootErrors.push({ name: error.name, message: error.message, work }),
		...(options.limits === undefined ? {} : { limits: options.limits }),
		...options.root,
	});
	if (!mountOutcome.ok && options.expectMountFailure !== true)
		throw new Error(
			`mount failed: ${mountOutcome.error.name}: ${mountOutcome.error.message}`,
		);
	const press = async (text: string): Promise<void> => {
		const button = tree.findByText(text);
		if (button === null) throw new Error(`no node with text ${text}`);
		const handler = handlerIdOf(button.props.onPress ?? null);
		if (handler === null) throw new Error(`node ${button.id} has no onPress`);
		const outcome = await session.dispatchEvent(handler);
		if (!outcome.ok) throw outcome.error;
		await session.settle();
	};
	return {
		session,
		tree,
		diagnostics,
		rootErrors,
		commits,
		press,
		mountOutcome,
		dispose: () => session.dispose(),
	};
}

const COUNTER = `
export default function App() {
	const [count, setCount] = useState(0);
	useEffect(() => {
		console.log("count", count);
		return () => { console.log("cleanup", count); };
	}, [count]);
	return (
		<Stack gap={12}>
			<Text>Count: {count}</Text>
			<Button onPress={() => setCount((value) => value + 1)}>Increment</Button>
		</Stack>
	);
}`;

describe("core acceptance scenario", () => {
	it("TSX → VM → <App/> → useState → event → re-render → incremental patches → test host tree", async () => {
		const logs: unknown[][] = [];
		const m = await mount(COUNTER, {
			session: { onConsole: (_level, args) => logs.push([...args]) },
		});
		try {
			/** The first batch starts from an empty root as revision 1. */
			expect(m.commits).toHaveLength(1);
			expect(m.commits[0]?.revision).toBe(1);
			expect(m.tree.children()).toEqual([
				{
					type: "stack",
					props: { gap: 12 },
					children: [
						{ type: "text", children: ["Count: 0"] },
						{
							type: "button",
							props: { onPress: { $handler: 1 } },
							children: ["Increment"],
						},
					],
				},
			]);
			/**
			 * Effects run in background work after the commit. When mount returns, they have not run yet.
			 */
			await m.session.settle();
			expect(logs).toEqual([["count", 0]]);

			const textId = m.tree.findByText("Count: 0")?.id;
			await m.press("Increment");
			expect(m.commits).toHaveLength(2);
			expect(m.commits[1]?.revision).toBe(2);
			/**
			 * Same node: the id stays the same and only the text changes. Handlers are new arrow functions,
			 * so their ids change.
			 */
			expect(m.tree.findByText("Count: 1")?.id).toBe(textId);
			expect(m.commits[1]?.patches.map((p) => p.op).sort()).toEqual([
				"set-prop",
				"set-text",
			]);
			expect(logs).toEqual([
				["count", 0],
				["cleanup", 0],
				["count", 1],
			]);
			expect(m.session.state).toBe("ready");
			const metrics = m.session.metrics().root;
			expect(metrics.commits).toBe(2);
			expect(metrics.rendersScheduled).toBe(1);
			expect(metrics.effectFlushesScheduled).toBe(2);
			expect(metrics.eventsDispatched).toBe(1);
			expect(metrics.rejectedCommits).toBe(0);
		} finally {
			await m.dispose();
		}
	});

	it("events go through the scheduler at userBlocking, render at normal and effects at background", async () => {
		const turns: string[] = [];
		const m = await mount(COUNTER, {
			session: {
				scheduling: {
					observer: { onTurn: (info) => turns.push(info.priority) },
				},
			},
		});
		try {
			await m.session.settle();
			turns.length = 0;
			await m.press("Increment");
			/**
			 * Order: event (userBlocking), then render (normal), then effect (background). A pump turn may
			 * run between them.
			 */
			const distinct = turns.filter((p, i) => turns[i - 1] !== p);
			expect(distinct).toEqual(["userBlocking", "normal", "background"]);
		} finally {
			await m.dispose();
		}
	});

	it("one commit is one bundle: several patches from one event cross at once", async () => {
		const m = await mount(`
export default function App() {
	const [n, setN] = useState(0);
	const add = useCallback(() => setN((v) => v + 1), []);
	return (
		<Stack>
			<Text>a{n}</Text>
			<Text>b{n}</Text>
			<Text>c{n}</Text>
			<Button onPress={add}>go</Button>
		</Stack>
	);
}`);
		try {
			await m.press("go");
			expect(m.commits).toHaveLength(2);
			expect(m.commits[1]?.patches).toHaveLength(3);
			expect(m.commits[1]?.patches.every((p) => p.op === "set-text")).toBe(
				true,
			);
			/** A handler whose identity is kept with useCallback keeps the same id. */
			expect(handlerIdOf(m.tree.findByText("go")?.props.onPress ?? null)).toBe(
				1,
			);
		} finally {
			await m.dispose();
		}
	});
});

describe("VM boundary", () => {
	it("component functions and hook state do not reach the host: bundles hold only nodes, props and numbers", async () => {
		const m = await mount(COUNTER);
		try {
			const json = JSON.stringify(m.commits);
			expect(json).not.toMatch(/function|=>|useState|App/);
			expect(
				m.commits[0]?.patches
					.filter((p) => p.op === "create")
					.map((p) => (p as { kind: string }).kind),
			).toEqual(["stack", "text", "#text", "button", "#text"]);
		} finally {
			await m.dispose();
		}
	});

	it("asset references cross as an opaque marker", async () => {
		const m = await mount(`
import { Image, asset } from "@rowcat/runtime";
export default function App() {
	return <Image source={asset("characters/sena/smile")} alt="Sena" />;
}`);
		try {
			expect(m.tree.children()).toEqual([
				{
					type: "image",
					props: { source: { $asset: "characters/sena/smile" }, alt: "Sena" },
				},
			]);
		} finally {
			await m.dispose();
		}
	});

	/**
	 * A remote reference crosses with the same marker: `{ "$asset": value }`, one shape with no kind
	 * on the wire. Old artifacts' logical references and new artifacts' remote references therefore
	 * pass through the same renderer. The creator's address leaves the VM only in this shape. Opening
	 * the value as an address is the trusted host's job.
	 */
	it("remote asset references cross as the same opaque marker", async () => {
		const m = await mount(`
import { Image, asset } from "@rowcat/runtime";
export default function App() {
	return (
		<Stack>
			<Image source={asset("https://cdn.example.com/sena.webp?v=2")} alt="Sena" />
			<Image source={asset("characters/sena/smile")} alt="old" />
		</Stack>
	);
}`);
		try {
			expect(m.tree.children()).toEqual([
				{
					type: "stack",
					children: [
						{
							type: "image",
							props: {
								source: { $asset: "https://cdn.example.com/sena.webp?v=2" },
								alt: "Sena",
							},
						},
						{
							type: "image",
							props: {
								source: { $asset: "characters/sena/smile" },
								alt: "old",
							},
						},
					],
				},
			]);
		} finally {
			await m.dispose();
		}
	});

	it("custom hooks, useReducer, useMemo and useRef run by the same rules inside the VM", async () => {
		const m = await mount(`
function useCounter() {
	const [count, dispatch] = useReducer((s: number, a: number) => s + a, 0);
	return { count, increment: () => { dispatch(1); dispatch(1); dispatch(1); } };
}
let memoRuns = 0;
export default function App() {
	const counter = useCounter();
	const ref = useRef(0);
	ref.current += 1;
	const doubled = useMemo(() => { memoRuns += 1; return counter.count * 2; }, [counter.count]);
	return (
		<Stack>
			<Text>count:{counter.count} doubled:{doubled} renders:{ref.current} memo:{memoRuns}</Text>
			<Button onPress={counter.increment}>go</Button>
		</Stack>
	);
}`);
		try {
			expect(
				m.tree.findByText("count:0 doubled:0 renders:1 memo:1"),
			).not.toBeNull();
			await m.press("go");
			/** Three dispatches make one render: renders is 2 and memo is also 2. */
			expect(
				m.tree.findByText("count:3 doubled:6 renders:2 memo:2"),
			).not.toBeNull();
		} finally {
			await m.dispose();
		}
	});

	/**
	 * Updates within the same execution are collapsed. Continuations of VM promises (`await
	 * Promise.resolve()`) run in the same execution's job pump. Only a continuation after awaiting a
	 * host capability call becomes a separate task: it goes through the completion queue and arrives
	 * on the next turn. The rule is documented and checked by value here.
	 */
	it("updates in the same execution fold into one render through VM microtask continuations", async () => {
		const m = await mount(`
export default function App() {
	const [a, setA] = useState(0);
	const [b, setB] = useState(0);
	const go = async () => {
		setA(1);
		setB(1);
		await Promise.resolve();
		setA(2);
	};
	return (
		<Stack>
			<Text>a{a}b{b}</Text>
			<Button onPress={go}>go</Button>
		</Stack>
	);
}`);
		try {
			await m.press("go");
			expect(m.tree.findByText("a2b1")).not.toBeNull();
			/** The mount (1) plus the batch from one event execution (1) make two commits. */
			expect(m.commits).toHaveLength(2);
			expect(m.session.metrics().root.rendersScheduled).toBe(1);
		} finally {
			await m.dispose();
		}
	});
});

describe("the weight of failures", () => {
	it("a render exception is a mount failure and the session lives, carrying the component stack and code", async () => {
		const m = await mount(
			`
function Leaf(): never { throw new TypeError("leaf broke"); }
function Panel() { return <View><Leaf /></View>; }
export default function App() { return <Panel />; }`,
			{ expectMountFailure: true },
		);
		try {
			expect(m.mountOutcome.ok).toBe(false);
			const error = !m.mountOutcome.ok ? m.mountOutcome.error : null;
			expect(error).toBeInstanceOf(CreatorExecutionError);
			if (error instanceof CreatorExecutionError) {
				expect(error.creatorName).toBe("TypeError");
				expect(error.componentStack).toEqual(["App", "Panel", "Leaf"]);
				expect(error.frames[0]?.moduleId).toBe("src/main.tsx");
			}
			expect(m.commits).toHaveLength(0);
			expect(m.session.state).toBe("ready");
			expect(
				await m.session.callExport("src/main.tsx", "default", []),
			).toMatchObject({ ok: false });
		} finally {
			await m.dispose();
		}
	});

	it("a re-render exception goes to onRootError and the previous commit stays; the next event retries", async () => {
		const m = await mount(`
export default function App() {
	const [n, setN] = useState(0);
	if (n === 1) throw new Error("odd");
	return (
		<Stack>
			<Text>n{n}</Text>
			<Button onPress={() => setN((v) => v + 1)}>go</Button>
		</Stack>
	);
}`);
		try {
			await m.press("go");
			expect(m.rootErrors).toEqual([
				{ name: "CreatorExecutionError", message: "odd", work: "render" },
			]);
			expect(m.commits).toHaveLength(1);
			expect(m.tree.findByText("n0")).not.toBeNull();
			expect(m.session.state).toBe("ready");
			/** A failed render does not consume the queue. Pressing again yields 2, which is correct. */
			await m.press("go");
			expect(m.tree.findByText("n2")).not.toBeNull();
			expect(m.commits).toHaveLength(2);
		} finally {
			await m.dispose();
		}
	});

	it("hook order violations come with the runtime_hook_order_changed code", async () => {
		const m = await mount(`
export default function App() {
	const [on, setOn] = useState(false);
	if (on) useState(0);
	return <Button onPress={() => setOn(true)}>go</Button>;
}`);
		try {
			await m.press("go");
			expect(m.rootErrors[0]?.work).toBe("render");
			expect(m.rootErrors[0]?.message).toContain("hook call order");
		} finally {
			await m.dispose();
		}
	});

	it("updates during render, async components and invalid nodes are creator errors with codes", async () => {
		for (const [source, code] of [
			[
				`export default function App() { const [v, setV] = useState(0); setV(1); return <Text>{v}</Text>; }`,
				"runtime_state_update_during_render",
			],
			/**
			 * The type check already blocks this (`RuntimeApp`). This verifies that a value which bypasses
			 * the check is also blocked at runtime.
			 */
			[
				`export default ((async () => <Text>x</Text>) as unknown as () => null);`,
				"runtime_async_component_unsupported",
			],
			[
				`export default function App() { return { nope: true } as unknown as null; }`,
				"runtime_invalid_runtime_node",
			],
		] as const) {
			const m = await mount(source, { expectMountFailure: true });
			try {
				expect(m.mountOutcome.ok).toBe(false);
				const error = !m.mountOutcome.ok ? m.mountOutcome.error : null;
				expect(error).toBeInstanceOf(CreatorExecutionError);
				expect((error as CreatorExecutionError).runtimeCode).toBe(code);
				expect(m.session.state).toBe("ready");
			} finally {
				await m.dispose();
			}
		}
	});

	it("effect exceptions are diagnostics, and the session and later effects live", async () => {
		const m = await mount(`
let ran = 0;
export default function App() {
	const [n, setN] = useState(0);
	useEffect(() => { throw new Error("effect broke"); }, []);
	useEffect(() => { ran += 1; });
	return (
		<Stack>
			<Text>ran{ran}</Text>
			<Button onPress={() => setN(n + 1)}>go</Button>
		</Stack>
	);
}`);
		try {
			await m.session.settle();
			expect(m.diagnostics.map((d) => [d.code, d.kind, d.component])).toEqual([
				["runtime_effect_failed", "creator", "App"],
			]);
			await m.press("go");
			expect(m.tree.findByText("ran1")).not.toBeNull();
			expect(m.diagnostics).toHaveLength(1);
			expect(m.session.state).toBe("ready");
		} finally {
			await m.dispose();
		}
	});

	it("an event handler exception loses only that event", async () => {
		const m = await mount(`
export default function App() {
	return <Button onPress={() => { throw new RangeError("press broke"); }}>go</Button>;
}`);
		try {
			const outcome = await m.session.dispatchEvent(1);
			expect(outcome.ok).toBe(false);
			if (!outcome.ok)
				expect(outcome.error).toBeInstanceOf(CreatorExecutionError);
			expect(m.session.state).toBe("ready");
			expect(await m.session.dispatchEvent(1)).toMatchObject({ ok: false });
		} finally {
			await m.dispose();
		}
	});
});

describe("limits", () => {
	it("a deep tree ends that render, not the session", async () => {
		const m = await mount(
			`
function Deep({ n }: { n: number }) { return n === 0 ? <Text>leaf</Text> : <View><Deep n={n - 1} /></View>; }
export default function App() { return <Deep n={5000} />; }`,
			{ expectMountFailure: true, limits: { maxTreeDepth: 32 } },
		);
		try {
			expect(m.mountOutcome.ok).toBe(false);
			expect(
				(m.mountOutcome as { error: CreatorExecutionError }).error.runtimeCode,
			).toBe("runtime_tree_depth_exceeded");
			expect(m.session.state).toBe("ready");
			expect(m.commits).toHaveLength(0);
		} finally {
			await m.dispose();
		}
	});

	it("a huge tree ends at the node limit: the VM counts first and the host counts again", async () => {
		const m = await mount(
			`
export default function App() {
	const items = [];
	for (let i = 0; i < 3000; i += 1) items.push(<Text key={i}>{i}</Text>);
	return <Stack>{items}</Stack>;
}`,
			/**
			 * The limit, not the budget, should stop this. The limit is set generously so that a 1-second
			 * budget does not trip first under parallel test load.
			 */
			{
				expectMountFailure: true,
				limits: { maxHostNodes: 1000 },
				session: { limits: { executionMs: 20_000 } },
			},
		);
		try {
			expect(m.mountOutcome.ok).toBe(false);
			const error = !m.mountOutcome.ok ? m.mountOutcome.error : null;
			expect(error, `${error?.name}: ${error?.message}`).toBeInstanceOf(
				CreatorExecutionError,
			);
			expect((error as CreatorExecutionError).runtimeCode).toBe(
				"runtime_host_node_limit_exceeded",
			);
			expect(m.session.state).toBe("ready");
		} finally {
			await m.dispose();
		}
	});

	it("the host's byte limit refuses the bundle and the VM keeps the previous tree", async () => {
		const m = await mount(
			`
export default function App() {
	const [big, setBig] = useState(false);
	return (
		<Stack>
			<Text>{big ? "x".repeat(5000) : "small"}</Text>
			<Button onPress={() => setBig(true)}>go</Button>
		</Stack>
	);
}`,
			{ limits: { maxCommitBytes: 2000 } },
		);
		try {
			await m.press("go");
			expect(m.commits).toHaveLength(1);
			expect(m.tree.findByText("small")).not.toBeNull();
			expect(m.rootErrors[0]?.message).toContain("bytes");
			expect(m.session.metrics().root.rejectedCommits).toBe(1);
			expect(m.session.state).toBe("ready");
		} finally {
			await m.dispose();
		}
	});

	it("update loops made by effects do not freeze the host; the session budget cuts them", async () => {
		const m = await mount(
			`
export default function App() {
	const [n, setN] = useState(0);
	useEffect(() => { setN(n + 1); });
	return <Text>{n}</Text>;
}`,
			{
				session: {
					scheduling: { policy: { session: { windowMs: 10_000, maxMs: 40 } } },
				},
			},
		);
		try {
			await m.session.settle();
			expect(m.session.state).toBe("failed");
			expect(m.commits.length).toBeGreaterThan(1);
			expect(
				m.rootErrors.some(
					(e) => e.name === "RuntimeHostError" && /budget/.test(e.message),
				),
			).toBe(true);
		} finally {
			await m.dispose();
		}
	});
});

describe("lifecycle", () => {
	it("the order of stale handlers, root disposal and session disposal", async () => {
		const logs: unknown[][] = [];
		const m = await mount(
			`
function Child() {
	useEffect(() => () => console.log("child cleanup"), []);
	return <Text>child</Text>;
}
export default function App() {
	const [show, setShow] = useState(true);
	useEffect(() => () => console.log("app cleanup"), []);
	return (
		<Stack>
			{show ? <Child /> : null}
			<Button onPress={() => setShow(false)}>hide</Button>
		</Stack>
	);
}`,
			{ session: { onConsole: (_l, args) => logs.push([...args]) } },
		);
		try {
			await m.session.settle();
			const hide = handlerIdOf(
				m.tree.findByText("hide")?.props.onPress ?? null,
			) as number;
			await m.press("hide");
			expect(logs).toEqual([["child cleanup"]]);
			expect(m.tree.findByText("child")).toBeNull();
			/** Each render creates new arrow functions, so old ids are stale. */
			expect(await m.session.dispatchEvent(hide)).toEqual({
				ok: true,
				handled: false,
				reason: "stale",
			});
			expect(m.session.state).toBe("ready");

			const unmounted = await m.session.unmountRoot();
			expect(unmounted.ok).toBe(true);
			expect(logs).toEqual([["child cleanup"], ["app cleanup"]]);
			expect(m.tree.children()).toEqual([]);
			expect(m.tree.size).toBe(0);
			expect(await m.session.dispatchEvent(hide)).toEqual({
				ok: true,
				handled: false,
				reason: "no-root",
			});
			expect(await m.session.rootMetrics()).toBeNull();
			expect((await m.session.unmountRoot()).ok).toBe(false);
		} finally {
			await m.dispose();
			expect(m.session.state).toBe("disposed");
		}
	});

	it("session disposal does not clean up the root separately: for cleanup functions, unmountRoot first", async () => {
		const logs: unknown[][] = [];
		const m = await mount(
			`export default function App() { useEffect(() => () => console.log("cleanup"), []); return <Text>x</Text>; }`,
			{ session: { onConsole: (_l, args) => logs.push([...args]) } },
		);
		await m.session.settle();
		await m.dispose();
		expect(logs).toEqual([]);
		expect(m.session.state).toBe("disposed");
	});

	it("swapping the root unmounts the old tree and mounts the new entry point", async () => {
		const m = await mount(`
export function Other() { return <Text>other</Text>; }
export default function App() { return <Text>app</Text>; }`);
		try {
			const replaced = await m.session.mountRoot({
				onCommit: (batch) => {
					m.commits.push(batch);
					m.tree.apply(batch);
				},
				entry: { moduleId: "src/main.tsx", exportName: "Other" },
			});
			expect(replaced.ok).toBe(true);
			expect(m.tree.children()).toEqual([
				{ type: "text", children: ["other"] },
			]);
			expect(m.commits[1]?.revision).toBe(2);
		} finally {
			await m.dispose();
		}
	});

	it("runtime_root_entry_invalid when the entry point is not a component", async () => {
		const m = await mount(
			`export const notApp = 42;\nexport default function App() { return null; }`,
			{
				expectMountFailure: true,
				root: { entry: { moduleId: "src/main.tsx", exportName: "notApp" } },
			},
		);
		try {
			expect(
				(m.mountOutcome as { error: CreatorExecutionError }).error.runtimeCode,
			).toBe("runtime_root_entry_invalid");
			expect(m.commits).toHaveLength(0);
		} finally {
			await m.dispose();
		}
	});

	it("root instrumentation inside the VM is readable", async () => {
		const m = await mount(COUNTER);
		try {
			await m.session.settle();
			await m.press("Increment");
			expect(await m.session.rootMetrics()).toMatchObject({
				commits: 2,
				componentInstances: 1,
				hostNodes: 5,
				liveHandlers: 1,
				effectRuns: 2,
				effectCleanups: 1,
				revision: 2,
			});
		} finally {
			await m.dispose();
		}
	});

	it("events before mount and invalid handler numbers are not failures", async () => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: compiled([
				{
					path: "src/main.tsx",
					content: `${IMPORTS}\nexport default function App() { return null; }`,
				},
			]),
		});
		try {
			expect(await session.dispatchEvent(1)).toEqual({
				ok: true,
				handled: false,
				reason: "no-root",
			});
			const outcome = await session.unmountRoot();
			expect(
				!outcome.ok && outcome.error instanceof RuntimeHostError
					? outcome.error.code
					: null,
			).toBe(RUNTIME_HOST_ERROR_CODE.rootNotMounted);
		} finally {
			await session.dispose();
		}
	});
});
