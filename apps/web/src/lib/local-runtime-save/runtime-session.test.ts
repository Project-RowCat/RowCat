import {
	createRuntimeVmSession,
	type RuntimeVmSession,
} from "@rowcat/runtime-host";
import { handlerIdOf } from "@rowcat/runtime-host/patches";
import { compiled, testEngine } from "@rowcat/runtime-host/test/fixtures";
import { TestHostTree } from "@rowcat/runtime-host/testing/host-tree";
import {
	createRuntimePlayerPersistence,
	type RuntimePlayerPersistence,
} from "@rowcat/runtime-persistence";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDb } from "#/lib/local-data/db.ts";
import { createDexieRuntimeSaveStore } from "./store.ts";

/**
 * Phase 6B's central acceptance scenario: creator TSX, QuickJS, snapshot, Dexie, and back to
 * QuickJS. It checks that four layers are actually connected. Each layer's unit tests can pass
 * while a gap between them shows up only as "progress disappears when the app is reopened", which
 * no single layer reproduces. Encrypted sync is not covered here. The round trip is covered by the
 * two-device harness in local-sync/runtime-save-roundtrip.test.ts.
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
			<Button onPress={() => setProgress((c) => ({ endings: [...c.endings, "library"] }))}>unlock</Button>
		</Stack>
	);
}`;

/** Same story at version 2. This is where durable storage of the migration result is checked. */
const APP_V2 = `
const run = defineStoryState({
	key: "run",
	version: 2,
	initial: { chapter: 1, visited: [] as number[] },
	migrate: (stored) => ({ chapter: (stored as { chapter: number }).chapter, visited: [] }),
});

export default function App() {
	const [story] = useStoryState(run);
	return <Stack><Text>chapter {story.chapter} visited {story.visited.length}</Text></Stack>;
}`;

let counter = 0;
const open = async (name: string): Promise<LocalDb> => {
	const db = new LocalDb(name);
	await db.open();
	return db;
};

interface Player {
	session: RuntimeVmSession;
	tree: TestHostTree;
	persistence: RuntimePlayerPersistence;
	press(text: string): Promise<void>;
	close(): Promise<void>;
}

/**
 * Mirrors what the play surface does. Phase 7 will attach in this order: load, then create the
 * session (two snapshots), then sessionHydrated, then mount. sessionHydrated persists the version
 * the migration produced. Commit, then storyStateCommitted or persistentStateCommitted, into the
 * local DB.
 */
async function play(db: LocalDb, source: string): Promise<Player> {
	const persistence = createRuntimePlayerPersistence({
		store: createDexieRuntimeSaveStore(db),
		storyId: "story-1",
	});
	const resolution = await persistence.load();
	if (resolution.status !== "ready")
		throw new Error(`load: ${resolution.status}`);
	const session = await createRuntimeVmSession({
		engine: testEngine(),
		artifact: compiled([
			{ path: "src/main.tsx", content: `${IMPORTS}\n${source}` },
		]),
		storyState: resolution.storyState,
		persistentState: resolution.persistentState,
		onStoryStateCommit: (snapshot) => persistence.storyStateCommitted(snapshot),
		onPersistentStateCommit: (snapshot) =>
			persistence.persistentStateCommitted(snapshot),
	});
	persistence.sessionHydrated({
		storyState: session.storyStateSnapshot(),
		persistentState: session.persistentStateSnapshot(),
	});
	const tree = new TestHostTree();
	const mounted = await session.mountRoot({
		onCommit: (batch) => tree.apply(batch),
	});
	if (!mounted.ok) throw mounted.error;
	return {
		session,
		tree,
		persistence,
		async press(text: string) {
			const node = tree.findByText(text);
			if (node === null) throw new Error(`no node with text ${text}`);
			const handler = handlerIdOf(node.props.onPress ?? null);
			if (handler === null) throw new Error("no handler");
			const outcome = await session.dispatchEvent(handler);
			if (!outcome.ok) throw outcome.error;
			await session.settle();
		},
		async close() {
			await persistence.flush();
			await session.dispose();
		},
	};
}

let databases: string[] = [];

/**
 * Marks that this device remembers the sync key. Only the shape has to match. The question this
 * file asks is whether anything is pending, not what the key opens. A device without a key has
 * nothing to receive and does not wait (store.ts). The "freshly paired device" case below needs
 * this marker set.
 */
const REMEMBERED_KEY = {
	wrapKey: {} as CryptoKey,
	iv: new Uint8Array(12),
	ct: new Uint8Array(1),
};

/**
 * A device that remembers the key but has not finished its first sync. This is the only state in
 * which `sync-required` applies.
 */
const rememberDeviceKey = async (db: LocalDb): Promise<void> => {
	const rows = await db.syncState.toArray();
	await db.syncState.put({ ...rows[0], deviceKey: REMEMBERED_KEY });
};

afterEach(async () => {
	for (const name of databases) await LocalDb.delete(name);
	databases = [];
});

/**
 * A device whose first sync has finished. The reason this matters is §55: on a freshly paired
 * device, a missing local row means "not known yet", not "new game". This layer does not merge the
 * two. Without the marker, load() correctly answers `sync-required`, which the last check in this
 * file verifies.
 */
const freshDatabase = async (): Promise<{ name: string; db: LocalDb }> => {
	counter += 1;
	const name = `runtime_session_${counter}`;
	databases.push(name);
	const db = await open(name);
	const rows = await db.syncState.toArray();
	await db.syncState.put({ ...rows[0], initialSyncDone: true });
	return { name, db };
};

