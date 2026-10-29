import {
	createRuntimeVmSession,
	type RuntimeVmSession,
} from "@rowcat/runtime-host";
import { handlerIdOf } from "@rowcat/runtime-host/patches";
import { compiled, testEngine } from "@rowcat/runtime-host/test/fixtures";
import { TestHostTree } from "@rowcat/runtime-host/testing/host-tree";
import {
	createRuntimePlayerLifecycle,
	createRuntimePlayerPersistence,
	type RuntimePlayerLifecycle,
	type RuntimePlayerLifecycleEvent,
	type RuntimeSaveStore,
} from "@rowcat/runtime-persistence";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDb } from "#/lib/local-data/db.ts";
import { createDexieRuntimeSaveStore } from "#/lib/local-runtime-save/store.ts";

/**
 * Acceptance scenario for Phase 7 completion, run on real QuickJS.
 * - The pure rules are measured deterministically with a fake session in
 * @rowcat/runtime-persistence's
 * lifecycle.test.ts. This file adds whether the layers are actually connected: creator TSX,
 * QuickJS,
 *   lifecycle, Dexie, then QuickJS again.
 * - The hook cannot run without React and a worker (vitest.config.ts), so this test follows the
 *   same order the hook uses, with an in-process VM in place of the worker. Stopping (unmountRoot,
 *   then settle, then dispose) must finish before the flush, and only then does the next load()
 *   run.
 * - Dexie cannot hold writes, so the store port is wrapped in a thin gate. The adapter code is
 *   unchanged.
 */

const IMPORTS = `import { Button, Stack, Text, defineStoryState, definePersistentState, useStoryState, usePersistentState } from "@rowcat/runtime";`;

const APP = `
const run = defineStoryState({ key: "run", version: 1, initial: { chapter: 1 } });
const meta = definePersistentState({ key: "meta", version: 1, initial: { endings: [] as string[] } });

export default function App() {
	const [story, setStory] = useStoryState(run);
	const [progress, setProgress] = usePersistentState(meta);
	return (
		<Stack>
			<Text>chapter {story.chapter}</Text>
			<Text>endings {progress.endings.join(",")}</Text>
			<Button onPress={() => setStory((c) => ({ chapter: c.chapter + 1 }))}>advance</Button>
			<Button onPress={() => setProgress((c) => ({ endings: [...c.endings, "bad-end"] }))}>unlock</Button>
		</Stack>
	);
}`;

const ARTIFACT = compiled([
	{ path: "src/main.tsx", content: `${IMPORTS}\n${APP}` },
]);

/**
 * A gate on the store that holds only the next write. If every write sat behind one gate, FIFO
 * ordering would keep them in order, and a late write from an old session overwriting a newer one
 * could not be reproduced. Real store writes are independent of each other.
 */
function gated(store: RuntimeSaveStore): RuntimeSaveStore & {
	gate(): void;
	open(): void;
} {
	let held: Promise<void> | null = null;
	let release: (() => void) | null = null;
	const pass = async (): Promise<void> => {
		if (held === null) return;
		const current = held;
		held = null;
		await current;
	};
	return {
		getPlaythrough: (storyId, slot) => store.getPlaythrough(storyId, slot),
		getPersistent: (storyId) => store.getPersistent(storyId),
		initialSyncDone: () => store.initialSyncDone(),
		async putPlaythrough(write) {
			await pass();
			return store.putPlaythrough(write);
		},
		async putPersistent(write) {
			await pass();
			return store.putPersistent(write);
		},
		gate() {
			held = new Promise<void>((resolve) => {
				release = resolve;
			});
		},
		open() {
			release?.();
			held = null;
			release = null;
		},
	};
}

interface Player {
	token: number;
	session: RuntimeVmSession;
	tree: TestHostTree;
	press(text: string): Promise<void>;
}

interface Harness {
	lifecycle: RuntimePlayerLifecycle;
	players: Player[];
	events: RuntimePlayerLifecycleEvent[];
	last(): Player;
}

function harness(store: RuntimeSaveStore): Harness {
	const players: Player[] = [];
	const events: RuntimePlayerLifecycleEvent[] = [];
	const lifecycle = createRuntimePlayerLifecycle({
		scope: () => ({ store, storyId: "story-1" }),
		createPersistence: (scope) =>
			createRuntimePlayerPersistence({
				store: scope.store,
				storyId: scope.storyId,
			}),
		async startSession(start) {
			const session = await createRuntimeVmSession({
				engine: testEngine(),
				artifact: ARTIFACT,
				storyState: start.storyState,
				persistentState: start.persistentState,
				onStoryStateCommit: (snapshot) =>
					start.persistence.storyStateCommitted(snapshot),
				onPersistentStateCommit: (snapshot) =>
					start.persistence.persistentStateCommitted(snapshot),
			});
			start.persistence.sessionHydrated({
				storyState: session.storyStateSnapshot(),
				persistentState: session.persistentStateSnapshot(),
			});
			const tree = new TestHostTree();
			const mounted = await session.mountRoot({
				onCommit: (batch) => tree.apply(batch),
			});
			if (!mounted.ok) throw mounted.error;
			const player: Player = {
				token: start.token,
				session,
				tree,
				async press(text) {
					const node = tree.findByText(text);
					if (node === null) throw new Error(`no node with text ${text}`);
					const handler = handlerIdOf(node.props.onPress ?? null);
					if (handler === null) throw new Error("no handler");
					const outcome = await session.dispatchEvent(handler);
					if (!outcome.ok) throw outcome.error;
					await session.settle();
				},
			};
			players.push(player);
			return {
				async stop() {
					if (session.state === "ready" || session.state === "running") {
						await session.unmountRoot();
						await session.settle();
					}
					await session.dispose();
				},
				release() {},
			};
		},
		onEvent: (event) => events.push(event),
	});
	return {
		lifecycle,
		players,
		events,
		last: () => players[players.length - 1] as Player,
	};
}

