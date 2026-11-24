import { authoringSyncCodecs } from "@rowcat/authoring";
import {
	type AfterstatePort,
	type ChatScene,
	type ChatSeed,
	type ChatStore,
	chatSyncCodecs,
	recallForTurn,
	recallRequestFor,
	reconcileConversation,
	resolveMessageAudiences,
	sweepDeletedRooms,
} from "@rowcat/chat";
import {
	AFTERSTATE_BRIDGE_BIN,
	hasAfterstateBridge,
	spawnAfterstate,
} from "@rowcat/chat/afterstate-stdio.test.helper";
import type { PushItem } from "@rowcat/contracts";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import { runtimePersistenceSyncCodecs } from "@rowcat/runtime-persistence";
import {
	type AnySyncCodec,
	b64ToBytes,
	bytesToB64,
	compareRev,
	createCodecRegistry,
	createSyncController,
	decryptRecord,
	generateDek,
	nobleAead,
	parseEncryptedBlob,
	type SyncCodecRegistry,
	type SyncController,
	type SyncDiagnosticEvent,
	type SyncTransport,
} from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import { nowIso } from "#/lib/local-data/clock.ts";
import { createDeviceKeyStore } from "#/lib/local-sync/device-key.ts";
import { syncCodecRegistry } from "#/lib/local-sync/registry.ts";
import {
	createDevice,
	createFakeTransport,
	type Device,
	FakeAccountServer,
	FakeSyncServer,
} from "#/test/sync-devices.ts";

/**
 * End-to-end encrypted sync of conversations with scenes, between two devices of one synthetic
 * account. What is real and what is a stand-in:
 *
 * ```text
 * REAL   packages/sync     createSyncController → createSyncEngine (pull/push/converge, retries),
 *                          keyring (setup → recovery code → unlock on the second device, key proof),
 *                          envelope crypto (encryptRecord/decryptRecord: AES-256-GCM via @noble,
 *                          AAD bound to owner/id/type/envelope), HLC, decideInbound
 *        packages/chat     every chat codec (chatSyncCodecs incl. chat.scene), the stores' pure rules
 *        apps/web          the product's Dexie stores (ChatStore + SyncStore from
 *                          createLocalDataStores) on fake-indexeddb, the product codec registry,
 *                          the device-key store
 * FAKE   relay             FakeSyncServer + FakeAccountServer (`src/test/sync-devices.ts`), the
 *                          in-memory double of /v2/me/sync implemented against @rowcat/contracts'
 *                          PushItem/PullResponse (per-owner seq, baseVersion concurrency, atomic
 *                          batches, idempotency); real-Postgres semantics are tested in apps/api
 *        network faults    a wrapper transport below (offline, reordered/duplicated pages, re-delivery)
 *        old client        the same store, with a controller built on a registry without `chat.scene`
 * ```
 *
 * The relay only ever sees what the real envelope produced: every pushed ciphertext is scanned for
 * the synthetic plaintext (message text, character names, scene member references).
 */

const OWNER = "0123456789abcdef0123456789abcdef";

const seed = (title: string): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "story-scenes",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "A harbour town at night.",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
	tools: [],
});

/** Synthetic plaintext the relay must never see. Distinctive enough to scan for. */
const SECRET = {
	key: "Kai buried the quicksilver key beneath the well stones",
	umbrella: "The vermilion umbrella hides inside the lighthouse lamp room",
	kai: "Kaiquorum",
	title: "Harbour of Zephyrine Lanterns",
};

// ── Relay and fault injection ───────────────────────────────────────────────────────────────────

interface Faults {
	/** Every request throws a network failure (status 0), as when the device has no connection. */
	offline: boolean;
	/** Records in each pulled page arrive in reverse seq order. */
	reverse: boolean;
	/** Every pulled record arrives twice in its page. */
	duplicate: boolean;
	/** The next pull ignores the device's cursor and re-delivers from this seq (a lost ack/crash). */
	redeliverFrom: number | null;
}

const noFaults = (): Faults => ({
	offline: false,
	reverse: false,
	duplicate: false,
	redeliverFrom: null,
});