describe("progress continues after reopening the app", () => {
	it("both lifetimes survive across the VM and database", async () => {
		const first = await freshDatabase();
		const player = await play(first.db, APP);
		await player.press("advance");
		await player.press("advance");
		await player.press("unlock");
		expect(player.tree.findByText("chapter 3")).not.toBeNull();
		await player.close();
		first.db.close();

		/**
		 * Reopens the database. Durability belongs to the storage medium, not to the database instance.
		 */
		const reopened = await open(first.name);
		const second = await play(reopened, APP);
		try {
			expect(second.tree.findByText("chapter 3")).not.toBeNull();
			expect(second.tree.findByText("endings library")).not.toBeNull();
		} finally {
			await second.close();
			reopened.close();
		}
	});

	/**
	 * The check that defines this slice: reset clears only the playthrough and keeps long-term
	 * progress.
	 */
	it("Reset play does not erase long progress", async () => {
		const first = await freshDatabase();
		const player = await play(first.db, APP);
		await player.press("advance");
		await player.press("advance");
		await player.press("advance");
		await player.press("unlock");
		await player.close();

		await player.persistence.resetPlaythrough();

		const after = await play(first.db, APP);
		try {
			expect(after.tree.findByText("chapter 1")).not.toBeNull();
			expect(after.tree.findByText("endings library")).not.toBeNull();
			/**
			 * A reset is not a tombstone. The row must remain, so the next playthrough accumulates on it.
			 */
			const record = await createDexieRuntimeSaveStore(first.db).getPlaythrough(
				"story-1",
			);
			expect(record?.deletedAt).toBeNull();
			expect(record?.dirty).toBe(1);
		} finally {
			await after.close();
			first.db.close();
		}
	});

	/**
	 * §57: if a local save exists, do not ask for the first sync. If the order were reversed, normal
	 * offline play would return sync-required every time, and no one could continue a game.
	 */
	it("with a local save it continues even before the first sync finishes", async () => {
		counter += 1;
		const name = `runtime_session_offline_${counter}`;
		databases.push(name);
		const db = await open(name);
		await rememberDeviceKey(db);
		const store = createDexieRuntimeSaveStore(db);
		expect(await store.initialSyncDone()).toBe(false);
		await store.putPlaythrough({
			storyId: "story-1",
			snapshot: {
				formatVersion: 1,
				entries: [{ key: "run", version: 1, value: { chapter: 6 } }],
			},
			updatedAt: "2026-09-01T00:00:00.000Z",
		});

		const player = await play(db, APP);
		try {
			expect(player.tree.findByText("chapter 6")).not.toBeNull();
		} finally {
			await player.close();
			db.close();
		}
	});

	/**
	 * §55 and §106: with no local row and no completed first sync, do not answer "new game".
	 * Collapsing that state into a new game would start over months of progress, and the first commit
	 * would overwrite the real save.
	 */
	it("a freshly paired device does not answer new game", async () => {
		counter += 1;
		const name = `runtime_session_pairing_${counter}`;
		databases.push(name);
		const db = await open(name);
		try {
			await rememberDeviceKey(db);
			const persistence = createRuntimePlayerPersistence({
				store: createDexieRuntimeSaveStore(db),
				storyId: "story-1",
			});
			expect(await persistence.load()).toEqual({ status: "sync-required" });
		} finally {
			db.close();
		}
	});
});

describe("migration durability", () => {
	/**
	 * §51: the new version produced by hydration must be saved. Otherwise the next session runs the
	 * same migration again, and with a non-deterministic migration the progress would change every
	 * time.
	 */
	it("the migration result is saved as a new revision", async () => {
		const first = await freshDatabase();
		const v1 = await play(first.db, APP);
		await v1.press("advance");
		await v1.press("advance");
		await v1.close();

		const store = createDexieRuntimeSaveStore(first.db);
		const before = await store.getPlaythrough("story-1");
		expect(before?.snapshot.entries[0]?.version).toBe(1);

		const v2 = await play(first.db, APP_V2);
		try {
			expect(v2.tree.findByText("chapter 3 visited 0")).not.toBeNull();
			await v2.persistence.flush();
			const after = await store.getPlaythrough("story-1");
			expect(after?.snapshot.entries[0]?.version).toBe(2);
			expect(after?.dirty).toBe(1);
			expect(after?.rev).not.toEqual(before?.rev);
		} finally {
			await v2.close();
			first.db.close();
		}
	});

	/**
	 * §52: a failed migration must not change the stored value at all. The session cannot start, so
	 * sessionHydrated has nowhere to be called.
	 */
	it("if the migration fails the stored row stays", async () => {
		const first = await freshDatabase();
		const v1 = await play(first.db, APP);
		await v1.press("advance");
		await v1.close();

		const store = createDexieRuntimeSaveStore(first.db);
		const before = await store.getPlaythrough("story-1");

		await expect(
			play(
				first.db,
				`
const run = defineStoryState({
	key: "run",
	version: 2,
	initial: { chapter: 1 },
	migrate: () => { throw new Error("nope"); },
});
export default function App() {
	const [story] = useStoryState(run);
	return <Stack><Text>chapter {story.chapter}</Text></Stack>;
}`,
			),
		).rejects.toThrow();

		const after = await store.getPlaythrough("story-1");
		expect(after).toEqual(before);
		first.db.close();
	});
});
