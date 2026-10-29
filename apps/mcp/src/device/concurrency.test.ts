import { randomBytes } from "node:crypto";
import {
	authoringSyncCodecs,
	createDraftRuntimeFileRecord,
	createDraftRuntimeProjectRecord,
	createStoryDraftRecord,
} from "@rowcat/authoring";
import type {
	PullResponse,
	PushRequest,
	PushResponse,
} from "@rowcat/contracts/sync";
import { RUNTIME_AI_CORPUS } from "@rowcat/runtime-ai-docs";
import type { RuntimeMcpContext } from "@rowcat/runtime-mcp";
import {
	createRuntimeFile,
	deleteRuntimeFile,
	readRuntimeFile,
	writeRuntimeFile,
} from "@rowcat/runtime-mcp";
import { createNodeRuntimeMcpHost } from "@rowcat/runtime-mcp/node";
import type { SyncTransport } from "@rowcat/sync";
import { encryptRecord, nobleAead } from "@rowcat/sync";
import { beforeEach, describe, expect, test } from "vitest";
import { createDevice, type Device } from "./device.ts";

/**
 * Two devices touching the same file must not overwrite a value changed after the read. What is
 * verified is the order of the round trip, not a single-value rule, so the only double is the
 * server, carrying just the real semantics (per-member monotonic seq, batch atomicity,
 * `baseVersion` optimistic concurrency). The devices are the product's wiring from `createDevice`,
 * and operations go through the same `@rowcat/runtime-mcp` functions the tools call; a copy would
 * go stale first.
 */

const OWNER = "member-a";
const DRAFT = "draft-1";
const DEK = new Uint8Array(randomBytes(32));
const STAMP = "2026-01-01T00:00:00.000Z";

interface Row {
	readonly id: string;
	readonly type: string;
	ciphertext: string | null;
	version: number;
	seq: number;
	deleted: boolean;
	updatedAt: string;
}

/**
 * In-memory server carrying only the real server's semantics. Its correctness is checked separately
 * by `apps/api`'s sync tests against real Postgres; this is a double to run two clients on one
 * state.
 */
class FakeServer {
	private readonly rows = new Map<string, Row>();
	private seq = 0;
	/** Runs once just before a push reaches the server, creating the race between decision and push. */
	interceptPush: (() => Promise<void>) | null = null;
	/** Until cleared, push fails with this value, which also runs the engine's retries. */
	failPush: unknown | null = null;

	private key(type: string, id: string): string {
		return `${type} ${id}`;
	}

	put(type: string, id: string, ciphertext: string): void {
		this.seq += 1;
		this.rows.set(this.key(type, id), {
			id,
			type,
			ciphertext,
			version: 1,
			seq: this.seq,
			deleted: false,
			updatedAt: STAMP,
		});
	}

	current(type: string, id: string): Row | null {
		return this.rows.get(this.key(type, id)) ?? null;
	}

	async pull(since: number): Promise<PullResponse> {
		const records = [...this.rows.values()]
			.filter((row) => row.seq > since)
			.sort((left, right) => left.seq - right.seq);
		return {
			records: records.map((row) => ({
				id: row.id,
				type: row.type,
				ciphertext: row.ciphertext,
				envelope: 1,
				version: row.version,
				seq: row.seq,
				deleted: row.deleted,
				serverUpdatedAt: row.updatedAt,
			})),
			cursor: records.at(-1)?.seq ?? since,
			hasMore: false,
		};
	}

	async push(input: PushRequest): Promise<PushResponse> {
		if (this.failPush !== null) throw this.failPush;
		if (this.interceptPush !== null) {
			const hook = this.interceptPush;
			this.interceptPush = null;
			await hook();
		}
		const conflicts = input.items
			.filter(
				(item) =>
					(this.rows.get(this.key(item.type, item.id))?.version ?? 0) !==
					item.baseVersion,
			)
			.map((item) => ({
				id: item.id,
				serverVersion:
					this.rows.get(this.key(item.type, item.id))?.version ?? 0,
			}));
		// A batch applies whole or is rejected whole; partial application is not representable.
		if (conflicts.length > 0) return { ok: false, cursor: this.seq, conflicts };
		for (const item of input.items) {
			this.seq += 1;
			this.rows.set(this.key(item.type, item.id), {
				id: item.id,
				type: item.type,
				ciphertext: item.ciphertext,
				version: item.baseVersion + 1,
				seq: this.seq,
				deleted: item.deleted,
				updatedAt: STAMP,
			});
		}
		return { ok: true, cursor: this.seq, conflicts: [] };
	}
}

const unusable = (name: string) => (): never => {
	throw new Error(`this test does not call ${name}`);
};

const transportFor = (server: FakeServer): SyncTransport =>
	({
		pull: (input: { since: number }) => server.pull(input.since),
		push: (input: PushRequest) => server.push(input),
		getKeyring: unusable("getKeyring"),
		setupKeyring: unusable("setupKeyring"),
		rewrapKeyring: unusable("rewrapKeyring"),
		resetKeyring: unusable("resetKeyring"),
		verifyKeyring: unusable("verifyKeyring"),
		startPairing: unusable("startPairing"),
		readPairing: unusable("readPairing"),
		approvePairing: unusable("approvePairing"),
		cancelPairing: unusable("cancelPairing"),
	}) as unknown as SyncTransport;

