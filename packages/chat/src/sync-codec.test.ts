import type { Rev } from "@rowcat/contracts/sync";
import { describe, expect, it } from "vitest";
import type { ChatMemory } from "./memory.ts";
import type { ChatMessage, ChatRoom, ChatSeed } from "./model.ts";
import { CHAT_PERSONA_NAME_MAX_LENGTH, type ChatPersona } from "./persona.ts";
import type { ChatSummary } from "./summary.ts";
import {
	CHAT_MERGE_NOTE,
	CHAT_SYNC_SCHEMA_VERSION,
	chatMemorySyncCodec,
	chatMessageSyncCodec,
	chatPersonaSyncCodec,
	chatRoomSyncCodec,
	chatSummarySyncCodec,
	chatSyncCodecs,
} from "./sync-codec.ts";

/**
 * Codec tests for the payload boundary and per-type merge rules. The two-device round-trip test
 * checks convergence. This file checks the contract beneath it: what is and is not carried in the
 * payload, and what happens when an unknown shape arrives.
 */

const rev = (t: number, d = "device-a"): Rev => ({ t, c: 0, d });

const seed = (): ChatSeed => ({
	version: 1,
	storyId: "story-1",
	title: "스냅샷",
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "시나리오",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
});

const room = (patch: Partial<ChatRoom> = {}): ChatRoom => ({
	id: "room-1",
	originStoryId: "story-1",
	title: "제목",
	adult: false,
	promptProtected: false,
	seed: seed(),
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 1,
	rev: rev(1000),
	...patch,
});

const message = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
	id: "message-1",
	roomId: "room-1",
	role: "assistant",
	speaker: "",
	content: "본문",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 1,
	rev: rev(1000),
	...patch,
});

const personaRecord = (patch: Partial<ChatPersona> = {}): ChatPersona => ({
	id: "persona-1",
	name: "지훈",
	description: "대학생.",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 1,
	rev: rev(1000),
	...patch,
});

const context = () => {
	const notes: string[] = [];
	return { notes, ctx: { note: (code: string) => notes.push(code) } };
};

