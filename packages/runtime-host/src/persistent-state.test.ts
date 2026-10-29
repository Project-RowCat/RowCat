import { describe, expect, it } from "vitest";
import { CreatorExecutionError } from "./errors.ts";
import { handlerIdOf, type RuntimePatchBatch } from "./patches.ts";
import {
	emptyPersistentStateSnapshot,
	type RuntimePersistentStateSnapshot,
	validatePersistentStateSnapshot,
} from "./persistent-state.ts";
import { createRuntimeVmSession, type RuntimeVmSession } from "./session.ts";
import type { RuntimeStoryStateSnapshot } from "./story-state.ts";
import { compiled, testEngine } from "./test/fixtures.ts";
import { TestHostTree } from "./testing/host-tree.ts";

/**
 * Phase 6B's runtime acceptance check: do the two lifetimes actually stay separate?
 *
 * Internal classes alone cannot prove this slice's claims. This file checks what only the VM
 * boundary can answer: whether the two registries seal at the same moment, whether the same key can
 * live in both lifetimes at once, whether play reset touches persistent state, and whether
 * persistent migration runs inside QuickJS.
 */

const IMPORTS = `import { Button, Stack, Text, defineStoryState, definePersistentState, useStoryState, usePersistentState } from "@rowcat/runtime";`;

interface Mounted {
	session: RuntimeVmSession;
	tree: TestHostTree;
	storySnapshots: RuntimeStoryStateSnapshot[];
	persistentSnapshots: RuntimePersistentStateSnapshot[];
	press(text: string): Promise<void>;
	dispose(): Promise<void>;
}

async function mount(
	source: string,
	snapshots: { story?: unknown; persistent?: unknown } = {},
): Promise<Mounted> {
	const storySnapshots: RuntimeStoryStateSnapshot[] = [];
	const persistentSnapshots: RuntimePersistentStateSnapshot[] = [];
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: compiled([
			{ path: "src/main.tsx", content: `${IMPORTS}\n${source}` },
		]),
		...(snapshots.story === undefined ? {} : { storyState: snapshots.story }),
		...(snapshots.persistent === undefined
			? {}
			: { persistentState: snapshots.persistent }),
		onStoryStateCommit: (snapshot) => storySnapshots.push(snapshot),
		onPersistentStateCommit: (snapshot) => persistentSnapshots.push(snapshot),
	});
	const tree = new TestHostTree();
	const commits: RuntimePatchBatch[] = [];
	const mounted = await session.mountRoot({
		onCommit: (batch) => {
			commits.push(batch);
			tree.apply(batch);
		},
	});
	if (!mounted.ok) throw new Error(`mount failed: ${mounted.error.message}`);
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
		storySnapshots,
		persistentSnapshots,
		press,
		dispose: () => session.dispose(),
	};
}

/**
 * Reads a failure as a code, whether it comes from session creation or from the first mount.
 *
 * The two sources are folded into one because the creator cannot tell them apart. Hydration
 * failures come from session creation, and late definitions during render come from mount. Both
 * mean the project does not start, but what must be answered is why.
 */
async function mountFailure(
	source: string,
	snapshots: { story?: unknown; persistent?: unknown } = {},
): Promise<{ code: string | null; message: string }> {
	const read = (error: unknown): { code: string | null; message: string } => {
		if (error instanceof CreatorExecutionError)
			return { code: error.runtimeCode, message: error.message };
		const cause = (error as { cause?: unknown }).cause;
		if (cause instanceof CreatorExecutionError)
			return { code: cause.runtimeCode, message: cause.message };
		return {
			code: (error as { code?: string }).code ?? null,
			message: String((error as Error).message ?? error),
		};
	};
	let session: RuntimeVmSession;
	try {
		session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: compiled([
				{ path: "src/main.tsx", content: `${IMPORTS}\n${source}` },
			]),
			...(snapshots.story === undefined ? {} : { storyState: snapshots.story }),
			...(snapshots.persistent === undefined
				? {}
				: { persistentState: snapshots.persistent }),
		});
	} catch (error) {
		return read(error);
	}
	try {
		const mounted = await session.mountRoot({ onCommit: () => {} });
		if (mounted.ok) throw new Error("expected the session to fail");
		return read(mounted.error);
	} finally {
		await session.dispose();
	}
}