function faultyTransport(
	server: FakeSyncServer,
	account: FakeAccountServer,
	faults: Faults,
): SyncTransport {
	const base = createFakeTransport(server, account);
	const guard = () => {
		if (faults.offline)
			throw Object.assign(new Error("offline"), { status: 0, code: "network" });
	};
	return {
		...base,
		getKeyring: async (...args) => {
			guard();
			return base.getKeyring(...args);
		},
		pull: async (input) => {
			guard();
			const since = faults.redeliverFrom ?? input.since;
			faults.redeliverFrom = null;
			const page = server.pull(since, input.limit);
			let records = page.records;
			if (faults.duplicate) records = records.flatMap((r) => [r, r]);
			if (faults.reverse) records = [...records].reverse();
			return { ...page, records };
		},
		push: async (input, options) => {
			guard();
			return base.push(input, options);
		},
	};
}

interface Peer {
	name: string;
	device: Device;
	chat: ChatStore;
	controller: SyncController;
	faults: Faults;
	diagnostics: SyncDiagnosticEvent[];
}

let devices: Device[] = [];
afterEach(() => {
	for (const device of devices) device.close();
	devices = [];
});

/** The registry an old build had: every codec except `chat.scene`. */
const oldClientRegistry = (): SyncCodecRegistry =>
	createCodecRegistry([
		...(chatSyncCodecs as readonly AnySyncCodec[]).filter(
			(codec) => codec.type !== "chat.scene",
		),
		...(authoringSyncCodecs as readonly AnySyncCodec[]),
		...(runtimePersistenceSyncCodecs as readonly AnySyncCodec[]),
	]);

function peer(
	name: string,
	relay: { server: FakeSyncServer; account: FakeAccountServer },
	registry: SyncCodecRegistry = syncCodecRegistry,
	reuse?: Device,
): Peer {
	const device = reuse ?? createDevice(name, relay.server);
	if (!reuse) devices.push(device);
	const faults = noFaults();
	const diagnostics: SyncDiagnosticEvent[] = [];
	let tick = 0;
	const controller = createSyncController({
		owner: OWNER,
		registry,
		store: device.sync,
		transport: faultyTransport(relay.server, relay.account, faults),
		aead: nobleAead,
		deviceKey: createDeviceKeyStore(device.db),
		clock: {
			nowIso: () => nowIso(),
			nowMs: () => {
				tick += 1000;
				return tick;
			},
		},
		sleep: async () => undefined,
		onDiagnostic: (event) => diagnostics.push(event),
	});
	return { name, device, chat: device.chat, controller, faults, diagnostics };
}

/**
 * One account, two devices: A turns sync on (generates the DEK, registers the keyring, gets the
 * recovery code); B finds the account locked and unlocks with that code. Nothing hands B the key
 * but the keyring on the relay and the code the user typed.
 */
async function pairedPeers(options: { oldB?: boolean } = {}) {
	const relay = {
		server: new FakeSyncServer(),
		account: new FakeAccountServer(),
	};
	const a = peer("a", relay);
	const b = peer(
		"b",
		relay,
		options.oldB ? oldClientRegistry() : syncCodecRegistry,
	);
	const issued = await a.controller.setup();
	if (!issued) throw new Error("setup lost the keyring race");
	await b.controller.inspect();
	expect(b.controller.snapshot().state).toBe("locked");
	await b.controller.unlock(issued.recoveryCode);
	expect(b.controller.snapshot().state).toBe("ready");
	return { relay, a, b, recoveryCode: issued.recoveryCode };
}

const sync = async (...peers: Peer[]) => {
	for (const p of peers) await p.controller.syncNow();
};