describe("chat.room codec", () => {
	it("the payload carries no identity or transport metadata", () => {
		/**
		 * `id` is authenticated by AAD. `dirty` and `serverVersion` are the receiving device's own state,
		 * so putting them in the payload would store the same fact in two places that can diverge.
		 */
		const data = chatRoomSyncCodec.encode(room()) as Record<string, unknown>;
		expect(Object.keys(data).sort()).toEqual([
			"adult",
			"createdAt",
			"originStoryId",
			"promptProtected",
			"seed",
			"title",
			"updatedAt",
		]);
	});

	it("round-trips; outer metadata comes in as arguments", () => {
		const source = room({ title: "밤의 도서관" });
		const decoded = chatRoomSyncCodec.decode({
			id: "room-1",
			schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
			rev: source.rev,
			deletedAt: null,
			data: chatRoomSyncCodec.encode(source),
		});
		expect(decoded).toEqual({ ...source, dirty: 0, serverVersion: 0 });
	});

	it("a shape off contract is **null** (does not throw)", () => {
		// Throwing would fail the whole page because of one record, so ignoring is the normal path.
		expect(
			chatRoomSyncCodec.decode({
				id: "room-1",
				schemaVersion: 1,
				rev: rev(1),
				deletedAt: null,
				data: { title: 42 },
			}),
		).toBeNull();
	});

	it("immutable fields keep the local value even when the remote is newer", () => {
		const local = room({ rev: rev(1000) });
		const remote = room({
			rev: rev(2000, "device-b"),
			title: "원격 제목",
			seed: { ...seed(), title: "다른 스냅샷" },
			createdAt: "2020-01-01T00:00:00.000Z",
		});
		const { ctx, notes } = context();
		const merged = chatRoomSyncCodec.merge(local, remote, ctx);

		expect(merged.record.title).toBe("원격 제목");
		expect(merged.record.seed).toEqual(local.seed);
		expect(merged.record.createdAt).toBe(local.createdAt);
		expect(notes).toContain(CHAT_MERGE_NOTE.roomImmutableDivergence);
	});

	it("`updatedAt` is the max: the losing side's activity stays in the list", () => {
		const local = room({
			rev: rev(1000),
			updatedAt: "2026-06-01T00:00:00.000Z",
		});
		const remote = room({
			rev: rev(2000, "device-b"),
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const merged = chatRoomSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.updatedAt).toBe("2026-06-01T00:00:00.000Z");
		// The local side contributed, so the result must be sent back.
		expect(merged.remoteWins).toBe(false);
	});

	it("nothing to send back when the remote wins as is", () => {
		const local = room({ rev: rev(1000) });
		const remote = room({ rev: rev(2000, "device-b"), title: "원격" });
		expect(
			chatRoomSyncCodec.merge(local, remote, context().ctx).remoteWins,
		).toBe(true);
	});
});

/**
 * Routing key: it must never be erased, and it must converge when the two sides differ.
 *
 * If it is erased, each upload from an old client resets the room's cache locality. If it does not
 * converge, the two devices overwrite each other's value and the room record ping-pongs forever.
 * Neither produces an error; the cost shows up only on the bill.
 */
describe("chat.room codec · routing session", () => {
	const decodeRoom = (data: unknown) =>
		chatRoomSyncCodec.decode({
			id: "room-1",
			schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
			rev: rev(1000),
			deletedAt: null,
			data,
		});

	/**
	 * A room payload created on an old schema is byte-identical to one from before this key existed.
	 */
	it("omits the key when absent", () => {
		const payload = chatRoomSyncCodec.encode(room()) as Record<string, unknown>;
		expect(payload).not.toHaveProperty("routingSessionId");
	});

	it("included when present and returned as is", () => {
		const payload = chatRoomSyncCodec.encode(
			room({ routingSessionId: "routing-a" }),
		) as Record<string, unknown>;
		expect(payload.routingSessionId).toBe("routing-a");
		expect(decodeRoom(payload)?.routingSessionId).toBe("routing-a");
	});

	/**
	 * Rejecting a payload from a client that does not know this key would stop the whole room from
	 * arriving.
	 */
	it("accepts payloads without the key as is", () => {
		const decoded = decodeRoom(chatRoomSyncCodec.encode(room()));
		expect(decoded).not.toBeNull();
		expect(decoded?.routingSessionId).toBeUndefined();
		expect("routingSessionId" in (decoded ?? {})).toBe(false);
	});

	/**
	 * Even when a device that does not know this axis wins, the value must not be erased. That device
	 * would issue a new key on its next turn, and while any old client stays on the account, the
	 * room's cache locality would reset forever.
	 */
	it("not erased when the winner lacks the key", () => {
		const local = room({ routingSessionId: "routing-a", rev: rev(1000) });
		const remote = room({ rev: rev(2000, "device-b") });
		const merged = chatRoomSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.routingSessionId).toBe("routing-a");
		/**
		 * Something must be sent back. If `remoteWins` were true, this value would never reach the
		 * server.
		 */
		expect(merged.remoteWins).toBe(false);
	});

	/**
	 * Only one side is filled (an old room). The answer must match when the call runs in the reverse
	 * direction too.
	 */
	it("takes the value when only the remote has it", () => {
		const local = room({ rev: rev(2000) });
		const remote = room({
			routingSessionId: "routing-b",
			rev: rev(1000, "device-b"),
		});
		const merged = chatRoomSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.routingSessionId).toBe("routing-b");
	});

	/**
	 * When both sides are filled, they must converge. Filling the same old-schema room independently
	 * on two devices is a normal path. If each kept its own value, the room record would ping-pong
	 * forever. The test checks that both devices reach the same value from their own side.
	 */
	it("when both have it, both devices reach the same value", () => {
		const a = room({
			routingSessionId: "routing-a",
			rev: rev(1000, "device-a"),
		});
		const b = room({
			routingSessionId: "routing-b",
			rev: rev(2000, "device-b"),
		});
		const onA = chatRoomSyncCodec.merge(a, b, context().ctx);
		const onB = chatRoomSyncCodec.merge(b, a, context().ctx);
		expect(onA.record.routingSessionId).toBe("routing-b");
		expect(onB.record.routingSessionId).toBe("routing-b");
	});

	/** If the values match, there is nothing to send back. Every merge must not produce a push. */
	it("the server copy wins as is when the values are equal", () => {
		const local = room({ routingSessionId: "routing-a", rev: rev(1000) });
		const remote = room({
			routingSessionId: "routing-a",
			rev: rev(2000, "device-b"),
		});
		expect(
			chatRoomSyncCodec.merge(local, remote, context().ctx).remoteWins,
		).toBe(true);
	});
});