/**
 * A minimal script where both lifetimes run together. It uses the same key ("progress") in both.
 *
 * The overlap is the point of this fixture. With a single registry, the project would not even
 * evaluate.
 */
const BOTH = `
const run = defineStoryState({ key: "progress", version: 1, initial: { chapter: 1 } });
const meta = definePersistentState({ key: "progress", version: 1, initial: { endings: [] as string[] } });

export default function App() {
	const [story, setStory] = useStoryState(run);
	const [persistent, setPersistent] = usePersistentState(meta);
	return (
		<Stack>
			<Text>chapter {story.chapter}</Text>
			<Text>endings {persistent.endings.join(",")}</Text>
			<Button onPress={() => setStory((c) => ({ chapter: c.chapter + 1 }))}>advance</Button>
			<Button onPress={() => setPersistent((c) => ({ endings: [...c.endings, "library"] }))}>unlock</Button>
		</Stack>
	);
}`;

describe("the central invariant: reset play does not erase long progress", () => {
	it("the two lifetimes share a key without overwriting each other", async () => {
		const app = await mount(BOTH);
		try {
			await app.press("advance");
			await app.press("unlock");
			expect(app.tree.findByText("chapter 2")).not.toBeNull();
			expect(app.tree.findByText("endings library")).not.toBeNull();
			expect(app.session.storyStateSnapshot().entries).toEqual([
				{ key: "progress", version: 1, value: { chapter: 2 } },
			]);
			expect(app.session.persistentStateSnapshot().entries).toEqual([
				{ key: "progress", version: 1, value: { endings: ["library"] } },
			]);
		} finally {
			await app.dispose();
		}
	});

	it("dropping the VM and passing both snapshots continues both", async () => {
		const first = await mount(BOTH);
		await first.press("advance");
		await first.press("advance");
		await first.press("unlock");
		const story = first.session.storyStateSnapshot();
		const persistent = first.session.persistentStateSnapshot();
		await first.dispose();

		const second = await mount(BOTH, { story, persistent });
		try {
			expect(second.tree.findByText("chapter 3")).not.toBeNull();
			expect(second.tree.findByText("endings library")).not.toBeNull();
		} finally {
			await second.dispose();
		}
	});

	/**
	 * The check that defines this slice. Play reset clears only the playthrough snapshot and passes
	 * the persistent snapshot through unchanged; that is all it does. The operation has no syntax that
	 * points at the persistent store, and that is confirmed here by value.
	 */
	it("reset play clears only the playthrough", async () => {
		const first = await mount(BOTH);
		await first.press("advance");
		await first.press("unlock");
		const persistent = first.session.persistentStateSnapshot();
		await first.dispose();

		const second = await mount(BOTH, {
			story: emptyStoryStateSnapshotForTest(),
			persistent,
		});
		try {
			expect(second.tree.findByText("chapter 1")).not.toBeNull();
			expect(second.tree.findByText("endings library")).not.toBeNull();
		} finally {
			await second.dispose();
		}
	});
});

const emptyStoryStateSnapshotForTest = (): RuntimeStoryStateSnapshot => ({
	formatVersion: 1,
	entries: [],
});

describe("definition properties", () => {
	it("refuses overlapping keys in the same lifetime", async () => {
		const failure = await mountFailure(`
const a = definePersistentState({ key: "meta", version: 1, initial: {} });
const b = definePersistentState({ key: "meta", version: 1, initial: {} });
export default function App() { return <Text>x</Text>; }
`);
		expect(failure.code).toBe("runtime_persistent_state_duplicate_key");
	});

	/**
	 * Sealing closes both lifetimes together. If a persistent definition is accepted after playthrough
	 * hydration, it would show a value on screen that is not in this session's snapshot.
	 */
	it("refuses definePersistentState during render", async () => {
		const failure = await mountFailure(`
export default function App() {
	definePersistentState({ key: "late", version: 1, initial: {} });
	return <Text>x</Text>;
}
`);
		expect(failure.code).toBe("runtime_persistent_state_definition_late");
	});

	/**
	 * The type system already blocks this combination, but the runtime blocks it too. `as never` alone
	 * gets past type checking. The screen would then read a value from a different lifetime, and it
	 * would be wrong without any error.
	 */
	it("refuses on the spot when given another lifetime's definition", async () => {
		const failure = await mountFailure(`
const run = defineStoryState({ key: "run", version: 1, initial: { n: 0 } });
export default function App() {
	const [value] = usePersistentState(run as never);
	return <Text>x {String(value)}</Text>;
}
`);
		expect(failure.code).toBe("runtime_persistent_state_value_invalid");
	});
});

