import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
	type AfterstateHostOptions,
	AfterstateHosts,
	AfterstateWorker,
	afterstateIpc,
} from "./afterstate-host.ts";

const artifactDir = resolve(
	process.env.AFTERSTATE_WASM_DIR ?? ".afterstate-wasm",
);
const workerEntry = new URL("../dist/afterstate-worker.mjs", import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "rowcat-wasm-host-"));
const live: AfterstateHosts[] = [];
// OS-key wrapping is injected. Real safeStorage is exercised by packaged Electron smoke tests.
const keys = {
	available: async () => true,
	wrap: async (s: string) => Buffer.from(s),
	unwrap: async (b: Buffer) => b.toString(),
};
const make = (name: string, extra: Partial<AfterstateHostOptions> = {}) => {
	const host = new AfterstateHosts({
		artifactDir,
		workerEntry,
		storeDir: join(dir, name),
		keys,
		...extra,
	});
	live.push(host);
	return host;
};
const item = (
	id = "m1",
	text = "Haru promised the silver compass.",
	extra = {},
) => ({
	conversation: "room",
	record: "message",
	id,
	revision: "1",
	text,
	author: { role: "character", name: "Haru" },
	at_ms: 1700000000000,
	audience: { kind: "room" },
	...extra,
});
const manifests = async (
	host: AfterstateWorker,
	items: ReturnType<typeof item>[] = [item()],
) => {
	for (const record of ["message", "note", "summary"])
		await host.call("reconcile", {
			conversation: "room",
			record,
			live:
				record === "message"
					? items.map(({ id, revision }) => ({ id, revision }))
					: [],
		});
};
const recall = (host: AfterstateWorker) =>
	host.call("recall", {
		conversation: "room",
		query: "silver compass",
		visible: { story: true },
		channels: true,
		perspective: { kind: "room" },
		character_policy: { token_budget: 8192, before_ms: 1800000000000 },
	}) as Promise<{ evidence: { id: string; text: string }[] }>;