/** Round one uploads each device's changes, round two downloads the others'. */
const converge = async (...peers: Peer[]) => {
	await sync(...peers);
	await sync(...peers);
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

const noteCount = (p: Peer, code: string) =>
	p.diagnostics
		.filter((e) => e.kind === "note" && e.code === code)
		.reduce((n, e) => n + (e.kind === "note" ? e.count : 0), 0);

const ignoredCount = (p: Peer, reason: string) =>
	p.diagnostics
		.filter((e) => e.kind === "ignored" && e.reason === reason)
		.reduce((n, e) => n + (e.kind === "ignored" ? e.count : 0), 0);

/** Everything the relay ever received, as it received it. */
const relayItems = (server: FakeSyncServer): PushItem[] => server.pushes.flat();

/**
 * The plaintext the relay can see: the wire item (ids, types, versions are visible by design) and
 * the ciphertext, both as transmitted and with its base64 layers opened.
 */
function relayHas(server: FakeSyncServer, needle: string): boolean {
	const bytes = new TextEncoder().encode(needle);
	const contains = (hay: Uint8Array) => {
		outer: for (let i = 0; i + bytes.length <= hay.length; i++) {
			for (let j = 0; j < bytes.length; j++)
				if (hay[i + j] !== bytes[j]) continue outer;
			return true;
		}
		return false;
	};
	for (const item of relayItems(server)) {
		if (JSON.stringify({ ...item, ciphertext: null }).includes(needle))
			return true;
		if (item.ciphertext === null) continue;
		if (item.ciphertext.includes(needle)) return true;
		const blob = parseEncryptedBlob(item.ciphertext);
		if (contains(b64ToBytes(blob.ct)) || contains(b64ToBytes(blob.iv)))
			return true;
	}
	return false;
}

const sceneView = (s: ChatScene | undefined) =>
	s && { id: s.id, startAt: s.startAt, audience: s.audience, rev: s.rev };

const messageView = (
	messages: { id: string; content: string; rev: unknown }[],
) => messages.map((m) => ({ id: m.id, content: m.content, rev: m.rev }));

/** A room with a cast member and three messages, the second starting a private scene. */
async function storyRoom(chat: ChatStore) {
	const room = await chat.createRoom({
		originStoryId: null,
		seed: seed(SECRET.title),
		title: SECRET.title,
	});
	const kai = await chat.createCharacter({ roomId: room.id, name: SECRET.kai });
	const m1 = await chat.appendMessage({
		roomId: room.id,
		role: "user",
		content: "We walk to the harbour together.",
	});
	const m2 = await chat.appendMessage({
		roomId: room.id,
		role: "assistant",
		content: SECRET.key,
		speaker: SECRET.kai,
	});
	const m3 = await chat.appendMessage({
		roomId: room.id,
		role: "user",
		content: "I nod and keep the secret.",
	});
	const shared = await chat.setScene({
		roomId: room.id,
		startAt: { createdAt: m1.createdAt, messageId: m1.id },
		audience: { kind: "room" },
	});
	const secret = await chat.setScene({
		roomId: room.id,
		startAt: { createdAt: m2.createdAt, messageId: m2.id },
		audience: { kind: "participants", members: ["user", `char:${kai.id}`] },
	});
	if (!shared || !secret) throw new Error("scene");
	return { room, kai, m1, m2, m3, shared, secret };
}

// ── (1) ─────────────────────────────────────────────────────────────────────────────────────────

describe("(1) a room with messages and scenes crosses the relay encrypted", () => {
	it("syncs reviewed audiences without widening a revised note or rewriting the original text", async () => {
		const { relay, a, b } = await pairedPeers();
		const story = await storyRoom(a.chat);
		const first = await a.chat.createMemory({
			roomId: story.room.id,
			content: "First surviving note",
		});
		const stale = await a.chat.createMemory({
			roomId: story.room.id,
			content: "Private carnelian",
		});
		const removed = await a.chat.createMemory({
			roomId: story.room.id,
			content: "Removed note",
		});
		const classified = await a.chat.createMemory({
			roomId: story.room.id,
			content: "Narrator carnelian",
			audience: { kind: "narrator" },
		});
		await sync(a, b);
		await b.chat.updateMemory(stale.id, { audience: { kind: "narrator" } });
		await b.chat.deleteMemory(removed.id);
		await converge(a, b);
		for (const note of [first, stale, removed])
			await a.chat.updateMemory(note.id, {
				audience: { kind: "room" },
				ifUnresolvedAt: note.rev,
			});
		await sync(a, b);
		const notes = await b.chat.listMemories(story.room.id);
		expect(notes).toHaveLength(3);
		expect(notes.find((n) => n.id === first.id)).toMatchObject({
			content: first.content,
			audience: { kind: "room" },
		});
		for (const n of [stale, classified])
			expect(notes.find((row) => row.id === n.id)).toMatchObject({
				content: n.content,
				audience: { kind: "narrator" },
			});
		expect(notes.some((row) => row.id === removed.id)).toBe(false);
		expect(relayHas(relay.server, "carnelian")).toBe(false);
	});

	it("B decrypts exactly A's records; the relay holds only envelope output", async () => {
		const { relay, a, b } = await pairedPeers();
		const story = await storyRoom(a.chat);

		await sync(a, b);

		expect((await b.chat.getRoom(story.room.id))?.title).toBe(SECRET.title);
		expect(messageView(await b.chat.listAllMessages(story.room.id))).toEqual(
			messageView(await a.chat.listAllMessages(story.room.id)),
		);
		expect(
			(await b.chat.listCharacters(story.room.id)).map((c) => [c.id, c.name]),
		).toEqual([[story.kai.id, SECRET.kai]]);
		const scenesOn = async (p: Peer) =>
			(await p.chat.listScenes(story.room.id))
				.map(sceneView)
				.sort((x, y) => (x?.id ?? "").localeCompare(y?.id ?? ""));
		expect(await scenesOn(b)).toEqual(await scenesOn(a));
		expect(
			(await b.chat.listScenes(story.room.id)).find(
				(s) => s.id === story.secret.id,
			)?.audience,
		).toEqual({
			kind: "participants",
			members: [`char:${story.kai.id}`, "user"],
		});

		/* Every record went up as a v1 envelope, and the relay holds the scene rows. */
		const items = relayItems(relay.server);
		expect(items.filter((i) => i.type === "chat.scene")).toHaveLength(2);
		for (const item of items) {
			expect(item.envelope).toBe(1);
			expect(item.ciphertext).not.toBeNull();
		}
		/* No plaintext reached the relay: text, names, member refs, audience vocabulary. */
		for (const needle of [
			SECRET.key,
			"quicksilver",
			SECRET.kai,
			SECRET.title,
			`char:${story.kai.id}`,
			'"participants"',
			'"members"',
			"We walk to the harbour",
		])
			expect(relayHas(relay.server, needle), needle).toBe(false);
		/* Controls: the scanner sees what the relay legitimately sees (ids and types), and it would
		 * see plaintext had any gone into an envelope's `ct` unencrypted. */
		expect(relayHas(relay.server, story.secret.id)).toBe(true);
		relay.server.pushes.push([
			{
				id: "canary",
				type: "chat.message",
				baseVersion: 0,
				deleted: false,
				envelope: 1,
				ciphertext: JSON.stringify({
					v: 1,
					iv: bytesToB64(new Uint8Array(12)),
					ct: bytesToB64(
						new TextEncoder().encode(`{"content":"${SECRET.umbrella}"}`),
					),
				}),
			} as PushItem,
		]);
		expect(relayHas(relay.server, SECRET.umbrella)).toBe(true);
		relay.server.pushes.pop();
		/* And a key other than the account's DEK cannot open a scene's ciphertext. */
		const sceneItem = items.find((i) => i.id === story.secret.id);
		await expect(
			decryptRecord(
				generateDek(),
				{ owner: OWNER, recordId: story.secret.id, type: "chat.scene" },
				sceneItem?.ciphertext ?? "",
				nobleAead,
			),
		).rejects.toThrow();
		/* The AAD binds the type: the scene's ciphertext presented as a message does not open on B. */
		relay.server.seed({
			id: "swapped-1",
			type: "chat.message",
			ciphertext: sceneItem?.ciphertext ?? null,
			envelope: 1,
			version: 1,
			deleted: false,
		});
		await sync(b);
		expect(ignoredCount(b, "decrypt_failed")).toBe(1);
	});
});

// ── (2) ─────────────────────────────────────────────────────────────────────────────────────────

describe("(2) concurrent message edits", () => {
	it("A edits an old message while B adds one offline; both converge", async () => {
		const { a, b } = await pairedPeers();
		const story = await storyRoom(a.chat);
		await sync(a, b);

		b.faults.offline = true;
		await a.chat.updateMessage(story.m1.id, {
			content: "We walk to the harbour together, lanterns lit.",
		});
		const offline = await b.chat.appendMessage({
			roomId: story.room.id,
			role: "user",
			content: "I add a line while the ferry has no signal.",
		});
		/* The offline attempt fails without touching local data. */
		await expect(b.controller.syncNow()).rejects.toThrow();
		expect(b.controller.snapshot().state).toBe("error");
		expect((await b.device.db.messages.get(offline.id))?.dirty).toBe(1);

		await sync(a);
		b.faults.offline = false;
		await converge(a, b);

		const onA = messageView(await a.chat.listAllMessages(story.room.id));
		expect(messageView(await b.chat.listAllMessages(story.room.id))).toEqual(
			onA,
		);
		expect(onA.map((m) => m.content)).toEqual([
			"We walk to the harbour together, lanterns lit.",
			SECRET.key,
			"I nod and keep the secret.",
			"I add a line while the ferry has no signal.",
		]);
		/* B's new line falls inside the private scene on both devices (the scene covers it). */
		for (const p of [a, b]) {
			const audiences = resolveMessageAudiences(
				await p.chat.listAllMessages(story.room.id),
				await p.chat.listScenes(story.room.id),
			);
			expect(audiences.get(offline.id)?.kind).toBe("participants");
			expect(audiences.get(story.m1.id)?.kind).toBe("room");
		}
		for (const p of [a, b])
			expect(
				(await p.device.sync.collectOutbound({ limit: 50 })).records,
			).toEqual([]);
	});
});

// ── (3) ─────────────────────────────────────────────────────────────────────────────────────────

describe("(3) concurrent conflicting audiences", () => {
	const NARROW = (kai: string) => ({
		kind: "participants" as const,
		members: [`char:${kai}`, "user"],
	});

	async function contested() {
		const ctx = await pairedPeers();
		const story = await storyRoom(ctx.a.chat);
		/* The contested scene starts wide-ish: user, Kai and the work's first character. */
		await ctx.a.chat.setScene({
			roomId: story.room.id,
			startAt: { createdAt: story.m3.createdAt, messageId: story.m3.id },
			audience: {
				kind: "participants",
				members: ["user", `char:${story.kai.id}`, "seed:0"],
			},
		});
		await sync(ctx.a, ctx.b);
		const start = { createdAt: story.m3.createdAt, messageId: story.m3.id };
		const contestedOn = async (p: Peer) =>
			(await p.chat.listScenes(story.room.id)).find(
				(s) => s.startAt.messageId === story.m3.id,
			);
		return { ...ctx, story, start, contestedOn };
	}

	it("the narrowing survives when the widening reaches the relay first (chat_scene_restrictive_kept)", async () => {
		const { a, b, story, start, contestedOn } = await contested();

		const narrowed = await a.chat.setScene({
			roomId: story.room.id,
			startAt: start,
			audience: NARROW(story.kai.id),
		});
		await tick();
		const widened = await b.chat.setScene({
			roomId: story.room.id,
			startAt: start,
			audience: { kind: "room" },
		});
		/* Concurrent, and the widening is the later edit by HLC: plain LWW would pick it. */
		expect(
			narrowed && widened ? compareRev(widened.rev, narrowed.rev) : 0,
		).toBeGreaterThan(0);

		await sync(b, a, b);

		expect((await contestedOn(a))?.audience).toEqual(NARROW(story.kai.id));
		expect((await contestedOn(b))?.audience).toEqual(NARROW(story.kai.id));
		expect(sceneView(await contestedOn(b))).toEqual(
			sceneView(await contestedOn(a)),
		);
		expect(noteCount(a, "chat_scene_restrictive_kept")).toBeGreaterThanOrEqual(
			1,
		);
		for (const p of [a, b])
			expect(
				(await p.device.sync.collectOutbound({ limit: 50 })).records,
			).toEqual([]);

		/* A later, non-concurrent widening by B (B has seen the narrowing) wins on both devices. */
		await b.chat.setScene({
			roomId: story.room.id,
			startAt: start,
			audience: { kind: "room" },
		});
		await converge(b, a);
		expect((await contestedOn(a))?.audience).toEqual({ kind: "room" });
		expect((await contestedOn(b))?.audience).toEqual({ kind: "room" });
	});

	it("the narrowing wins when it is also the later edit, whichever device syncs first", async () => {
		const { a, b, story, start, contestedOn } = await contested();

		await b.chat.setScene({
			roomId: story.room.id,
			startAt: start,
			audience: { kind: "room" },
		});
		await tick();
		await a.chat.setScene({
			roomId: story.room.id,
			startAt: start,
			audience: NARROW(story.kai.id),
		});

		await sync(a, b, a);

		expect((await contestedOn(a))?.audience).toEqual(NARROW(story.kai.id));
		expect((await contestedOn(b))?.audience).toEqual(NARROW(story.kai.id));
	});

	/**
	 * The narrowing reaches the relay first and the concurrent widening carries the later HLC: the
	 * widening device receives an *older* revision while its own edit is unsent. That is concurrency,
	 * not a replay (`decideInbound`'s `mergeConcurrent` for `chat.scene`), so the codec's restrictive
	 * rule runs and both devices settle on the narrowing.
	 */
	it("the narrowing survives when it reaches the relay first and the widening is later", async () => {
		const { a, b, story, start, contestedOn } = await contested();

		await a.chat.setScene({
			roomId: story.room.id,
			startAt: start,
			audience: NARROW(story.kai.id),
		});
		await tick();
		await b.chat.setScene({
			roomId: story.room.id,
			startAt: start,
			audience: { kind: "room" },
		});

		await sync(a, b, a);

		expect((await contestedOn(a))?.audience).toEqual(NARROW(story.kai.id));
		expect((await contestedOn(b))?.audience).toEqual(NARROW(story.kai.id));
		expect(sceneView(await contestedOn(b))).toEqual(
			sceneView(await contestedOn(a)),
		);
		expect(noteCount(b, "chat_scene_restrictive_kept")).toBeGreaterThan(0);
	});
});

// ── (4) ─────────────────────────────────────────────────────────────────────────────────────────

describe("(4) deletions travel as tombstones and cascade", () => {
	it("A deletes a message, then the room; B removes both, and the scenes go with the room", async () => {
		const { relay, a, b } = await pairedPeers();
		const story = await storyRoom(a.chat);
		await sync(a, b);
		expect(await b.chat.listScenes(story.room.id)).toHaveLength(2);

		await a.chat.deleteMessage(story.m3.id);
		await sync(a, b);
		expect(
			(await b.chat.listAllMessages(story.room.id)).map((m) => m.id),
		).toEqual([story.m1.id, story.m2.id]);

		await a.chat.deleteRoom(story.room.id);
		await sync(a, b);

		/* Only the room tombstone travelled for the cascade: no scene tombstone was pushed. */
		const lastPush = relay.server.pushes.at(-1) ?? [];
		expect(lastPush.map((i) => [i.type, i.deleted])).toEqual([
			["chat.room", true],
		]);
		expect(await b.chat.getRoom(story.room.id)).toBeNull();
		for (const scene of [story.shared, story.secret]) {
			const row = await b.device.db.chatScenes.get(scene.id);
			expect(row?.deletedAt).not.toBeNull();
			expect(row?.dirty).toBe(0);
		}
		const characterRow = await b.device.db.chatCharacters.get(story.kai.id);
		expect(characterRow?.deletedAt).not.toBeNull();
		for (const p of [a, b])
			expect(
				(await p.device.sync.collectOutbound({ limit: 50 })).records,
			).toEqual([]);
	});
});

// ── (5) ─────────────────────────────────────────────────────────────────────────────────────────

describe("(5) reordered, duplicated and re-delivered pages, and an offline period", () => {
	it("converges to the same records whatever the delivery order", async () => {
		const { a, b } = await pairedPeers();
		const story = await storyRoom(a.chat);

		/* B's first pull arrives children-first (scenes and messages before their room), each twice. */
		b.faults.reverse = true;
		b.faults.duplicate = true;
		await sync(a, b);
		expect(await b.chat.listScenes(story.room.id)).toHaveLength(2);

		/* B goes offline; both keep working. */
		b.faults.offline = true;
		await a.chat.updateMessage(story.m2.id, {
			content: `${SECRET.key}, wrapped in oilcloth.`,
		});
		await a.chat.setScene({
			roomId: story.room.id,
			startAt: { createdAt: story.m3.createdAt, messageId: story.m3.id },
			audience: { kind: "narrator" },
		});
		await a.chat.deleteScene(story.shared.id);
		const late = await b.chat.appendMessage({
			roomId: story.room.id,
			role: "assistant",
			content: "The tide turns while nobody is watching.",
			speaker: SECRET.kai,
		});
		await expect(b.controller.syncNow()).rejects.toThrow();
		await sync(a);

		/* Back online: the pull is re-delivered from the start, reversed and duplicated. */
		b.faults.offline = false;
		b.faults.redeliverFrom = 0;
		await converge(a, b);
		b.faults.reverse = false;
		b.faults.duplicate = false;
		await converge(a, b);

		expect(messageView(await b.chat.listAllMessages(story.room.id))).toEqual(
			messageView(await a.chat.listAllMessages(story.room.id)),
		);
		expect(
			(await a.chat.listAllMessages(story.room.id)).map((m) => m.id),
		).toContain(late.id);
		const live = async (p: Peer) =>
			(await p.chat.listScenes(story.room.id))
				.map(sceneView)
				.sort((x, y) => (x?.id ?? "").localeCompare(y?.id ?? ""));
		expect(await live(b)).toEqual(await live(a));
		expect((await live(a)).map((s) => s?.audience.kind).sort()).toEqual([
			"narrator",
			"participants",
		]);
		expect(
			(await b.device.db.chatScenes.get(story.shared.id))?.deletedAt,
		).not.toBeNull();
		for (const p of [a, b])
			expect(
				(await p.device.sync.collectOutbound({ limit: 50 })).records,
			).toEqual([]);
	});
});

// ── (6) ─────────────────────────────────────────────────────────────────────────────────────────

describe("(6) mixed versions: a client without the chat.scene codec", () => {
	it("skips scene records, still syncs messages, and its edits never remove a scene", async () => {
		const { relay, a, b: old } = await pairedPeers({ oldB: true });
		const story = await storyRoom(a.chat);
		await sync(a, old);

		expect(messageView(await old.chat.listAllMessages(story.room.id))).toEqual(
			messageView(await a.chat.listAllMessages(story.room.id)),
		);
		/* Skipped, never written: no row, no dirty flag, nothing to push for it. */
		expect(await old.device.db.chatScenes.count()).toBe(0);
		expect(ignoredCount(old, "unknown_type")).toBe(2);

		const sceneVersions = () =>
			[story.shared.id, story.secret.id].map(
				(id) => relay.server.row(id)?.version,
			);
		const before = sceneVersions();

		await old.chat.updateMessage(story.m2.id, {
			content: `${SECRET.key} (edited on the old build)`,
		});
		const added = await old.chat.appendMessage({
			roomId: story.room.id,
			role: "user",
			content: "Typed on the old build.",
		});
		await converge(old, a);

		const onA = await a.chat.listAllMessages(story.room.id);
		expect(onA.find((m) => m.id === story.m2.id)?.content).toBe(
			`${SECRET.key} (edited on the old build)`,
		);
		expect(onA.map((m) => m.id)).toContain(added.id);
		/* The scenes on the new client are untouched, record for record, and the relay rows too. */
		expect(
			(await a.chat.listScenes(story.room.id))
				.map(sceneView)
				.sort((x, y) => (x?.id ?? "").localeCompare(y?.id ?? "")),
		).toEqual(
			[story.shared, story.secret]
				.map(sceneView)
				.sort((x, y) => (x?.id ?? "").localeCompare(y?.id ?? "")),
		);
		expect(sceneVersions()).toEqual(before);
		expect(
			relayItems(relay.server).filter((i) => i.type === "chat.scene"),
		).toHaveLength(2);
		/* And the old build's new line is read inside the private scene by the new client. */
		const audiences = resolveMessageAudiences(
			onA,
			await a.chat.listScenes(story.room.id),
		);
		expect(audiences.get(added.id)?.kind).toBe("participants");
	});

	/**
	 * The documented rule (`docs/sync/ARCHITECTURE.md` §9.2: an unknown type is ignored and the cursor
	 * advances) has a consequence for the upgrade: the build that learns `chat.scene` does not receive
	 * the scenes it skipped until a full resync (`resetCursor`). Pinned here so a change to that rule
	 * is a visible decision.
	 */
	it("after upgrading, skipped scenes arrive only with a full resync", async () => {
		const { relay, a, b: old } = await pairedPeers({ oldB: true });
		const story = await storyRoom(a.chat);
		await sync(a, old);

		const upgraded = peer("b", relay, syncCodecRegistry, old.device);
		await upgraded.controller.inspect();
		expect(upgraded.controller.snapshot().state).toBe("ready");
		await sync(upgraded);
		expect(await upgraded.chat.listScenes(story.room.id)).toEqual([]);

		await upgraded.device.sync.resetCursor();
		await sync(upgraded);
		expect(
			(await upgraded.chat.listScenes(story.room.id)).map(sceneView),
		).toHaveLength(2);
	});
});

// ── Afterstate: each device's index follows its own synced store ──────────────────────────────────

/**
 * After sync, each device runs `reconcileConversation` against its own real afterstate bridge (the
 * stdio host, one engine process per device, in-memory store). The scenes reach the index only
 * through the synced store, so equal recall on both devices is evidence that sync delivered the
 * same scenes, and audience filtering shows the scenes arrived intact (a dropped or widened scene
 * would surface a passage its audience did not witness).
 */
describe.skipIf(!hasAfterstateBridge())(
	`(afterstate) recall after sync, per device (${AFTERSTATE_BRIDGE_BIN})`,
	() => {
		it("both devices recall the same passages; neither recalls a deleted scene or a deleted room", async () => {
			const { a, b } = await pairedPeers();
			const engines = {
				a: await spawnAfterstate(),
				b: await spawnAfterstate(),
			};
			try {
				const room = await a.chat.createRoom({
					originStoryId: null,
					seed: seed(SECRET.title),
					title: SECRET.title,
				});
				const kai = await a.chat.createCharacter({
					roomId: room.id,
					name: SECRET.kai,
				});
				const say = (
					content: string,
					role: "user" | "assistant" = "assistant",
				) =>
					a.chat.appendMessage({
						roomId: room.id,
						role,
						content,
						...(role === "assistant" ? { speaker: SECRET.kai } : {}),
					});
				const at = (m: { id: string; createdAt: string }) => ({
					createdAt: m.createdAt,
					messageId: m.id,
				});
				const witnessed = {
					kind: "participants" as const,
					members: ["user", `char:${kai.id}`],
				};

				const secret = await say(SECRET.key);
				const privateScene = await a.chat.setScene({
					roomId: room.id,
					startAt: at(secret),
					audience: witnessed,
				});
				const hidden = await say(SECRET.umbrella);
				await a.chat.setScene({
					roomId: room.id,
					startAt: at(hidden),
					audience: { kind: "narrator" },
				});
				const fillers = [];
				for (let i = 0; i < 30; i++)
					fillers.push(
						await say(
							`We stroll along the market lane, ordinary moment ${i}.`,
							i % 2 ? "assistant" : "user",
						),
					);
				await a.chat.setScene({
					roomId: room.id,
					startAt: at(fillers[0] ?? secret),
					audience: witnessed,
				});
				await sync(a, b);

				const reconcileBoth = async () => {
					for (const [p, port] of [
						[a, engines.a],
						[b, engines.b],
					] as const)
						await reconcileConversation(port, p.chat, room.id);
				};
				const ask = async (
					p: Peer,
					port: AfterstatePort,
					query: string,
					unscoped = false,
				) => {
					const messages = await p.chat.listAllMessages(room.id);
					return (
						await recallForTurn(port, {
							roomId: room.id,
							...recallRequestFor(messages.slice(-8), [], query),
							messages,
							scenes: await p.chat.listScenes(room.id),
							...(unscoped
								? { unscoped: true, characterPolicy: false as const }
								: {}),
						})
					).passages.map((x) => ({
						id: x.id,
						text: x.text,
						audience: x.audience,
					}));
				};
				const KEY_Q = "Where did Kai bury the quicksilver key?";
				const UMBRELLA_Q = "Where does the vermilion umbrella hide?";

				await reconcileBoth();
				const keyOnA = await ask(a, engines.a, KEY_Q);
				expect(await ask(b, engines.b, KEY_Q)).toEqual(keyOnA);
				expect(keyOnA.map((x) => x.id)).toContain(secret.id);
				expect(keyOnA.find((x) => x.id === secret.id)?.audience).toBe(
					"participants",
				);
				/* The hidden (narrator) scene is indexed — unscoped recall finds it — but no one recalls it. */
				expect(
					(await ask(b, engines.b, UMBRELLA_Q, true)).map((x) => x.id),
				).toContain(hidden.id);
				expect(await ask(a, engines.a, UMBRELLA_Q)).toEqual([]);
				expect(await ask(b, engines.b, UMBRELLA_Q)).toEqual([]);

				/* A deletes the private scene: its message becomes unknown history, which a room with scenes
				 * does not recall. The change reaches B only through sync. */
				await a.chat.deleteScene(privateScene?.id ?? "");
				await sync(a, b);
				await reconcileBoth();
				expect((await ask(a, engines.a, KEY_Q)).map((x) => x.id)).not.toContain(
					secret.id,
				);
				expect(await ask(b, engines.b, KEY_Q)).toEqual(
					await ask(a, engines.a, KEY_Q),
				);

				/* A deletes the room: B's sweep erases the index from the tombstone sync delivered. */
				await a.chat.deleteRoom(room.id);
				await sync(a, b);
				for (const [p, port] of [
					[a, engines.a],
					[b, engines.b],
				] as const) {
					const swept = await sweepDeletedRooms(port, p.chat);
					expect(swept.orphaned).toBe(1);
					const raw = await port.call<{ evidence: unknown[] }>("recall", {
						conversation: room.id,
						query: KEY_Q,
						visible: { story: true, ooc: true, notes: true },
						limit: 16,
					});
					expect(raw.evidence).toEqual([]);
				}
			} finally {
				await engines.a.close();
				await engines.b.close();
			}
		});
	},
);