describe("chat.room codec · persona override", () => {
	const decodeRoom = (data: unknown) =>
		chatRoomSyncCodec.decode({
			id: "room-1",
			schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
			rev: rev(1000),
			deletedAt: null,
			data,
		});

	/**
	 * The payload must be byte-identical to the one from before this axis existed, so the ciphertext
	 * already on the server and the new ciphertext mean the same value.
	 */
	it("omits the key without an override", () => {
		const payload = chatRoomSyncCodec.encode(room()) as Record<string, unknown>;
		expect(payload).not.toHaveProperty("persona");
	});

	it("with an override only the value rides: there is no slot for a library id", () => {
		const payload = chatRoomSyncCodec.encode(
			room({ persona: { name: "지훈", description: "대학생." } }),
		) as Record<string, unknown>;
		expect(payload.persona).toEqual({ name: "지훈", description: "대학생." });
	});

	it("an override with unknown keys refuses the whole record", () => {
		const payload = chatRoomSyncCodec.encode(room()) as Record<string, unknown>;
		expect(
			decodeRoom({
				...payload,
				persona: { name: "지훈", description: "", personaId: "p1" },
			}),
		).toBeNull();
	});

	/**
	 * A payload from an old version has no such key. Rejecting it would stop the whole room from
	 * arriving.
	 */
	it("accepts payloads without the key as is", () => {
		const payload = chatRoomSyncCodec.encode(room()) as Record<string, unknown>;
		const decoded = decodeRoom(payload);
		expect(decoded).not.toBeNull();
		expect(decoded?.persona).toBeUndefined();
	});

	it("the later version's override wins", () => {
		const local = room({
			persona: { name: "지훈", description: "" },
			rev: rev(1000),
		});
		const remote = room({
			persona: { name: "레이", description: "" },
			rev: rev(2000, "device-b"),
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		const merged = chatRoomSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.persona).toEqual({ name: "레이", description: "" });
	});

	/**
	 * Clearing an override is expressed by the absence of the key (`applyRoomPersona`). Writing `null`
	 * would give the same fact two record shapes, which shows up only as applying the same page twice
	 * producing different results.
	 */
	it("when one side cleared the override and is newer, the cleared state wins", () => {
		const local = room({
			persona: { name: "지훈", description: "" },
			rev: rev(1000),
		});
		const remote = room({ persona: null, rev: rev(2000, "device-b") });
		const merged = chatRoomSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.persona).toBeUndefined();
		expect("persona" in merged.record).toBe(false);
	});
});

