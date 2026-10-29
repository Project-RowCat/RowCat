import { describe, expect, it } from "vitest";
import {
	CreatorExecutionError,
	RUNTIME_HOST_ERROR_CODE,
	RuntimeHostError,
} from "./errors.ts";
import { handlerIdOf, type RuntimePatchBatch } from "./patches.ts";
import {
	createRuntimeVmSession,
	type RuntimeRootDiagnostic,
	type RuntimeVmSession,
} from "./session.ts";
import {
	canonicalStoryStateSnapshot,
	DEFAULT_STORY_STATE_LIMITS,
	emptyStoryStateSnapshot,
	type RuntimeStoryStateSnapshot,
	RuntimeStoryStateStore,
	validateStoryStateSnapshot,
} from "./story-state.ts";
import { compiled, testEngine } from "./test/fixtures.ts";
import { TestHostTree } from "./testing/host-tree.ts";

/**
 * Acceptance check for Phase 6A across the full path: creator TSX → compiler → artifact → QuickJS →
 * saved snapshot.
 *
 * These claims need the VM boundary, so the test does not call internal classes directly. It checks
 * that definitions register during module evaluation, that the registry is sealed before the first
 * render, that migration runs inside QuickJS, that progress continues after the VM is discarded and
 * recreated, and that a failed render does not advance the snapshot.
 */

const IMPORTS = `import { Button, Stack, Text, defineStoryState, useCallback, useEffect, useState, useStoryState } from "@rowcat/runtime";`;

interface Mounted {
	session: RuntimeVmSession;
	tree: TestHostTree;
	commits: RuntimePatchBatch[];
	diagnostics: RuntimeRootDiagnostic[];
	rootErrors: { code: string | null; work: string }[];
	storySnapshots: RuntimeStoryStateSnapshot[];
	press(text: string): Promise<void>;
	dispose(): Promise<void>;
}

async function mount(
	source: string,
	storyState?: unknown,
	options: { expectMountFailure?: boolean } = {},
): Promise<Mounted> {
	const storySnapshots: RuntimeStoryStateSnapshot[] = [];
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: compiled([
			{ path: "src/main.tsx", content: `${IMPORTS}\n${source}` },
		]),
		...(storyState === undefined ? {} : { storyState }),
		onStoryStateCommit: (snapshot) => storySnapshots.push(snapshot),
	});
	const tree = new TestHostTree();
	const commits: RuntimePatchBatch[] = [];
	const diagnostics: RuntimeRootDiagnostic[] = [];
	const rootErrors: Mounted["rootErrors"] = [];
	const mounted = await session.mountRoot({
		onCommit: (batch) => {
			commits.push(batch);
			tree.apply(batch);
		},
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		onRootError: (error, work) =>
			rootErrors.push({
				code:
					error instanceof CreatorExecutionError
						? error.runtimeCode
						: error.code,
				work,
			}),
	});
	if (!mounted.ok && options.expectMountFailure !== true)
		throw new Error(`mount failed: ${mounted.error.message}`);
	if (!mounted.ok)
		rootErrors.push({
			code:
				mounted.error instanceof CreatorExecutionError
					? mounted.error.runtimeCode
					: mounted.error.code,
			work: "mount",
		});
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
		commits,
		diagnostics,
		rootErrors,
		storySnapshots,
		press,
		dispose: () => session.dispose(),
	};
}

/** Scenario where session creation must fail. The failure surfaces before the first render. */
async function expectBootFailure(
	source: string,
	storyState?: unknown,
): Promise<RuntimeHostError> {
	try {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: compiled([
				{ path: "src/main.tsx", content: `${IMPORTS}\n${source}` },
			]),
			...(storyState === undefined ? {} : { storyState }),
		});
		await session.dispose();
		throw new Error("session was created but should not have been");
	} catch (error) {
		if (!(error instanceof RuntimeHostError)) throw error;
		return error;
	}
}

const runtimeCodeOf = (error: RuntimeHostError): string | null => {
	const cause = error.cause;
	return cause instanceof CreatorExecutionError ? cause.runtimeCode : null;
};

