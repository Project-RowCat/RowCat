import { describe, expect, it } from "vitest";
import {
	isVisibleRuntimeConversation,
	nextRuntimeConversation,
	RUNTIME_CONVERSATION_ID_PREFIX,
	type RuntimeConversationRecord,
	runtimeConversationIdFor,
	runtimeConversationPresenceAllowed,
	runtimeConversationSyncCodec,
	runtimePlayStartDue,
	runtimePlayStartSessionKey,
} from "./conversation.ts";
import {
	RUNTIME_PERSISTENT_ID_PREFIX,
	RUNTIME_PLAYTHROUGH_ID_PREFIX,
	runtimePlaythroughIdFor,
} from "./model.ts";
import { runtimePersistenceSyncCodecs } from "./sync-codec.ts";

/**
 * Runtime conversation record: identity, create and update rules, codec round-trip and winner. Pins
 * down that this record differs in kind from the two save-state records. It is library metadata,
 * its identity does not overlap with the save row for the same work, and clearing it is not a
 * tombstone.
 */

const REV = { t: 10, c: 0, d: "device-a" };

const record = (
	overrides: Partial<RuntimeConversationRecord> = {},
): RuntimeConversationRecord => ({
	id: runtimeConversationIdFor("story-1"),
	storyId: "story-1",
	slot: "default",
	title: "The Convenience Store That Rewinds the Night",
	createdAt: "2026-09-01T00:00:00.000Z",
	updatedAt: "2026-09-02T00:00:00.000Z",
	removedAt: null,
	deletedAt: null,
	dirty: 0,
	serverVersion: 1,
	rev: REV,
	...overrides,
});

describe("identity", () => {
	it("the same story and slot give the same id", () => {
		expect(runtimeConversationIdFor("story-1")).toBe(
			runtimeConversationIdFor("story-1", "default"),
		);
		expect(runtimeConversationIdFor("story-1")).toBe(
			"runtime-conversation:story-1:default",
		);
	});

	it("different stories do not collide", () => {
		expect(runtimeConversationIdFor("story-1")).not.toBe(
			runtimeConversationIdFor("story-2"),
		);
	});

	/**
	 * The server's primary key is (owner, id), so the type cannot be part of the key. Reusing the save
	 * record's id would make the two rows contend for the same row.
	 */
	it("the prefix differs from the two save records", () => {
		expect(RUNTIME_CONVERSATION_ID_PREFIX).not.toBe(
			RUNTIME_PLAYTHROUGH_ID_PREFIX,
		);
		expect(RUNTIME_CONVERSATION_ID_PREFIX).not.toBe(
			RUNTIME_PERSISTENT_ID_PREFIX,
		);
		expect(runtimeConversationIdFor("s")).not.toBe(
			runtimePlaythroughIdFor("s"),
		);
	});
});

describe("create and update", () => {
	it("the first open is createdAt = updatedAt = now with no removed mark", () => {
		expect(
			nextRuntimeConversation(null, {
				storyId: "story-1",
				title: "story",
				now: "t1",
			}),
		).toEqual({
			id: runtimeConversationIdFor("story-1"),
			storyId: "story-1",
			slot: "default",
			title: "story",
			createdAt: "t1",
			updatedAt: "t1",
			removedAt: null,
			deletedAt: null,
		});
	});

	it("reopening keeps createdAt, advances updatedAt and updates the title", () => {
		const next = nextRuntimeConversation(record(), {
			storyId: "story-1",
			title: "new title",
			now: "2026-09-03T00:00:00.000Z",
		});
		expect(next.createdAt).toBe("2026-09-01T00:00:00.000Z");
		expect(next.updatedAt).toBe("2026-09-03T00:00:00.000Z");
		expect(next.title).toBe("new title");
	});

	it("without a known title it keeps the old one, or an empty string the first time", () => {
		expect(
			nextRuntimeConversation(record(), {
				storyId: "story-1",
				title: null,
				now: "t",
			}).title,
		).toBe("The Convenience Store That Rewinds the Night");
		expect(
			nextRuntimeConversation(null, {
				storyId: "story-1",
				title: null,
				now: "t",
			}).title,
		).toBe("");
	});

	it("reopening a removed row clears the mark", () => {
		const next = nextRuntimeConversation(record({ removedAt: "t2" }), {
			storyId: "story-1",
			title: null,
			now: "t3",
		});
		expect(next.removedAt).toBeNull();
	});

	it("the predicate for visible rows is neither tombstoned nor removed", () => {
		expect(isVisibleRuntimeConversation(record())).toBe(true);
		expect(isVisibleRuntimeConversation(record({ removedAt: "t" }))).toBe(
			false,
		);
		expect(isVisibleRuntimeConversation(record({ deletedAt: "t" }))).toBe(
			false,
		);
	});
});

