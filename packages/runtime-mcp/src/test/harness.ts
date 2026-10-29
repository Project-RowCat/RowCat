import { RUNTIME_AI_CORPUS } from "@rowcat/runtime-ai-docs";
import { createNodeRuntimeMcpHost } from "../node/host.ts";
import type { RuntimeMcpContext, RuntimeMcpHost } from "../ports.ts";
import { RuntimePreviewManager } from "../preview/manager.ts";
import type { RuntimeMcpConnection } from "../tools.ts";
import { findRuntimeMcpTool } from "../tools.ts";
import {
	type MemoryAuthoringSeed,
	MemoryAuthoringStore,
} from "./memory-authoring.ts";

/**
 * Test harness: runs on the real compiler and the real QuickJS. Imitating the compiler would leave
 * no claim that the project compiles. Imitating the VM would leave no claim that pressing changes
 * the screen. Those two are all this layer can verify, so the only double in the harness is the
 * authoring store, which belongs to Dexie and SQLite and is not something this package should
 * imitate.
 *
 * The clock is injected. To see idle sessions swept, time must be advanced. A test that waits on
 * Date.now() would wait ten minutes.
 *
 * Scheduling is injected too. Advancing time alone would leave the idle cleanup unverified. The
 * defect this slice fixed is that a session disappears while no tool call happens at all, and in
 * that situation there is neither a time to advance nor a tool to call. createTestClock supplies
 * both as one unit.
 */

export interface HarnessClock {
	now(): number;
	/** If omitted, real timers are used. Tests that check idle behavior must pass this. */
	schedule?(callback: () => void, delayMs: number): () => void;
}

export interface HarnessOptions {
	readonly seeds?: readonly MemoryAuthoringSeed[];
	readonly clock?: HarnessClock;
}

interface PendingTimer {
	at: number;
	readonly fire: () => void;
	done: boolean;
}

export interface TestClock extends HarnessClock {
	/** Advances the clock and fires any scheduled callbacks that come due, in order. */
	advance(ms: number): void;
	/** Number of timers still scheduled. Lets tests confirm that cancellation actually happened. */
	pending(): number;
}

/**
 * A controlled clock and scheduler as one set. Real timers, including vitest's fake timers, are not
 * used because this harness runs the real QuickJS and real compiler. Swapping in a global
 * setTimeout would also freeze the host scheduler's yields and WASM initialization, so an idle test
 * would stall during compilation.
 */
export function createTestClock(start = 1_000): TestClock {
	let now = start;
	const timers = new Set<PendingTimer>();
	return {
		now: () => now,
		schedule: (callback, delayMs) => {
			const timer: PendingTimer = {
				at: now + delayMs,
				fire: callback,
				done: false,
			};
			timers.add(timer);
			return () => {
				timer.done = true;
				timers.delete(timer);
			};
		},
		advance: (ms) => {
			now += ms;
			for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
				if (timer.done || timer.at > now) continue;
				timer.done = true;
				timers.delete(timer);
				timer.fire();
			}
		},
		pending: () => timers.size,
	};
}

export interface Harness {
	readonly connection: RuntimeMcpConnection;
	readonly store: MemoryAuthoringStore;
	readonly context: RuntimeMcpContext;
	readonly preview: RuntimePreviewManager;
	/** Calls a tool by name through the same path the app uses, including validation. */
	call(name: string, args?: unknown): Promise<unknown>;
	dispose(): Promise<void>;
}

/** WASM compilation is expensive, so tests in one file share the same host. */
let sharedHost: RuntimeMcpHost | null = null;
const hostFor = (): RuntimeMcpHost => {
	if (sharedHost === null) sharedHost = createNodeRuntimeMcpHost();
	return sharedHost;
};