const snapshot = (
	entries: readonly { key: string; version: number; value: unknown }[],
): RuntimeStoryStateSnapshot =>
	canonicalStoryStateSnapshot(
		entries as readonly {
			key: string;
			version: number;
			value: never;
		}[],
	);

const CENTRAL = `
const game = defineStoryState({ key: "game", version: 1, initial: { trust: 40 } });

export default function App() {
	const [local, setLocal] = useState(0);
	const [story, setStory] = useStoryState(game);
	return (
		<Stack>
			<Text>Local: {local}</Text>
			<Text>Trust: {story.trust}</Text>
			<Button onPress={() => { setLocal((x) => x + 1); setStory((c) => ({ ...c, trust: c.trust + 10 })); }}>Continue</Button>
		</Stack>
	);
}`;

describe("the central invariant: progress continues even when the VM is thrown away", () => {
	it("useState starts over; useStoryState continues from the snapshot", async () => {
		const first = await mount(CENTRAL);
		let exported: RuntimeStoryStateSnapshot;
		try {
			expect(first.tree.findByText("Local: 0")).not.toBeNull();
			expect(first.tree.findByText("Trust: 40")).not.toBeNull();

			await first.press("Continue");
			expect(first.tree.findByText("Local: 1")).not.toBeNull();
			expect(first.tree.findByText("Trust: 50")).not.toBeNull();

			exported = first.session.storyStateSnapshot();
			expect(exported).toEqual({
				formatVersion: 1,
				entries: [{ key: "game", version: 1, value: { trust: 50 } }],
			});
		} finally {
			await first.dispose();
		}

		const second = await mount(CENTRAL, exported);
		try {
			expect(second.tree.findByText("Local: 0")).not.toBeNull();
			expect(second.tree.findByText("Trust: 50")).not.toBeNull();
		} finally {
			await second.dispose();
		}
	});

	/**
	 * Hook state belongs to the VM and is not part of the storage format. Only explicit stored state
	 * crosses over.
	 */
	it("the snapshot holds no hook state", async () => {
		const m = await mount(CENTRAL);
		try {
			await m.press("Continue");
			const json = JSON.stringify(m.session.storyStateSnapshot());
			expect(json).not.toContain("local");
			expect(json).toBe(
				'{"formatVersion":1,"entries":[{"key":"game","version":1,"value":{"trust":50}}]}',
			);
		} finally {
			await m.dispose();
		}
	});
});