describe("chat.room codec · user note", () => {
	const decodeRoom = (data: unknown) =>
		chatRoomSyncCodec.decode({
			id: "room-1",
			schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
			rev: rev(1000),
			deletedAt: null,
			data,
		});

	/** The payload must be byte-identical to the pre-axis one. Same rule as persona and narration. */
	it("omits the key without a note", () => {
		expect(chatRoomSyncCodec.encode(room())).not.toHaveProperty("userNote");
		expect(chatRoomSyncCodec.encode(room({ userNote: "" }))).not.toHaveProperty(
			"userNote",
		);
	});

	it("when written, rides as the string as is", () => {
		const payload = chatRoomSyncCodec.encode(
			room({ userNote: "묘사를 짧게." }),
		) as Record<string, unknown>;
		expect(payload.userNote).toBe("묘사를 짧게.");
	});

	/**
	 * A payload from an old version has no such key. Rejecting it would stop the whole room from
	 * arriving.
	 */
	it("accepts payloads without the key as is", () => {
		const decoded = decodeRoom(chatRoomSyncCodec.encode(room()));
		expect(decoded).not.toBeNull();
		expect(decoded?.userNote).toBeUndefined();
	});

	/**
	 * Warning: rejecting by length here would erase the whole room. The storage path enforces the cap,
	 * and the assembler deterministically folds over-long values so they cannot reach the prompt.
	 */
	it("does not refuse the record when a note over the cap arrives", () => {
		const payload = chatRoomSyncCodec.encode(room()) as Record<string, unknown>;
		const decoded = decodeRoom({ ...payload, userNote: "가".repeat(9_999) });
		expect(decoded).not.toBeNull();
		expect(decoded?.userNote).toHaveLength(9_999);
	});

	/**
	 * An empty string means no note. An empty string left by an old version must not come back as a
	 * key.
	 */
	it("a payload holding an empty string becomes a record without the key", () => {
		const payload = chatRoomSyncCodec.encode(room()) as Record<string, unknown>;
		const decoded = decodeRoom({ ...payload, userNote: "" });
		expect(decoded).not.toBeNull();
		expect("userNote" in (decoded ?? {})).toBe(false);
	});

	it("the later version's note wins", () => {
		const local = room({ userNote: "여기는 반말로.", rev: rev(1000) });
		const remote = room({
			userNote: "여기는 존댓말로.",
			rev: rev(2000, "device-b"),
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		const merged = chatRoomSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.userNote).toBe("여기는 존댓말로.");
	});

	/**
	 * Clearing is expressed by the absence of the key (`applyRoomUserNote`), as with narration. Unlike
	 * the routing key, an erase on another device must win here, because this is text the user wrote.
	 * Keeping it would resurrect notes the user deleted.
	 */
	it("when one side cleared it and is newer, the cleared state wins", () => {
		const local = room({ userNote: "예전 값", rev: rev(1000) });
		const remote = room({ rev: rev(2000, "device-b") });
		const merged = chatRoomSyncCodec.merge(local, remote, context().ctx);
		expect("userNote" in merged.record).toBe(false);
	});

	/** Concatenating two values would inject instructions that neither user wrote into every turn. */
	it("does not merge the two values", () => {
		const local = room({ userNote: "A", rev: rev(2000, "device-b") });
		const remote = room({ userNote: "B", rev: rev(1000) });
		const merged = chatRoomSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.userNote).toBe("A");
	});
});