describe("codec", () => {
	it("it is in the registry list with a distinct type name", () => {
		const types = runtimePersistenceSyncCodecs.map((codec) => codec.type);
		expect(types).toContain("runtime.conversation");
		expect(new Set(types).size).toBe(types.length);
	});

	it("round-tripping preserves the value and carries no sync axes", () => {
		const local = record({ dirty: 1, serverVersion: 3 });
		const data = runtimeConversationSyncCodec.encode(local) as Record<
			string,
			unknown
		>;
		expect(Object.keys(data).sort()).toEqual([
			"createdAt",
			"removedAt",
			"slot",
			"storyId",
			"title",
			"updatedAt",
		]);
		const decoded = runtimeConversationSyncCodec.decode({
			id: local.id,
			schemaVersion: 1,
			rev: local.rev,
			deletedAt: null,
			data,
		});
		expect(decoded).toEqual({ ...local, dirty: 0, serverVersion: 0 });
	});

	it("a payload off the shape is null", () => {
		expect(
			runtimeConversationSyncCodec.decode({
				id: "x",
				schemaVersion: 1,
				rev: REV,
				deletedAt: null,
				data: { storyId: "s", slot: "other", title: "t" },
			}),
		).toBeNull();
		expect(
			runtimeConversationSyncCodec.decode({
				id: "x",
				schemaVersion: 1,
				rev: REV,
				deletedAt: null,
				data: null,
			}),
		).toBeNull();
	});

	/** Whole-record LWW: clearing and reopening converge deterministically under one rule. */
	it("the higher revision wins wholesale and inherits the local dirty and serverVersion", () => {
		const local = record({
			removedAt: "t2",
			dirty: 1,
			serverVersion: 4,
			rev: { t: 20, c: 0, d: "a" },
		});
		const remote = record({
			title: "remote title",
			removedAt: null,
			rev: { t: 21, c: 0, d: "b" },
		});
		const merged = runtimeConversationSyncCodec.merge(local, remote);
		expect(merged.remoteWins).toBe(true);
		expect(merged.record).toEqual({ ...remote, dirty: 1, serverVersion: 4 });

		const older = runtimeConversationSyncCodec.merge(
			local,
			record({ rev: { t: 19, c: 0, d: "b" } }),
		);
		expect(older.remoteWins).toBe(false);
		expect(older.record).toBe(local);
	});
});

describe("the condition for a library row to stand", () => {
	it("true only with an entitlement-verified runtime response and a settled title", () => {
		expect(
			runtimeConversationPresenceAllowed({
				playbackKind: "runtime",
				storyResolved: true,
			}),
		).toBe(true);
		expect(
			runtimeConversationPresenceAllowed({
				playbackKind: "runtime",
				storyResolved: false,
			}),
		).toBe(false);
		/**
		 * A missing work, no entitlement, a required purchase and a corrupt response are all the same
		 * thing: an absent response.
		 */
		expect(
			runtimeConversationPresenceAllowed({
				playbackKind: null,
				storyResolved: true,
			}),
		).toBe(false);
		expect(
			runtimeConversationPresenceAllowed({
				playbackKind: "chat",
				storyResolved: true,
			}),
		).toBe(false);
	});
});

describe("play start telemetry", () => {
	it("the session key is the library row's id as is: the basis for once per account", () => {
		expect(runtimePlayStartSessionKey("story-1")).toBe(
			runtimeConversationIdFor("story-1"),
		);
		expect(runtimePlayStartSessionKey("story-1", "default")).toBe(
			runtimePlayStartSessionKey("story-1"),
		);
	});

	it("reports only when the session really runs and has not reported yet", () => {
		expect(runtimePlayStartDue({ running: true, reported: false })).toBe(true);
		expect(runtimePlayStartDue({ running: false, reported: false })).toBe(
			false,
		);
		expect(runtimePlayStartDue({ running: true, reported: true })).toBe(false);
	});
});