describe("hydration", () => {
	it("without an entry it is initial, and that value does not pollute the definition", async () => {
		const m = await mount(`
const game = defineStoryState({ key: "game", version: 1, initial: { list: [1] } });
export default function App() {
	const [story, setStory] = useStoryState(game);
	return (
		<Stack>
			<Text>N: {story.list.length}</Text>
			<Button onPress={() => setStory((c) => ({ list: [...c.list, 2] }))}>Add</Button>
		</Stack>
	);
}`);
		try {
			expect(m.tree.findByText("N: 1")).not.toBeNull();
			await m.press("Add");
			expect(m.tree.findByText("N: 2")).not.toBeNull();
			expect(m.session.storyStateSnapshot().entries[0]?.value).toEqual({
				list: [1, 2],
			});
		} finally {
			await m.dispose();
		}
	});

	/**
	 * Hydration re-applies all definitions on top of `restore(saved)`. Counting overwrite keys as new
	 * entries made works whose definitions exceeded half the entry limit fail to reopen once a save
	 * existed. An overwrite key is not a new entry.
	 */
	it("stands again from the save even when definitions exceed half the limit: an overwritten key is not a new entry", async () => {
		const count = Math.floor(DEFAULT_STORY_STATE_LIMITS.maxEntries / 2) + 6;
		const definitions = Array.from(
			{ length: count },
			(_, index) =>
				`const d${index} = defineStoryState({ key: "k${index}", version: 1, initial: ${index} });`,
		).join("\n");
		const source = `${definitions}
export default function App() {
	const [first] = useStoryState(d0);
	return <Text>First: {first}</Text>;
}`;
		const first = await mount(source);
		const saved = first.session.storyStateSnapshot();
		await first.dispose();
		expect(saved.entries).toHaveLength(count);

		const second = await mount(source, saved);
		try {
			expect(second.tree.findByText("First: 0")).not.toBeNull();
			expect(second.session.storyStateSnapshot().entries).toHaveLength(count);
		} finally {
			await second.dispose();
		}
	});

	it("with the same version it uses the saved value as is and runs no migration", async () => {
		const m = await mount(
			`
const game = defineStoryState({
	key: "game",
	version: 2,
	initial: { trust: 0 },
	migrate: () => { throw new Error("must not run"); },
});
export default function App() {
	const [story] = useStoryState(game);
	return <Text>Trust: {story.trust}</Text>;
}`,
			snapshot([{ key: "game", version: 2, value: { trust: 77 } }]),
		);
		try {
			expect(m.tree.findByText("Trust: 77")).not.toBeNull();
			const metrics = (await m.session.rootMetrics()) as Record<string, number>;
			expect(metrics.storyStateMigrations).toBe(0);
		} finally {
			await m.dispose();
		}
	});

	/**
	 * No frame exists in which the first render shows `initial` and then switches to the saved value.
	 * The first commit's patch already carries the saved value.
	 */
	it("the first commit draws the saved value: there is no in-between frame", async () => {
		const m = await mount(
			`
const game = defineStoryState({ key: "game", version: 1, initial: { trust: 0 } });
export default function App() {
	const [story] = useStoryState(game);
	return <Text>Trust: {story.trust}</Text>;
}`,
			snapshot([{ key: "game", version: 1, value: { trust: 91 } }]),
		);
		try {
			expect(m.commits).toHaveLength(1);
			expect(JSON.stringify(m.commits[0])).toContain("Trust: 91");
			expect(JSON.stringify(m.commits[0])).not.toContain("Trust: 0");
		} finally {
			await m.dispose();
		}
	});

	it("unknown entries are preserved: not deleted even when the definition vanishes", async () => {
		const m = await mount(
			`
const game = defineStoryState({ key: "game", version: 1, initial: { trust: 0 } });
export default function App() {
	const [story, setStory] = useStoryState(game);
	return (
		<Stack>
			<Text>Trust: {story.trust}</Text>
			<Button onPress={() => setStory({ trust: 5 })}>Bump</Button>
		</Stack>
	);
}`,
			snapshot([
				{ key: "game", version: 1, value: { trust: 1 } },
				{ key: "legacy-feature", version: 3, value: { kept: true } },
			]),
		);
		try {
			await m.press("Bump");
			expect(m.session.storyStateSnapshot().entries).toEqual([
				{ key: "game", version: 1, value: { trust: 5 } },
				{ key: "legacy-feature", version: 3, value: { kept: true } },
			]);
		} finally {
			await m.dispose();
		}
	});
});