afterAll(async () => {
	await Promise.allSettled(live.map((h) => h.closeAll()));
	rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!existsSync(join(artifactDir, "manifest.json")))(
	"real Node WASM worker",
	() => {
		it("negotiates, orders writes, isolates members, and restores encrypted exact revisions", async () => {
			const hosts = make("restart");
			await hosts.probe();
			const a = await hosts.host("alice");
			const b = await hosts.host("bob");
			await expect(recall(a)).rejects.toThrow("reconcile_required");
			await a.call("ingest", { items: [item()] });
			await manifests(a);
			await manifests(b, []);
			expect((await recall(a)).evidence[0]?.id).toBe("m1");
			expect((await recall(b)).evidence).toEqual([]);
			await a.call("checkpoint", {});
			await hosts.release("alice");
			const files = readdirSync(join(dir, "restart"));
			expect(files.some((f) => f.endsWith(".index"))).toBe(true);
			for (const file of files)
				expect(
					readFileSync(join(dir, "restart", file)).includes(
						Buffer.from("silver compass"),
					),
				).toBe(false);
			const reopened = await hosts.host("alice");
			await expect(recall(reopened)).rejects.toThrow("reconcile_required");
			await manifests(reopened);
			expect((await recall(reopened)).evidence[0]?.text).toContain(
				"silver compass",
			);
			const edited = item("m1", "Haru returned the blue umbrella.", {
				revision: "2",
			});
			await reopened.call("ingest", { items: [edited] });
			await manifests(reopened, [edited]);
			expect((await recall(reopened)).evidence).toEqual([]);
			await hosts.release("alice");
			const afterEdit = await hosts.host("alice");
			await manifests(afterEdit, [edited]);
			expect((await recall(afterEdit)).evidence).toEqual([]);
			await hosts.destroy("alice");
			expect(
				readdirSync(join(dir, "restart")).filter((f) => f.endsWith(".index")),
			).toHaveLength(0);
		});
		it("rebuilds a corrupt derived snapshot and removes deleted evidence before recall", async () => {
			let recoveries = 0;
			const hosts = make("corrupt", { onRecovery: () => recoveries++ });
			let a = await hosts.host("alice");
			await a.call("ingest", { items: [item()] });
			await manifests(a);
			await hosts.release("alice");
			const file = readdirSync(join(dir, "corrupt")).find((f) =>
				f.endsWith(".index"),
			) as string;
			writeFileSync(join(dir, "corrupt", file), randomBytes(80));
			a = await hosts.host("alice");
			expect(recoveries).toBe(1);
			await expect(recall(a)).rejects.toThrow("reconcile_required");
			await manifests(a, []);
			expect((await recall(a)).evidence).toEqual([]);
			await a.call("ingest", { items: [item()] });
			await a.call("erase", {
				conversation: "room",
				record: "message",
				ids: ["m1"],
			});
			await hosts.release("alice");
			a = await hosts.host("alice");
			await manifests(a, []);
			expect((await recall(a)).evidence).toEqual([]);
		});
		it("keeps ingestion and erasure ordered while authentication is pending", async () => {
			const hosts = make("auth-order");
			const gate = Promise.withResolvers<void>();
			const entered = Promise.withResolvers<void>();
			let checks = 0;
			const ipc = afterstateIpc(
				hosts,
				() => "http://localhost:12345",
				async () => {
					if (++checks === 1) {
						entered.resolve();
						await gate.promise;
					}
					return true;
				},
			);
			const event = { senderFrame: { url: "http://localhost:12345/" } };
			const first = ipc.call(event, "alice", "ingest", { items: [item()] });
			const erased = ipc.call(event, "alice", "erase", {
				conversation: "room",
			});
			const late = ipc.call(event, "alice", "ingest", { items: [item()] });
			await entered.promise;
			expect(checks).toBe(1);
			gate.resolve();
			const [initial, , last] = (await Promise.all([first, erased, late])) as [
				{ items: { status: string }[] },
				unknown,
				{ items: { status: string }[] },
			];
			expect(initial.items[0].status).toBe("created");
			expect(last.items[0].status).toBe("fenced");
		});
		it("requires secure key storage, rejects foreign members/origins and native lifecycle ops", async () => {
			await expect(
				make("unavailable", {
					keys: { ...keys, available: async () => false },
				}).host("a"),
			).rejects.toThrow("secure storage unavailable");
			const hosts = make("ipc");
			const ipc = afterstateIpc(
				hosts,
				() => "http://localhost:12345",
				async (_e, m) => m === "alice",
			);
			for (const url of [
				"https://localhost:12345/",
				"http://localhost:12345.evil.example/",
				"data:text/plain,no",
				"http://localhost:12346/",
			])
				await expect(
					ipc.call({ senderFrame: { url } }, "alice", "status", {}),
				).rejects.toThrow("refused origin");
			await expect(
				ipc.call(
					{ senderFrame: { url: "http://localhost:12345/" } },
					"bob",
					"status",
					{},
				),
			).rejects.toThrow("refused member");
			for (const op of ["open", "close", "destroy", "__destroy"])
				await expect(
					ipc.call(
						{ senderFrame: { url: "http://localhost:12345/" } },
						"alice",
						op,
						{},
					),
				).rejects.toThrow("unknown op");
			await expect(
				ipc.call(
					{ senderFrame: { url: "http://localhost:12345/", parent: {} } },
					"alice",
					"status",
					{},
				),
			).rejects.toThrow("refused origin");
		});
		it("fails missing/corrupt packages and recovers from memory-pressure retirement", async () => {
			await expect(
				make("missing", { artifactDir: join(dir, "absent") }).probe(),
			).rejects.toThrow("initialization");
			const hosts = make("pressure", { memoryLimitBytes: 1 });
			const worker = await hosts.host("a");
			await expect(worker.call("status", {})).rejects.toThrow(
				"memory_pressure",
			);
			await worker.whenExited;
			expect((await hosts.host("a")).threadId).not.toBe(worker.threadId);
		});
	},
);

it("bounds queued work, times out a silent worker, and can close during initialization", async () => {
	const entry = join(dir, "silent.mjs");
	writeFileSync(
		entry,
		'import {parentPort} from "node:worker_threads";parentPort.postMessage({ready:true,protocol:"afterstate-bridge/1"});parentPort.on("message",()=>{});',
	);
	const worker = new AfterstateWorker({
		artifactDir: "unused",
		snapshot: null,
		workerEntry: pathToFileURL(entry),
		timeouts: { openTimeoutMs: 1000, callTimeoutMs: 150, closeTimeoutMs: 50 },
	});
	await worker.open();
	const pending = Array.from({ length: 40 }, () =>
		worker.call("status", {}).catch((e: Error) => e.message),
	);
	const results = await Promise.all(pending);
	expect(results.filter((r) => r === "afterstate: queue full")).toHaveLength(8);
	expect(results.filter((r) => r === "afterstate: timeout")).toHaveLength(32);
	await worker.whenExited;
	writeFileSync(
		entry,
		'import {parentPort} from "node:worker_threads";parentPort.on("message",()=>{});',
	);
	const opening = new AfterstateWorker({
		artifactDir: "unused",
		snapshot: null,
		workerEntry: pathToFileURL(entry),
		timeouts: { openTimeoutMs: 1000, callTimeoutMs: 1000, closeTimeoutMs: 30 },
	});
	const start = Date.now();
	await opening.close().catch(() => {});
	expect(Date.now() - start).toBeLessThan(500);
});

it("restarts a crashed worker, applies the restart circuit breaker, and survives isolate OOM", async () => {
	const entry = join(dir, "crash.mjs");
	writeFileSync(
		entry,
		'import {parentPort} from "node:worker_threads";parentPort.postMessage({ready:true,protocol:"afterstate-bridge/1"});parentPort.on("message",()=>process.exit(7));',
	);
	let now = 100000;
	const hosts = make("crashes", {
		workerEntry: pathToFileURL(entry),
		now: () => now,
	});
	const ids = new Set<number>();
	for (let i = 0; i < 3; i++) {
		const worker = await hosts.host("alice");
		ids.add(worker.threadId);
		await expect(worker.call("status", {})).rejects.toThrow(/worker/);
		await worker.whenExited;
	}
	expect(ids.size).toBe(3);
	await expect(hosts.host("alice")).rejects.toThrow("unavailable");
	now += 60001;
	const recovered = await hosts.host("alice");
	await recovered.kill();
	writeFileSync(
		entry,
		'import {parentPort} from "node:worker_threads";parentPort.postMessage({ready:true,protocol:"afterstate-bridge/1"});parentPort.on("message",()=>{const retained=[];for(let i=0;i<100;i++)retained.push(new Array(1000000).fill(i));});',
	);
	const oom = new AfterstateWorker({
		artifactDir: "unused",
		snapshot: null,
		workerEntry: pathToFileURL(entry),
	});
	await oom.open();
	await expect(oom.call("status", {})).rejects.toThrow(/worker/);
	await oom.whenExited;
	expect(oom.running).toBe(false);
}, 20000);

it("removes only the retiring member's legacy derived SQLite files", async () => {
	const legacy = join(dir, "legacy");
	mkdirSync(legacy);
	const hash = createHash("sha256")
		.update("afterstate-ffi/user/v1\0alice")
		.digest("hex")
		.slice(0, 32);
	const file = join(legacy, `afterstate-${hash}.db`);
	for (const suffix of ["", "-wal", "-shm", "-journal"])
		writeFileSync(file + suffix, "synthetic old derived text");
	writeFileSync(join(legacy, "unrelated.db"), "unrelated");
	const hosts = make("legacy-cleanup", { legacyStoreDir: legacy });
	await hosts.destroy("alice");
	expect(readdirSync(legacy)).toEqual(["unrelated.db"]);
});

it("times out a stalled OS keychain and cancels initialization on shutdown", async () => {
	const stalled = { ...keys, available: () => new Promise<boolean>(() => {}) };
	const hosts = make("key-timeout", {
		keys: stalled,
		timeouts: { openTimeoutMs: 40, callTimeoutMs: 100, closeTimeoutMs: 40 },
	});
	await expect(hosts.host("alice")).rejects.toThrow("initialization timeout");
	const closing = make("key-closing", { keys: stalled });
	const pending = closing.host("alice");
	const result = pending.catch((e: Error) => e.message);
	await closing.closeAll();
	expect(await result).toContain("closing");
	const switching = make("key-switch", { keys: stalled });
	for (let i = 0; i < 4; i++) {
		const cancelled = switching.host("alice").catch((e: Error) => e.message);
		await switching.release("alice");
		expect(await cancelled).toContain("closing");
	}
	stalled.available = async () => true;
	expect((await switching.host("alice")).threadId).toBeGreaterThan(0);
});