const codecFor = (type: string) => {
	const codec = authoringSyncCodecs.find((entry) => entry.type === type);
	if (codec === undefined) throw new Error(`no codec: ${type}`);
	return codec;
};

const SEED_REV = { t: 1, c: 0, d: "seed" };
const stamp = (id: string) => ({ id, now: STAMP, rev: SEED_REV });

/** Seeds one record on the server using the product's envelope crypto. */
async function seed(
	server: FakeServer,
	type: string,
	record: { readonly id: string },
): Promise<void> {
	const codec = codecFor(type);
	const ciphertext = await encryptRecord(
		DEK,
		{ owner: OWNER, recordId: record.id, type },
		{
			schemaVersion: codec.schemaVersion,
			rev: SEED_REV,
			deletedAt: null,
			data: codec.encode(record as never),
		},
		nobleAead,
	);
	server.put(type, record.id, ciphertext);
}

const FILE_ID = "file-main";

/** Seeded records come from the product's creation functions; hand-written shapes drift from the codec. */
async function seedProject(server: FakeServer, content: string): Promise<void> {
	await seed(
		server,
		"authoring.draft",
		createStoryDraftRecord({ title: "Test draft" }, stamp(DRAFT)),
	);
	await seed(
		server,
		"authoring.runtimeProject",
		createDraftRuntimeProjectRecord(
			{ draftId: DRAFT },
			{ now: STAMP, rev: SEED_REV },
		),
	);
	await seed(
		server,
		"authoring.runtimeFile",
		createDraftRuntimeFileRecord(
			{ draftId: DRAFT, path: "src/main.tsx", content },
			stamp(FILE_ID),
		),
	);
}

const host = createNodeRuntimeMcpHost();

const contextFor = (device: Device): RuntimeMcpContext => ({
	authoring: device.authoring,
	host,
	corpus: RUNTIME_AI_CORPUS,
});

let server: FakeServer;
let alice: Device;
let bob: Device;
let contextA: RuntimeMcpContext;
let contextB: RuntimeMcpContext;

const openDevices = async (): Promise<void> => {
	alice = createDevice({
		owner: OWNER,
		dek: DEK,
		transport: transportFor(server),
	});
	bob = createDevice({
		owner: OWNER,
		dek: DEK,
		transport: transportFor(server),
	});
	await alice.sync();
	await bob.sync();
	contextA = contextFor(alice);
	contextB = contextFor(bob);
};

beforeEach(async () => {
	server = new FakeServer();
	await seedProject(server, "first");
	await openDevices();
});

const read = (context: RuntimeMcpContext, path = "src/main.tsx") =>
	readRuntimeFile(context, DRAFT, path);

describe("optimistic concurrency", () => {
	test("does not overwrite when another device edited after reading", async () => {
		const seen = await read(contextA);
		expect(seen.content).toBe("first");

		await writeRuntimeFile(contextB, {
			draftId: DRAFT,
			path: "src/main.tsx",
			content: "Bob's value",
		});

		await expect(
			writeRuntimeFile(contextA, {
				draftId: DRAFT,
				path: "src/main.tsx",
				content: "Alice's value",
				expectedHash: seen.hash,
			}),
		).rejects.toMatchObject({ code: "file_conflict" });

		// Bob's value survives, and the failed response carries the current value's hash.
		const after = await read(contextA);
		expect(after.content).toBe("Bob's value");
		await expect(
			writeRuntimeFile(contextA, {
				draftId: DRAFT,
				path: "src/main.tsx",
				content: "x",
				expectedHash: seen.hash,
			}),
		).rejects.toMatchObject({ details: { hash: after.hash } });
	});

	test("writing with the latest fingerprint passes", async () => {
		const seen = await read(contextA);
		const written = await writeRuntimeFile(contextA, {
			draftId: DRAFT,
			path: "src/main.tsx",
			content: "Alice's value",
			expectedHash: seen.hash,
		});
		expect(written.path).toBe("src/main.tsx");
		await bob.sync();
		expect((await read(contextB)).content).toBe("Alice's value");
	});

	// The race between decision and push, a window a single pull cannot close. The server rejects by
	// optimistic concurrency and that rejection surfaces instead of being swallowed by convergence.
	test("does not beat an edit that slipped in between the decision and the push", async () => {
		const seen = await read(contextA);
		server.interceptPush = async () => {
			await writeRuntimeFile(contextB, {
				draftId: DRAFT,
				path: "src/main.tsx",
				content: "what Bob wrote in between",
			});
		};

		await expect(
			writeRuntimeFile(contextA, {
				draftId: DRAFT,
				path: "src/main.tsx",
				content: "Alice's value",
				expectedHash: seen.hash,
			}),
		).rejects.toMatchObject({ code: "file_conflict" });

		expect((await read(contextA)).content).toBe("what Bob wrote in between");
	});

	// An undone write must not ride up on the next operation. Without the undo, the overwrite that was
	// answered as a failure would eventually happen, with nobody having asked for it then.
	test("a value withdrawn by a conflict does not come back later", async () => {
		const seen = await read(contextA);
		server.interceptPush = async () => {
			await writeRuntimeFile(contextB, {
				draftId: DRAFT,
				path: "src/main.tsx",
				content: "Bob's value",
			});
		};
		await expect(
			writeRuntimeFile(contextA, {
				draftId: DRAFT,
				path: "src/main.tsx",
				content: "a value that must vanish",
				expectedHash: seen.hash,
			}),
		).rejects.toMatchObject({ code: "file_conflict" });

		// Upload an unrelated file to run A's push once more.
		await createRuntimeFile(contextA, {
			draftId: DRAFT,
			path: "src/other.ts",
			content: "export const x = 1;\n",
		});
		await bob.sync();
		expect((await read(contextB)).content).toBe("Bob's value");
	});

	// A write without a hash has no stale-version protection, which is why the tool description always
	// recommends passing one. Pinned by value so nobody pretends otherwise and loses a manuscript.
	test("without a fingerprint it overwrites the latest value", async () => {
		await read(contextA);
		await writeRuntimeFile(contextB, {
			draftId: DRAFT,
			path: "src/main.tsx",
			content: "Bob's value",
		});
		await writeRuntimeFile(contextA, {
			draftId: DRAFT,
			path: "src/main.tsx",
			content: "Alice's value",
		});
		await bob.sync();
		expect((await read(contextB)).content).toBe("Alice's value");
	});
});