describe("chat.message codec", () => {
	it("optional fields **do not ride when the key is absent**", () => {
		/**
		 * Explicitly setting `undefined` mixes "unspecified" with "no value". The three-state rule is a
		 * lesson the legacy code learned at high cost, and this is where it shows up.
		 */
		const data = chatMessageSyncCodec.encode(message()) as Record<
			string,
			unknown
		>;
		expect("model" in data).toBe(false);
		expect("incomplete" in data).toBe(false);

		const full = chatMessageSyncCodec.encode(
			message({ model: "gpt", incomplete: true, inputTokens: 3 }),
		) as Record<string, unknown>;
		expect(full.model).toBe("gpt");
		expect(full.incomplete).toBe(true);
		expect(full.inputTokens).toBe(3);
	});

	it("cache accounting survives a payload round trip", () => {
		/**
		 * If this axis dropped off the wire, only the other device's copy of the same message would lose
		 * its evidence. The loss is invisible (the UI does not read it), so if this test misses it,
		 * nothing will catch it.
		 */
		const source = message({
			model: "anthropic/claude-sonnet-5",
			inputTokens: 7_100,
			cachedInputTokens: 5_000,
			cacheWriteInputTokens: 2_000,
			outputTokens: 250,
		});
		const decoded = chatMessageSyncCodec.decode({
			id: source.id,
			schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
			rev: source.rev,
			deletedAt: null,
			data: chatMessageSyncCodec.encode(source),
		});
		expect(decoded).toEqual({ ...source, dirty: 0, serverVersion: 0 });
	});

	it("**old payloads** without the cache axis still decode", () => {
		/**
		 * Adding optional fields must not break compatibility. This assertion is the basis for not
		 * bumping `schemaVersion`, and every record stored on devices has this shape.
		 */
		const decoded = chatMessageSyncCodec.decode({
			id: "message-1",
			schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
			rev: rev(1000),
			deletedAt: null,
			data: {
				roomId: "room-1",
				role: "assistant",
				speaker: "",
				content: "본문",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				model: "old/model",
				inputTokens: 10,
				outputTokens: 20,
			},
		});
		expect(decoded).not.toBeNull();
		expect(decoded).toMatchObject({ model: "old/model", inputTokens: 10 });
		// Absent axes arrive absent. Filling them with 0 would make this device alone claim a cache miss.
		expect(decoded).not.toHaveProperty("cachedInputTokens");
		expect(decoded).not.toHaveProperty("cacheWriteInputTokens");
	});

	it("a complete version beats an incomplete one **regardless of HLC**", () => {
		const local = message({ rev: rev(1000) });
		const remote = message({
			rev: rev(9000, "device-b"),
			content: "끊긴",
			incomplete: true,
		});
		const { ctx, notes } = context();
		const merged = chatMessageSyncCodec.merge(local, remote, ctx);

		expect(merged.record.content).toBe("본문");
		expect(merged.remoteWins).toBe(false);
		expect(notes).toContain(CHAT_MERGE_NOTE.messageIncompleteRejected);
	});

	it("even when local wins, the revision is **at least the remote's**", () => {
		/**
		 * Sent with the old revision, the peer would treat the message as a replay, ignore it, and
		 * re-upload its own incomplete copy. The complete and incomplete copies would then swap places
		 * forever.
		 */
		const local = message({ rev: rev(1000) });
		const remote = message({ rev: rev(9000, "device-b"), incomplete: true });
		const merged = chatMessageSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.rev).toEqual(remote.rev);
	});

	it("an incomplete version loses to a complete one", () => {
		const local = message({ rev: rev(9000), incomplete: true });
		const remote = message({ rev: rev(1000, "device-b"), content: "완결" });
		const merged = chatMessageSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.content).toBe("완결");
		expect(merged.record.incomplete).toBeUndefined();
		expect(merged.remoteWins).toBe(true);
	});

	it("when both are complete, HLC decides", () => {
		const local = message({ rev: rev(1000), content: "로컬" });
		const remote = message({ rev: rev(2000, "device-b"), content: "원격" });
		expect(
			chatMessageSyncCodec.merge(local, remote, context().ctx).record.content,
		).toBe("원격");
		expect(
			chatMessageSyncCodec.merge(remote, local, context().ctx).record.content,
		).toBe("원격");
	});

	it("the same revision is the same write: not sent back", () => {
		const local = message();
		expect(
			chatMessageSyncCodec.merge(local, message(), context().ctx).remoteWins,
		).toBe(true);
	});

	it("merging does not overwrite transport metadata with the remote's", () => {
		// `dirty` and `serverVersion` belong to the receiving device. The storage layer settles the final
		// value.
		const local = message({ rev: rev(1000), dirty: 1, serverVersion: 7 });
		const remote = message({
			rev: rev(2000, "device-b"),
			dirty: 0,
			serverVersion: 0,
		});
		const merged = chatMessageSyncCodec.merge(local, remote, context().ctx);
		expect(merged.record.serverVersion).toBe(7);
		expect(merged.record.dirty).toBe(1);
	});
});

const memory = (patch: Partial<ChatMemory> = {}): ChatMemory => ({
	id: "memory-1",
	roomId: "room-1",
	content: "카이는 왼손잡이다.",
	pinned: false,
	source: "user",
	originAt: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 1,
	rev: rev(1000),
	...patch,
});

const decodeMemory = (
	data: unknown,
	patch: Partial<Parameters<typeof chatMemorySyncCodec.decode>[0]> = {},
) =>
	chatMemorySyncCodec.decode({
		id: "memory-1",
		schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
		rev: rev(2000),
		deletedAt: null,
		data,
		...patch,
	});