describe("definition registry", () => {
	it("registered once even when three import the same module", async () => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: compiled(
				[
					{
						path: "src/state.ts",
						content: `import { defineStoryState } from "@rowcat/runtime";
export const game = defineStoryState({ key: "game", version: 1, initial: { n: 0 } });`,
					},
					{
						path: "src/a.ts",
						content: `import { game } from "./state";\nexport const a = game.key;`,
					},
					{
						path: "src/b.ts",
						content: `import { game } from "./state";\nexport const b = game.key;`,
					},
					{
						path: "src/main.tsx",
						content: `${IMPORTS}
import { game } from "./state";
import { a } from "./a";
import { b } from "./b";
export default function App() {
	const [story] = useStoryState(game);
	return <Text>{a}{b}{story.n}</Text>;
}`,
					},
				],
				"src/main.tsx",
			),
		});
		try {
			const tree = new TestHostTree();
			const mounted = await session.mountRoot({
				onCommit: (batch) => tree.apply(batch),
			});
			expect(mounted.ok).toBe(true);
			expect(session.storyStateSnapshot().entries).toEqual([
				{ key: "game", version: 1, value: { n: 0 } },
			]);
		} finally {
			await session.dispose();
		}
	});

	it("defining the same key twice keeps the session from standing", async () => {
		const error = await expectBootFailure(`
const a = defineStoryState({ key: "game", version: 1, initial: {} });
const b = defineStoryState({ key: "game", version: 1, initial: {} });
export default function App() { return <Text>{a.key}{b.key}</Text>; }`);
		expect(error.code).toBe(RUNTIME_HOST_ERROR_CODE.moduleEvaluationFailed);
		expect(runtimeCodeOf(error)).toBe("runtime_story_state_duplicate_key");
	});

	it("the registry seals before the first render: definitions during render are refused", async () => {
		const m = await mount(
			`
const game = defineStoryState({ key: "game", version: 1, initial: { n: 0 } });
export default function App() {
	const [story] = useStoryState(game);
	defineStoryState({ key: "late", version: 1, initial: { n: 0 } });
	return <Text>N: {story.n}</Text>;
}`,
			undefined,
			{ expectMountFailure: true },
		);
		try {
			expect(m.commits).toHaveLength(0);
			expect(m.rootErrors).toEqual([
				{ code: "runtime_story_state_definition_late", work: "mount" },
			]);
		} finally {
			await m.dispose();
		}
	});

	it("unused definitions stand in the snapshot too", async () => {
		const m = await mount(`
defineStoryState({ key: "unused", version: 4, initial: { z: 1 } });
export default function App() { return <Text>ok</Text>; }`);
		try {
			expect(m.session.storyStateSnapshot().entries).toEqual([
				{ key: "unused", version: 4, value: { z: 1 } },
			]);
		} finally {
			await m.dispose();
		}
	});
});

const SHARED = `
const game = defineStoryState({ key: "game", version: 1, initial: { score: 0 } });

function Header() {
	const [state] = useStoryState(game);
	return <Text>Score: {state.score}</Text>;
}

function Controls() {
	const [, setGame] = useStoryState(game);
	return <Button onPress={() => setGame((c) => ({ ...c, score: c.score + 1 }))}>Add</Button>;
}

export default function App() {
	return <Stack><Header /><Controls /></Stack>;
}`;

describe("two components reading the same definition", () => {
	it("one side's update is visible to the other, with one render", async () => {
		const m = await mount(SHARED);
		try {
			expect(m.tree.findByText("Score: 0")).not.toBeNull();
			const before = m.commits.length;
			await m.press("Add");
			expect(m.tree.findByText("Score: 1")).not.toBeNull();
			expect(m.commits.length - before).toBe(1);
		} finally {
			await m.dispose();
		}
	});
});