export function createHarness(options: HarnessOptions = {}): Harness {
	const store = new MemoryAuthoringStore(options.seeds ?? []);
	const base = hostFor();
	const clock = options.clock;
	const host: RuntimeMcpHost =
		clock === undefined
			? base
			: {
					compile: base.compile,
					createSession: base.createSession,
					digest: base.digest,
					now: () => clock.now(),
					schedule: (callback, delayMs) =>
						clock.schedule === undefined
							? base.schedule(callback, delayMs)
							: clock.schedule(callback, delayMs),
				};
	const context: RuntimeMcpContext = {
		authoring: store,
		host,
		corpus: RUNTIME_AI_CORPUS,
	};
	const preview = new RuntimePreviewManager(context);
	const connection: RuntimeMcpConnection = { context, preview };
	return {
		connection,
		store,
		context,
		call: async (name, args) => {
			const tool = findRuntimeMcpTool(name);
			if (tool === null) throw new Error(`unknown tool: ${name}`);
			return tool.run(connection, args ?? {});
		},
		preview,
		dispose: () => preview.disposeAll(),
	};
}

/**
 * Smallest project where a button press increments a count. It verifies that an operation actually
 * changes state.
 */
export const COUNTER = `import { Button, Screen, Stack, Text, useState } from "@rowcat/runtime";

export default function App() {
	const [count, setCount] = useState(0);
	return (
		<Screen>
			<Stack>
				<Text>{count}</Text>
				<Button onPress={() => setCount(count + 1)}>Add</Button>
			</Stack>
		</Screen>
	);
}
`;

/** Screen that echoes typed text back. Material for verifying a controlled input round trip. */
export const MIRROR = `import { Screen, Stack, Text, TextInput, useState } from "@rowcat/runtime";

export default function App() {
	const [draft, setDraft] = useState("");
	const [sent, setSent] = useState("");
	return (
		<Screen>
			<Stack>
				<TextInput value={draft} onChangeText={setDraft} onSubmit={() => setSent(draft)} />
				<Text>{draft}</Text>
				<Text>Sent: {sent}</Text>
			</Stack>
		</Screen>
	);
}
`;

/**
 * Scroll and focus material. It covers what headless can only observe. The preview has no layout,
 * so no pixels are invented. What is recorded is what creator code requested and which node the
 * request reached, and that is all an agent can check.
 */
export const CONTROLS = `import {
	Button,
	Screen,
	ScrollView,
	Stack,
	Text,
	TextInput,
	useScrollController,
	useState,
	useTextEntryController,
} from "@rowcat/runtime";

export default function App() {
	const scroll = useScrollController();
	const reply = useTextEntryController();
	const [rows, setRows] = useState<string[]>(["A"]);
	const [draft, setDraft] = useState("");
	return (
		<Screen>
			<Stack>
				<ScrollView controller={scroll}>
					{rows.map((row) => <Text key={row}>{row}</Text>)}
				</ScrollView>
				<TextInput controller={reply} value={draft} onChangeText={setDraft} />
				<Button onPress={() => {
					setRows((current) => [...current, "Row " + String(current.length)]);
					scroll.scrollToEnd();
				}}>Send</Button>
				<Button onPress={() => reply.focus()}>Reply</Button>
				<Button onPress={() => reply.blur()}>Close</Button>
			</Stack>
		</Screen>
	);
}
`;

/**
 * State that spans chapters. Material for checking that restart continues it and reset clears it.
 */
export const CHAPTERS = `import {
	Button,
	Screen,
	Stack,
	Text,
	defineStoryState,
	useStoryState,
} from "@rowcat/runtime";

const game = defineStoryState({ key: "game", version: 1, initial: { chapter: 1 } });

export default function App() {
	const [state, setState] = useStoryState(game);
	return (
		<Screen>
			<Stack>
				<Text>Chapter {state.chapter}</Text>
				<Button onPress={() => setState((current) => ({ chapter: current.chapter + 1 }))}>
					Continue
				</Button>
			</Stack>
		</Screen>
	);
}
`;

/**
 * Screen that throws during render. Material for checking that a creator failure does not kill the
 * session.
 */
export const THROWS = `import { Screen, Text } from "@rowcat/runtime";

export default function App() {
	throw new Error("an error the author raised");
	return (
		<Screen>
			<Text>not visible</Text>
		</Screen>
	);
}
`;

export const seedProject = (
	draftId: string,
	source: string,
	extra: readonly { path: string; content: string }[] = [],
): MemoryAuthoringSeed => ({
	draftId,
	title: `Draft ${draftId}`,
	entry: "src/main.tsx",
	files: [{ path: "src/main.tsx", content: source }, ...extra],
});