describe("migration", () => {
	const MIGRATING = `
const meta = definePersistentState({
	key: "meta",
	version: 2,
	initial: { endings: [] as string[], runs: 0 },
	migrate: (stored) => ({ endings: (stored as { endings: string[] }).endings, runs: 0 }),
});
export default function App() {
	const [value] = usePersistentState(meta);
	return <Text>runs {value.runs} endings {value.endings.join(",")}</Text>;
}`;

	it("moves the old version inside QuickJS and settles on the new version", async () => {
		const app = await mount(MIGRATING, {
			persistent: {
				formatVersion: 1,
				entries: [{ key: "meta", version: 1, value: { endings: ["a", "b"] } }],
			},
		});
		try {
			expect(app.tree.findByText("runs 0 endings a,b")).not.toBeNull();
			expect(app.session.persistentStateSnapshot().entries).toEqual([
				{ key: "meta", version: 2, value: { endings: ["a", "b"], runs: 0 } },
			]);
		} finally {
			await app.dispose();
		}
	});

	it("the session does not stand when a migration throws", async () => {
		const failure = await mountFailure(
			`
const meta = definePersistentState({
	key: "meta",
	version: 2,
	initial: { n: 0 },
	migrate: () => { throw new Error("nope"); },
});
export default function App() { const [v] = usePersistentState(meta); return <Text>x {v.n}</Text>; }
`,
			{
				persistent: {
					formatVersion: 1,
					entries: [{ key: "meta", version: 1, value: { n: 1 } }],
				},
			},
		);
		expect(failure.code).toBe("runtime_persistent_state_migration_failed");
	});

	it("refuses when the saved version is higher", async () => {
		const failure = await mountFailure(
			`
const meta = definePersistentState({ key: "meta", version: 1, initial: { n: 0 } });
export default function App() { const [v] = usePersistentState(meta); return <Text>x {v.n}</Text>; }
`,
			{
				persistent: {
					formatVersion: 1,
					entries: [{ key: "meta", version: 9, value: { n: 1 } }],
				},
			},
		);
		expect(failure.code).toBe("runtime_persistent_state_version_newer");
	});
});

describe("host validation", () => {
	it("does not delete unknown entries", async () => {
		const app = await mount(BOTH, {
			persistent: {
				formatVersion: 1,
				entries: [
					{ key: "progress", version: 1, value: { endings: [] } },
					{ key: "removed", version: 3, value: { kept: true } },
				],
			},
		});
		try {
			await app.press("unlock");
			expect(app.session.persistentStateSnapshot().entries).toEqual([
				{ key: "progress", version: 1, value: { endings: ["library"] } },
				{ key: "removed", version: 3, value: { kept: true } },
			]);
		} finally {
			await app.dispose();
		}
	});

	it("refuses off-shape snapshots before creating the VM", () => {
		expect(validatePersistentStateSnapshot({ formatVersion: 2 }).ok).toBe(
			false,
		);
		expect(validatePersistentStateSnapshot({ formatVersion: 1 }).ok).toBe(
			false,
		);
		expect(
			validatePersistentStateSnapshot({
				formatVersion: 1,
				entries: [{ key: "9bad", version: 1, value: 1 }],
			}).ok,
		).toBe(false);
		expect(validatePersistentStateSnapshot(null)).toEqual({
			ok: true,
			snapshot: emptyPersistentStateSnapshot(),
		});
	});
});