describe("properties of updates", () => {
	it("three functional updates in one task are +3 with one commit", async () => {
		const m = await mount(`
const game = defineStoryState({ key: "game", version: 1, initial: { n: 40 } });
export default function App() {
	const [story, setStory] = useStoryState(game);
	return (
		<Stack>
			<Text>N: {story.n}</Text>
			<Button onPress={() => { setStory((c) => ({ n: c.n + 1 })); setStory((c) => ({ n: c.n + 1 })); setStory((c) => ({ n: c.n + 1 })); }}>Bump</Button>
		</Stack>
	);
}`);
		try {
			const before = m.commits.length;
			await m.press("Bump");
			expect(m.tree.findByText("N: 43")).not.toBeNull();
			expect(m.commits.length - before).toBe(1);
			expect(m.storySnapshots).toHaveLength(1);
		} finally {
			await m.dispose();
		}
	});

	it("an update to the same value makes neither a render nor a commit", async () => {
		const m = await mount(`
const game = defineStoryState({ key: "game", version: 1, initial: { n: 1 } });
export default function App() {
	const [story, setStory] = useStoryState(game);
	return (
		<Stack>
			<Text>N: {story.n}</Text>
			<Button onPress={() => setStory((c) => c)}>Noop</Button>
		</Stack>
	);
}`);
		try {
			const before = m.commits.length;
			await m.press("Noop");
			expect(m.commits.length).toBe(before);
			expect(m.storySnapshots).toHaveLength(0);
		} finally {
			await m.dispose();
		}
	});

	/**
	 * A render that does not draw the value still commits. State commits and patch count are separate
	 * axes.
	 */
	it("a render with no patches still commits story state", async () => {
		const m = await mount(`
const game = defineStoryState({ key: "game", version: 1, initial: { hidden: 0 } });
export default function App() {
	const [, setStory] = useStoryState(game);
	/** The handler's identity is fixed, so this render emits no patches at all. */
	const onPress = useCallback(() => setStory((c) => ({ hidden: c.hidden + 1 })), []);
	return <Button onPress={onPress}>Hide</Button>;
}`);
		try {
			const before = m.commits.length;
			await m.press("Hide");
			expect(m.commits.length).toBe(before);
			expect(m.session.storyStateSnapshot().entries[0]?.value).toEqual({
				hidden: 1,
			});
		} finally {
			await m.dispose();
		}
	});

	it("refuses non-serializable values and over-limit values on the spot", async () => {
		for (const [expression, code] of [
			["new Date()", "runtime_story_state_value_invalid"],
			["new Map()", "runtime_story_state_value_invalid"],
			["(() => 1)", "runtime_story_state_value_invalid"],
			["Number.NaN", "runtime_story_state_value_invalid"],
			["Promise.resolve(1)", "runtime_story_state_value_invalid"],
			['"x".repeat(200000)', "runtime_story_state_limit_exceeded"],
		] as const) {
			const m = await mount(`
const game = defineStoryState({ key: "game", version: 1, initial: { v: 0 } });
export default function App() {
	const [, setStory] = useStoryState(game);
	return <Button onPress={() => setStory({ v: (${expression}) as never })}>Break</Button>;
}`);
			try {
				/** Rejected before the value enters the queue, not when a snapshot is made. */
				await expect(m.press("Break")).rejects.toMatchObject({
					runtimeCode: code,
				});
				expect(m.session.storyStateSnapshot().entries[0]?.value).toEqual({
					v: 0,
				});
			} finally {
				await m.dispose();
			}
		}
	}, 40_000);

	it("story state updates during render are refused", async () => {
		const m = await mount(
			`
const game = defineStoryState({ key: "game", version: 1, initial: { n: 0 } });
export default function App() {
	const [story, setStory] = useStoryState(game);
	setStory({ n: 1 });
	return <Text>N: {story.n}</Text>;
}`,
			undefined,
			{ expectMountFailure: true },
		);
		try {
			expect(m.commits).toHaveLength(0);
			expect(m.rootErrors).toEqual([
				{ code: "runtime_state_update_during_render", work: "mount" },
			]);
			expect(m.session.storyStateSnapshot().entries[0]?.value).toEqual({
				n: 0,
			});
		} finally {
			await m.dispose();
		}
	});

	it("changing the definition in one hook slot is refused", async () => {
		const m = await mount(`
const a = defineStoryState({ key: "alpha", version: 1, initial: { n: 0 } });
const b = defineStoryState({ key: "beta", version: 1, initial: { n: 0 } });
export default function App() {
	const [swap, setSwap] = useState(false);
	const [story] = useStoryState(swap ? b : a);
	return (
		<Stack>
			<Text>N: {story.n}</Text>
			<Button onPress={() => setSwap(true)}>Swap</Button>
		</Stack>
	);
}`);
		try {
			await m.press("Swap");
			expect(
				m.rootErrors.some(
					(entry) => entry.code === "runtime_story_state_hook_changed",
				),
			).toBe(true);
			/** The previous commit is still what's on screen. */
			expect(m.tree.findByText("N: 0")).not.toBeNull();
		} finally {
			await m.dispose();
		}
	});
});