/**
 * Sync failures must not fold into one code. `file_conflict` means the version read is stale, a
 * connection problem means call again, and session expiry means calling again will not help. If all
 * three were one value the agent could only retry, which fixes just one of them.
 */
describe("branches of failure", () => {
	const failPushWith = (error: unknown): void => {
		server.failPush = error;
	};

	test("a connection problem is not a conflict", async () => {
		failPushWith(new Error("the connection dropped"));
		await expect(
			writeRuntimeFile(contextA, {
				draftId: DRAFT,
				path: "src/main.tsx",
				content: "value",
			}),
		).rejects.toMatchObject({ code: "sync_failed" });
	});

	test("an edit that couldn't be uploaded does not remain", async () => {
		failPushWith(new Error("the connection dropped"));
		await expect(
			writeRuntimeFile(contextA, {
				draftId: DRAFT,
				path: "src/main.tsx",
				content: "a value that must vanish",
			}),
		).rejects.toMatchObject({ code: "sync_failed" });

		server.failPush = null;
		await createRuntimeFile(contextA, {
			draftId: DRAFT,
			path: "src/other.ts",
			content: "export const x = 1;\n",
		});
		await bob.sync();
		expect((await read(contextB)).content).toBe("first");
	});

	// A dead session is not fixed by retrying; a person must sign in again.
	test("an expired session says it is not something to retry", async () => {
		failPushWith(Object.assign(new Error("unauthorized"), { status: 401 }));
		await expect(
			writeRuntimeFile(contextA, {
				draftId: DRAFT,
				path: "src/main.tsx",
				content: "value",
			}),
		).rejects.toMatchObject({ code: "not_authorized" });
	});

	// If the latest could not be pulled, nothing is written; the write must not pass with protection
	// off.
	test("does not write when refreshing fails", async () => {
		const broken = createDevice({
			owner: OWNER,
			dek: DEK,
			transport: {
				...transportFor(server),
				pull: () => Promise.reject(new Error("the connection dropped")),
			},
		});
		await expect(
			writeRuntimeFile(contextFor(broken), {
				draftId: DRAFT,
				path: "src/main.tsx",
				content: "value",
			}),
		).rejects.toMatchObject({ code: "sync_failed" });
	});
});

describe("create and delete", () => {
	test("a path another device created first is refused as a duplicate", async () => {
		await createRuntimeFile(contextB, {
			draftId: DRAFT,
			path: "src/extra.ts",
			content: "Bob",
		});
		await expect(
			createRuntimeFile(contextA, {
				draftId: DRAFT,
				path: "src/extra.ts",
				content: "Alice",
			}),
		).rejects.toMatchObject({ code: "duplicate_path" });
	});

	test("does not delete a file that changed after reading", async () => {
		const seen = await read(contextA);
		await writeRuntimeFile(contextB, {
			draftId: DRAFT,
			path: "src/main.tsx",
			content: "the manuscript Bob continued",
		});
		await expect(
			deleteRuntimeFile(contextA, {
				draftId: DRAFT,
				path: "src/main.tsx",
				expectedHash: seen.hash,
			}),
		).rejects.toMatchObject({ code: "file_conflict" });
		expect((await read(contextA)).content).toBe("the manuscript Bob continued");
	});
});