describe("chat.memory codec · source", () => {
	/**
	 * Payloads from before this axis existed have no such key. Making it required would reject all of
	 * those records. Rejected records are skipped while the cursor advances, so those memories would
	 * never reach devices on the new schema.
	 */
	it("accepts old payloads without a source as human-written", () => {
		const decoded = decodeMemory({
			roomId: "room-1",
			content: "옛 기억",
			pinned: false,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(decoded?.source).toBe("user");
		expect(decoded?.originAt).toBeNull();
	});

	/**
	 * Writing `"user"` explicitly would express the same fact in two shapes. This assertion is the
	 * practical meaning of 'byte-identical to the pre-axis payload'.
	 */
	it("human-written memory payloads have no source key", () => {
		const encoded = chatMemorySyncCodec.encode(memory()) as Record<
			string,
			unknown
		>;
		expect(Object.keys(encoded).sort()).toEqual([
			"content",
			"createdAt",
			"pinned",
			"roomId",
			"updatedAt",
		]);
	});

	it("automatic memories carry source and origin time together", () => {
		const encoded = chatMemorySyncCodec.encode(
			memory({
				source: "auto",
				originAt: "2026-08-25T01:00:00.000Z",
				content: "짧은 사실",
			}),
		) as Record<string, unknown>;
		expect(encoded.source).toBe("auto");
		expect(encoded.originAt).toBe("2026-08-25T01:00:00.000Z");

		const decoded = decodeMemory(encoded);
		expect(decoded?.source).toBe("auto");
		expect(decoded?.originAt).toBe("2026-08-25T01:00:00.000Z");
	});

	/**
	 * If an automatic memory could reach the manual cap, this device's budget and ordering assumptions
	 * would break. The per-room cap rests on automatic memories being short.
	 */
	it("automatic memories get the narrower cap", () => {
		expect(
			decodeMemory({
				roomId: "room-1",
				content: "가".repeat(500),
				pinned: false,
				source: "auto",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
		).toBeNull();
		// The same length passes as a manually written memory.
		expect(
			decodeMemory({
				roomId: "room-1",
				content: "가".repeat(500),
				pinned: false,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
		).not.toBeNull();
	});

	/**
	 * Folding an unknown source into `"auto"` would make that record a target for automatic cleanup.
	 */
	it("a source outside the vocabulary refuses that record", () => {
		expect(
			decodeMemory({
				roomId: "room-1",
				content: "기억",
				pinned: false,
				source: "ai",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
		).toBeNull();
	});
});

/**
 * The direction of `source` (`auto` to `user` only) must also hold in merge. With a plain HLC
 * winner, one device can promote an automatic memory by editing it. A device unaware of the
 * promotion can then replace it with an automatic sentence, and if that write is later on the
 * clock, the human edit reverts to automatic.
 */
describe("chat.memory codec · merge", () => {
	const promoted = memory({
		content: "카이는 사실 오른손잡이다.",
		source: "user",
		dirty: 1,
		rev: rev(100, "device-a"),
	});
	const replaced = memory({
		content: "카이는 왼손으로 칼을 쥔다.",
		source: "auto",
		originAt: "2026-08-25T01:00:00.000Z",
		rev: rev(101, "device-b"),
	});

	it("a promoted local beats a late automatic replacement; the revision is at least both", () => {
		const merged = chatMemorySyncCodec.merge(promoted, replaced, context().ctx);
		expect(merged.record.content).toBe(promoted.content);
		expect(merged.record.source).toBe("user");
		expect(merged.record.rev).toEqual(replaced.rev);
		/**
		 * This version is not on the server yet. It must be re-uploaded so the other device also reaches
		 * the same answer.
		 */
		expect(merged.remoteWins).toBe(false);
	});

	it("the opposite device reaches the same answer", () => {
		const merged = chatMemorySyncCodec.merge(
			{ ...replaced, dirty: 1 },
			{ ...promoted, dirty: 0 },
			context().ctx,
		);
		expect(merged.record.content).toBe(promoted.content);
		expect(merged.record.source).toBe("user");
		expect(merged.record.rev).toEqual(replaced.rev);
		expect(merged.remoteWins).toBe(false);
	});

	it("with the same source it is the ordinary HLC winner", () => {
		const later = memory({ content: "나중", rev: rev(2000, "device-b") });
		const merged = chatMemorySyncCodec.merge(memory(), later, context().ctx);
		expect(merged.record.content).toBe("나중");
		expect(merged.remoteWins).toBe(true);
	});
});

/* ══════════════════════════════════════════════════════════════════════════
 * chat.summary
 * ══════════════════════════════════════════════════════════════════════════ */

const summary = (patch: Partial<ChatSummary> = {}): ChatSummary => ({
	id: "room-1",
	roomId: "room-1",
	summary: "지금까지의 이야기.",
	frontier: { createdAt: "2026-01-01T00:00:00.000Z", messageId: "m10" },
	epoch: 0,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 0,
	serverVersion: 1,
	rev: rev(1000),
	...patch,
});

describe("chat.summary codec", () => {
	it("round-tripping preserves the value", () => {
		const record = summary();
		const decoded = chatSummarySyncCodec.decode({
			id: "room-1",
			schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
			rev: rev(2000),
			deletedAt: null,
			data: chatSummarySyncCodec.encode(record),
		});
		expect(decoded?.summary).toBe(record.summary);
		expect(decoded?.frontier).toEqual(record.frontier);
		expect(decoded?.epoch).toBe(0);
	});

	/** Identity comes from the envelope, not from the payload's `roomId`. */
	it("identity is the envelope's id", () => {
		const decoded = chatSummarySyncCodec.decode({
			id: "room-1",
			schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
			rev: rev(2000),
			deletedAt: null,
			data: chatSummarySyncCodec.encode(summary({ roomId: "room-1" })),
		});
		expect(decoded?.id).toBe("room-1");
	});

	/**
	 * Rejecting a summary means that room's summary never reaches this device. Another device would
	 * resend it only when maintenance runs again on that room.
	 */
	it("a long summary folds rather than being refused", () => {
		const decoded = chatSummarySyncCodec.decode({
			id: "room-1",
			schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
			rev: rev(2000),
			deletedAt: null,
			data: chatSummarySyncCodec.encode(
				summary({ summary: "가".repeat(9_000) }),
			),
		});
		expect(decoded).not.toBeNull();
		expect([...(decoded?.summary ?? "")].length).toBeLessThanOrEqual(2_000);
	});

	it("refuses a half frontier", () => {
		expect(
			chatSummarySyncCodec.decode({
				id: "room-1",
				schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
				rev: rev(2000),
				deletedAt: null,
				data: {
					roomId: "room-1",
					summary: "S",
					frontier: { createdAt: "2026-01-01T00:00:00.000Z" },
					epoch: 0,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			}),
		).toBeNull();
	});

	/**
	 * Merge builds its order from this value. With negative or fractional numbers mixed in, the
	 * comparison is still a total order but no longer means generation, so the rewind-wins rule would
	 * depend on chance.
	 */
	it("folds negative and fractional epochs to integers", () => {
		const decode = (epoch: number) =>
			chatSummarySyncCodec.decode({
				id: "room-1",
				schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
				rev: rev(2000),
				deletedAt: null,
				data: {
					roomId: "room-1",
					summary: "S",
					frontier: null,
					epoch,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			});
		expect(decode(-3)?.epoch).toBe(0);
		expect(decode(2.7)?.epoch).toBe(2);
	});

	/**
	 * The schema rejects `NaN` first. The record is ignored entirely and the cursor still advances.
	 */
	it("refuses records with a NaN epoch", () => {
		expect(
			chatSummarySyncCodec.decode({
				id: "room-1",
				schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
				rev: rev(2000),
				deletedAt: null,
				data: {
					roomId: "room-1",
					summary: "S",
					frontier: null,
					epoch: Number.NaN,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			}),
		).toBeNull();
	});

	/**
	 * With HLC alone, a later advance would win and the summary of a conversation the user deleted
	 * would come back. That state does not heal on its own.
	 */
	it("a rewind (higher epoch) beats a later advance", () => {
		const local = summary({
			summary: "",
			frontier: null,
			epoch: 1,
			rev: rev(1000),
		});
		const remote = summary({
			summary: "지워진 사건이 담긴 요약",
			epoch: 0,
			rev: rev(9000),
		});
		const { ctx } = context();
		const merged = chatSummarySyncCodec.merge(local, remote, ctx);
		expect(merged.remoteWins).toBe(false);
		expect(merged.record.summary).toBe("");
		expect(merged.record.frontier).toBeNull();
	});

	/** Otherwise a device holding an old rewind would reverse every later advance forever. */
	it("within the same epoch it is the ordinary HLC final winner", () => {
		const local = summary({ summary: "옛 요약", epoch: 1, rev: rev(1000) });
		const remote = summary({ summary: "새 요약", epoch: 1, rev: rev(9000) });
		const { ctx } = context();
		expect(chatSummarySyncCodec.merge(local, remote, ctx).record.summary).toBe(
			"새 요약",
		);
	});

	/**
	 * Sent with an old revision, the peer would ignore it as a replay and re-upload its own version.
	 */
	it("the revision rises even when local wins", () => {
		const local = summary({ epoch: 2, rev: rev(1000) });
		const remote = summary({ epoch: 1, rev: rev(9000) });
		const { ctx } = context();
		const merged = chatSummarySyncCodec.merge(local, remote, ctx);
		expect(merged.record.rev.t).toBe(9000);
	});
});

describe("chat.persona codec", () => {
	const decodeInput = (data: unknown, at = 1000) => ({
		id: "persona-1",
		schemaVersion: CHAT_SYNC_SCHEMA_VERSION,
		rev: rev(at),
		deletedAt: null,
		data,
	});

	it("the payload is just four fields: no identity or transport metadata", () => {
		const payload = chatPersonaSyncCodec.encode(personaRecord()) as Record<
			string,
			unknown
		>;
		expect(Object.keys(payload).sort()).toEqual([
			"createdAt",
			"description",
			"name",
			"updatedAt",
		]);
	});

	it("carries no room id: a persona is not a child of the room", () => {
		const payload = chatPersonaSyncCodec.encode(personaRecord()) as Record<
			string,
			unknown
		>;
		expect(payload).not.toHaveProperty("roomId");
	});

	it("round-tripping gives the same record", () => {
		const record = personaRecord();
		const decoded = chatPersonaSyncCodec.decode(
			decodeInput(chatPersonaSyncCodec.encode(record)),
		);
		expect(decoded).toEqual({ ...record, dirty: 0, serverVersion: 0 });
	});

	/**
	 * The name predicate must also count code points. A `z.string().max()` schema would count UTF-16
	 * units, reject this name, and the persona would never reach the receiving device.
	 */
	it("does not refuse a name filling the cap exactly with emoji", () => {
		const name = "🙂".repeat(CHAT_PERSONA_NAME_MAX_LENGTH);
		const decoded = chatPersonaSyncCodec.decode(
			decodeInput(chatPersonaSyncCodec.encode(personaRecord({ name }))),
		);
		expect(decoded?.name).toBe(name);
	});

	it("refuses payloads that break the rules", () => {
		expect(
			chatPersonaSyncCodec.decode(
				decodeInput({
					name: "  ",
					description: "",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
			),
		).toBeNull();
	});

	it("the ordinary HLC final winner", () => {
		const local = personaRecord({ name: "지훈", rev: rev(1000), dirty: 1 });
		const remote = personaRecord({ name: "레이", rev: rev(2000, "device-b") });
		const merged = chatPersonaSyncCodec.merge(local, remote, context().ctx);
		expect(merged.remoteWins).toBe(true);
		expect(merged.record.name).toBe("레이");
		/* Transport metadata belongs to the receiving device, so it does not follow the remote value. */
		expect(merged.record.dirty).toBe(1);
	});

	it("the local stays when it is newer", () => {
		const local = personaRecord({ name: "지훈", rev: rev(3000) });
		const remote = personaRecord({ name: "레이", rev: rev(2000, "device-b") });
		const merged = chatPersonaSyncCodec.merge(local, remote, context().ctx);
		expect(merged.remoteWins).toBe(false);
		expect(merged.record.name).toBe("지훈");
	});
});

describe("codec list", () => {
	/**
	 * Order is the outbound collection order, so new types go at the end to keep in-progress
	 * collection cursors valid.
	 */
	it("new types are appended at the end", () => {
		expect(chatSyncCodecs.map((codec) => codec.type)).toEqual([
			"chat.room",
			"chat.message",
			"chat.memory",
			"chat.summary",
			"chat.persona",
			"chat.character",
		]);
	});
});