describe("atomicity", () => {
	it("if the render after an update throws, the snapshot does not advance", async () => {
		const m = await mount(`
const game = defineStoryState({ key: "game", version: 1, initial: { n: 0 } });
export default function App() {
	const [story, setStory] = useStoryState(game);
	if (story.n > 0) throw new Error("render failed");
	return (
		<Stack>
			<Text>N: {story.n}</Text>
			<Button onPress={() => setStory({ n: 1 })}>Bump</Button>
		</Stack>
	);
}`);
		try {
			await m.press("Bump");
			expect(m.rootErrors.some((entry) => entry.work === "render")).toBe(true);
			expect(m.session.storyStateSnapshot().entries).toEqual([
				{ key: "game", version: 1, value: { n: 0 } },
			]);
			expect(m.tree.findByText("N: 0")).not.toBeNull();
			expect(m.storySnapshots).toHaveLength(0);
		} finally {
			await m.dispose();
		}
	});

	it("if the host refuses the commit bundle, story state does not advance either", async () => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: compiled([
				{
					path: "src/main.tsx",
					content: `${IMPORTS}
const game = defineStoryState({ key: "game", version: 1, initial: { n: 0 } });
export default function App() {
	const [story, setStory] = useStoryState(game);
	return (
		<Stack>
			<Text>N: {story.n}</Text>
			<Button onPress={() => setStory({ n: 1 })}>Bump</Button>
		</Stack>
	);
}`,
				},
			]),
		});
		try {
			const tree = new TestHostTree();
			let reject = false;
			await session.mountRoot({
				onCommit: (batch) => {
					if (reject) throw new Error("the consumer refuses");
					tree.apply(batch);
				},
			});
			reject = true;
			const button = tree.findByText("Bump");
			const handler = handlerIdOf(button?.props.onPress ?? null);
			await session.dispatchEvent(handler as number);
			await session.settle();
			expect(session.storyStateSnapshot().entries).toEqual([
				{ key: "game", version: 1, value: { n: 0 } },
			]);
		} finally {
			await session.dispose();
		}
	});
});

const MIGRATING = `
const game = defineStoryState({
	key: "game",
	version: 2,
	initial: { trust: 0, evidence: [] },
	migrate: (stored, fromVersion) => {
		if (fromVersion === 1) {
			const old = stored as { trust: number };
			return { trust: old.trust, evidence: [] as number[] };
		}
		throw new Error("Unsupported version " + fromVersion);
	},
});

export default function App() {
	const [story] = useStoryState(game);
	return <Text>Trust: {story.trust} / {story.evidence.length}</Text>;
}`;