let counter = 0;
let databases: string[] = [];

const open = async (name: string): Promise<LocalDb> => {
	const db = new LocalDb(name);
	await db.open();
	return db;
};

/**
 * One device whose first sync has finished. Without that marker, `load()` honestly returns
 * `sync-required`.
 */
const freshDatabase = async (): Promise<{ name: string; db: LocalDb }> => {
	counter += 1;
	const name = `runtime_player_lifecycle_${counter}`;
	databases.push(name);
	const db = await open(name);
	const rows = await db.syncState.toArray();
	await db.syncState.put({ ...rows[0], initialSyncDone: true });
	return { name, db };
};

const drain = async (): Promise<void> => {
	for (let i = 0; i < 50; i++) await Promise.resolve();
};

const stillRunning = async (
	lifecycle: RuntimePlayerLifecycle,
): Promise<boolean> => {
	let settled = false;
	void lifecycle.settled().then(() => {
		settled = true;
	});
	await drain();
	return !settled;
};

afterEach(async () => {
	for (const name of databases) await LocalDb.delete(name);
	databases = [];
});

describe("restart", () => {
	/**
	 * Restarts after the screen has shown `chapter 2` but before that write reached disk. The old
	 * behavior started the new VM at `chapter 1`, because the new coordinator's `load()` read ahead of
	 * the held write.
	 */
	it("the new VM starts with the value only after the held last write finishes", async () => {
		const { db } = await freshDatabase();
		const store = gated(createDexieRuntimeSaveStore(db));
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		expect(h.last().tree.findByText("chapter 1")).not.toBeNull();

		store.gate();
		await h.last().press("advance");
		expect(h.last().tree.findByText("chapter 2")).not.toBeNull();
		h.lifecycle.restart();
		expect(await stillRunning(h.lifecycle)).toBe(true);
		expect(h.players).toHaveLength(1);

		store.open();
		await h.lifecycle.settled();
		expect(h.players).toHaveLength(2);
		expect(h.last().tree.findByText("chapter 2")).not.toBeNull();
		db.close();
	});
});

describe("reset play", () => {
	/**
	 * The old session's last write is followed by a blank playthrough. The result is checked as a
	 * storage fact, not as what the new VM shows: the database is fully closed and reopened as a new
	 * instance to verify it.
	 */
	it("reset beats the old write, reopening stays at the initial state, and long progress remains", async () => {
		const first = await freshDatabase();
		const store = gated(createDexieRuntimeSaveStore(first.db));
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		await h.last().press("advance");
		await h.last().press("unlock");
		await h.lifecycle.persistence()?.flush();

		store.gate();
		await h.last().press("advance");
		expect(h.last().tree.findByText("chapter 3")).not.toBeNull();
		h.lifecycle.resetPlaythrough();
		expect(await stillRunning(h.lifecycle)).toBe(true);
		expect(h.players).toHaveLength(1);

		store.open();
		await h.lifecycle.settled();
		expect(h.players).toHaveLength(2);
		expect(h.last().tree.findByText("chapter 1")).not.toBeNull();
		expect(h.last().tree.findByText("endings bad-end")).not.toBeNull();

		h.lifecycle.teardown();
		await h.lifecycle.settled();
		first.db.close();

		const reopened = await open(first.name);
		const c = harness(createDexieRuntimeSaveStore(reopened));
		c.lifecycle.start();
		await c.lifecycle.settled();
		try {
			expect(c.last().tree.findByText("chapter 1")).not.toBeNull();
			expect(c.last().tree.findByText("endings bad-end")).not.toBeNull();
		} finally {
			c.lifecycle.teardown();
			await c.lifecycle.settled();
			reopened.close();
		}
	});

	it("restart · restart · reset · restart ends as one session in the initial state", async () => {
		const { db } = await freshDatabase();
		const h = harness(createDexieRuntimeSaveStore(db));
		h.lifecycle.start();
		await h.lifecycle.settled();
		await h.last().press("advance");
		await h.last().press("unlock");

		h.lifecycle.restart();
		h.lifecycle.restart();
		h.lifecycle.resetPlaythrough();
		h.lifecycle.restart();
		await h.lifecycle.settled();

		expect(h.players).toHaveLength(2);
		expect(h.last().tree.findByText("chapter 1")).not.toBeNull();
		expect(h.last().tree.findByText("endings bad-end")).not.toBeNull();
		for (const player of h.players.slice(0, -1))
			expect(player.session.state).toBe("disposed");
		h.lifecycle.teardown();
		await h.lifecycle.settled();
		db.close();
	});
});