describe("migration", () => {
	it("moves the old version inside QuickJS and the first render sees that value", async () => {
		const m = await mount(
			MIGRATING,
			snapshot([{ key: "game", version: 1, value: { trust: 75 } }]),
		);
		try {
			expect(m.tree.findByText("Trust: 75 / 0")).not.toBeNull();
			expect(m.session.storyStateSnapshot().entries).toEqual([
				{ key: "game", version: 2, value: { trust: 75, evidence: [] } },
			]);
			const metrics = (await m.session.rootMetrics()) as Record<string, number>;
			expect(metrics.storyStateMigrations).toBe(1);
		} finally {
			await m.dispose();
		}
	});

	/**
	 * Migration runs once per hydration, not once per render. The next session reads the new run
	 * as-is.
	 */
	it("the migrated snapshot is the new version, so the next session does not migrate again", async () => {
		const first = await mount(
			MIGRATING,
			snapshot([{ key: "game", version: 1, value: { trust: 75 } }]),
		);
		const exported = first.session.storyStateSnapshot();
		await first.dispose();

		const second = await mount(MIGRATING, exported);
		try {
			expect(second.tree.findByText("Trust: 75 / 0")).not.toBeNull();
			const metrics = (await second.session.rootMetrics()) as Record<
				string,
				number
			>;
			expect(metrics.storyStateMigrations).toBe(0);
		} finally {
			await second.dispose();
		}
	});

	it("if the migration throws, the session does not stand: the save is not discarded", async () => {
		const error = await expectBootFailure(
			`
const game = defineStoryState({
	key: "game",
	version: 2,
	initial: { n: 0 },
	migrate: () => { throw new Error("migration bug"); },
});
export default function App() {
	const [story] = useStoryState(game);
	return <Text>{story.n}</Text>;
}`,
			snapshot([{ key: "game", version: 1, value: { n: 7 } }]),
		);
		expect(error.code).toBe(RUNTIME_HOST_ERROR_CODE.storyStateBootstrapFailed);
		expect(runtimeCodeOf(error)).toBe("runtime_story_state_migration_failed");
	});

	it("a lower version without migrate keeps the session from standing", async () => {
		const error = await expectBootFailure(
			`
const game = defineStoryState({ key: "game", version: 2, initial: { n: 0 } });
export default function App() {
	const [story] = useStoryState(game);
	return <Text>{story.n}</Text>;
}`,
			snapshot([{ key: "game", version: 1, value: { n: 1 } }]),
		);
		expect(error.code).toBe(RUNTIME_HOST_ERROR_CODE.storyStateBootstrapFailed);
		expect(runtimeCodeOf(error)).toBe("runtime_story_state_migration_failed");
	});

	it("refuses non-serializable migration results", async () => {
		const error = await expectBootFailure(
			`
const game = defineStoryState({
	key: "game",
	version: 2,
	initial: { n: 0 },
	migrate: () => ({ at: new Date() }) as unknown as { n: number },
});
export default function App() {
	const [story] = useStoryState(game);
	return <Text>{JSON.stringify(story)}</Text>;
}`,
			snapshot([{ key: "game", version: 1, value: { n: 1 } }]),
		);
		expect(runtimeCodeOf(error)).toBe("runtime_story_state_migration_invalid");
	});

	it("refuses migration results over the limit", async () => {
		const error = await expectBootFailure(
			`
const game = defineStoryState({
	key: "game",
	version: 2,
	initial: { n: 0 },
	migrate: () => ({ blob: "x".repeat(200000) }) as unknown as { n: number },
});
export default function App() {
	const [story] = useStoryState(game);
	return <Text>{JSON.stringify(story).length}</Text>;
}`,
			snapshot([{ key: "game", version: 1, value: { n: 1 } }]),
		);
		expect(runtimeCodeOf(error)).toBe("runtime_story_state_migration_invalid");
	});

	it("a higher saved version keeps the session from standing: it is neither lowered nor deleted", async () => {
		const error = await expectBootFailure(
			MIGRATING,
			snapshot([{ key: "game", version: 3, value: { trust: 1 } }]),
		);
		expect(runtimeCodeOf(error)).toBe("runtime_story_state_version_newer");
	});

	/**
	 * An infinite loop in migration is also cut off by the VM's execution budget, so the host does not
	 * freeze.
	 */
	it("an infinite loop in a migration is cut by the execution budget", async () => {
		const error = await expectBootFailure(
			`
const game = defineStoryState({
	key: "game",
	version: 2,
	initial: { n: 0 },
	migrate: () => { for (;;) {} },

});
export default function App() {
	const [story] = useStoryState(game);
	return <Text>{story.n}</Text>;
}`,
			snapshot([{ key: "game", version: 1, value: { n: 1 } }]),
		);
		expect(error.code).toBe(RUNTIME_HOST_ERROR_CODE.storyStateBootstrapFailed);
		expect(error.message).toContain("budget");
	}, 20_000);
});

describe("snapshot validation", () => {
	it("an empty value is an empty snapshot", () => {
		expect(validateStoryStateSnapshot(null)).toEqual({
			ok: true,
			snapshot: emptyStoryStateSnapshot(),
		});
	});

	it.each([
		["the format version differs", { formatVersion: 2, entries: [] }],
		["entries is not an array", { formatVersion: 1, entries: {} }],
		["an entry is not an object", { formatVersion: 1, entries: [1] }],
		[
			"the key is off the rules",
			{ formatVersion: 1, entries: [{ key: "1x", version: 1, value: null }] },
		],
		[
			"the version is not an integer",
			{ formatVersion: 1, entries: [{ key: "a", version: 1.5, value: null }] },
		],
		[
			"the version is 0",
			{ formatVersion: 1, entries: [{ key: "a", version: 0, value: null }] },
		],
		[
			"the key appears twice",
			{
				formatVersion: 1,
				entries: [
					{ key: "a", version: 1, value: null },
					{ key: "a", version: 1, value: null },
				],
			},
		],
		[
			"the value does not serialize",
			{
				formatVersion: 1,
				entries: [{ key: "a", version: 1, value: Number.NaN }],
			},
		],
		[
			"an entry exceeds the limit",
			{
				formatVersion: 1,
				entries: [{ key: "a", version: 1, value: "x".repeat(200_000) }],
			},
		],
	])("%s", (_why, value) => {
		expect(validateStoryStateSnapshot(value).ok).toBe(false);
	});

	it("the canonical representation is key-ordered and deterministic", () => {
		const one = canonicalStoryStateSnapshot([
			{ key: "zeta", version: 1, value: 1 },
			{ key: "alpha", version: 2, value: 2 },
		]);
		const two = canonicalStoryStateSnapshot([
			{ key: "alpha", version: 2, value: 2 },
			{ key: "zeta", version: 1, value: 1 },
		]);
		expect(JSON.stringify(one)).toBe(JSON.stringify(two));
		expect(one.entries.map((entry) => entry.key)).toEqual(["alpha", "zeta"]);
	});

	it("exported snapshots carry none of the store's internal state", () => {
		const store = new RuntimeStoryStateStore();
		store.apply([{ key: "a", version: 1, value: { n: 1 } }]);
		const exported = store.snapshot();
		expect(Object.isFrozen(exported)).toBe(true);
		expect(() => {
			(exported.entries[0]?.value as { n: number }).n = 9;
		}).toThrow();
		expect(store.snapshot().entries[0]?.value).toEqual({ n: 1 });
	});

	it("invalid snapshots are refused before the VM is created", async () => {
		await expect(
			createRuntimeVmSession({
				engine: testEngine(),
				artifact: compiled([
					{
						path: "src/main.tsx",
						content: `${IMPORTS}\nexport default function App() { return <Text>x</Text>; }`,
					},
				]),
				storyState: { formatVersion: 9, entries: [] },
			}),
		).rejects.toMatchObject({
			code: RUNTIME_HOST_ERROR_CODE.storyStateSnapshotInvalid,
		});
	});

	it("there are limits: the defaults stand as values", () => {
		expect(DEFAULT_STORY_STATE_LIMITS).toEqual({
			maxEntries: 128,
			maxEntrySerializedLength: 64 * 1024,
			maxSnapshotSerializedLength: 1024 * 1024,
		});
	});
});

describe("hook lifetime", () => {
	it("saved values remain when the component vanishes", async () => {
		const m = await mount(`
const game = defineStoryState({ key: "game", version: 1, initial: { n: 0 } });

function Child() {
	const [story, setStory] = useStoryState(game);
	return (
		<Stack>
			<Text>Child: {story.n}</Text>
			<Button onPress={() => setStory({ n: story.n + 1 })}>Bump</Button>
		</Stack>
	);
}

export default function App() {
	const [shown, setShown] = useState(true);
	const [story] = useStoryState(game);
	return (
		<Stack>
			<Text>Root: {story.n}</Text>
			{shown ? <Child /> : null}
			<Button onPress={() => setShown(false)}>Hide</Button>
		</Stack>
	);
}`);
		try {
			await m.press("Bump");
			expect(m.tree.findByText("Root: 1")).not.toBeNull();
			await m.press("Hide");
			expect(m.tree.findByText("Child: 1")).toBeNull();
			expect(m.tree.findByText("Root: 1")).not.toBeNull();
			expect(m.session.storyStateSnapshot().entries[0]?.value).toEqual({
				n: 1,
			});
		} finally {
			await m.dispose();
		}
	});
});
