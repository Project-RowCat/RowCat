import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { AfterstateHosts, afterstateIpc } from "./afterstate-host.ts";

const BRIDGE =
	process.env.AFTERSTATE_BRIDGE_BIN ??
	fileURLToPath(
		new URL(
			"../../../../../rust/afterstate/target/debug/afterstate-bridge",
			import.meta.url,
		),
	);

const WEB = "http://localhost:41234";
const dir = mkdtempSync(join(tmpdir(), "rowcat-afterstate-"));
const hosts = new AfterstateHosts(BRIDGE, dir);
const ipc = afterstateIpc(hosts, () => WEB);
const from = (url: string) => ({ senderFrame: { url } });

afterAll(async () => {
	await hosts.closeAll();
	rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!existsSync(BRIDGE))(
	`desktop afterstate host (${BRIDGE})`,
	() => {
		it("serves the web origin through the real engine, one store file per member", async () => {
			const item = {
				conversation: "room-1",
				record: "message",
				id: "m1",
				revision: "1",
				text: "등대지기의 이름은 일제다.",
				author: { role: "character", name: "카이" },
			};
			await ipc.call(from(`${WEB}/chat/room-1`), "member-a", "ingest", {
				items: [item],
			});
			const found = (await ipc.call(
				from(`${WEB}/chat/room-1`),
				"member-a",
				"recall",
				{
					conversation: "room-1",
					query: "등대지기 이름",
					visible: { story: true },
				},
			)) as { evidence: { id: string; author: { role: string } }[] };
			expect(found.evidence[0]?.id).toBe("m1");
			expect(found.evidence[0]?.author.role).toBe("character");
			const other = (await ipc.call(from(WEB), "member-b", "recall", {
				conversation: "room-1",
				query: "등대지기 이름",
				visible: { story: true },
			})) as { evidence: unknown[] };
			expect(other.evidence).toEqual([]);
			expect(readdirSync(dir).filter((f) => f.endsWith(".db"))).toHaveLength(2);
		});

		it("forwards the native hierarchy and source-validation operations", async () => {
			for (const op of ["consolidate", "digests", "facts"])
				await expect(
					ipc.call(from(WEB), "member-memory", op, { conversation: "room-1" }),
				).resolves.toBeDefined();
			await expect(
				ipc.call(from(WEB), "member-memory", "check_versions", {
					versions: { item: "v1" },
				}),
			).resolves.toEqual({
				versions: { item: expect.stringMatching(/^[a-f0-9]{12}$/) },
			});
		});

		it("refuses other origins, unknown ops and malformed arguments", async () => {
			await expect(
				ipc.call(from("http://localhost:9999/"), "member-a", "status", {}),
			).rejects.toThrow("refused origin");
			await expect(
				ipc.call(from("https://evil.example/"), "member-a", "status", {}),
			).rejects.toThrow("refused origin");
			await expect(ipc.call({}, "member-a", "status", {})).rejects.toThrow(
				"refused origin",
			);
			await expect(ipc.call(from(WEB), "member-a", "open", {})).rejects.toThrow(
				"unknown op",
			);
			await expect(ipc.call(from(WEB), "", "status", {})).rejects.toThrow(
				"bad member",
			);
			await expect(
				ipc.call(from(WEB), "member-a", "status", ["x"]),
			).rejects.toThrow("bad params");
		});

		it("destroy deletes one member's files and nothing else", async () => {
			await ipc.call(from(WEB), "member-c", "status", {});
			const before = readdirSync(dir).filter((f) => f.endsWith(".db")).length;
			await expect(
				ipc.destroy(from("https://evil.example/"), "member-c"),
			).rejects.toThrow("refused origin");
			await ipc.destroy(from(WEB), "member-c");
			expect(readdirSync(dir).filter((f) => f.endsWith(".db"))).toHaveLength(
				before - 1,
			);
		});

		it("survives a quit and reopens the same member store", async () => {
			await hosts.closeAll();
			hosts.reopen();
			const status = (await ipc.call(from(WEB), "member-a", "status", {})) as {
				memories: Record<string, number>;
			};
			expect(status.memories.active).toBe(1);
		});
	},
);

/**
 * Engines that are not the real one, as small Node scripts: the ways the bundled binary can be
 * wrong on a person's computer (Phase 12 desktop window journey, `e2e/afterstate-window.e2e.ts`).
 * These run everywhere; they need no afterstate build.
 */
describe("desktop afterstate host with a broken engine", () => {
	const fakes = mkdtempSync(join(tmpdir(), "rowcat-afterstate-fake-"));
	const spawns = join(fakes, "spawns.log");
	const fake = (name: string, body: string): string => {
		const path = join(fakes, name);
		writeFileSync(
			path,
			`#!/usr/bin/env node
require("node:fs").appendFileSync(${JSON.stringify(spawns)}, ${JSON.stringify(`${name}\n`)});
const rl = require("node:readline").createInterface({ input: process.stdin });
const reply = (id, result) => process.stdout.write(JSON.stringify({ id, ok: true, result }) + "\\n");
${body}
`,
		);
		chmodSync(path, 0o755);
		return path;
	};
	const SPEAKS = `rl.on("line", (line) => {
	const { id, op } = JSON.parse(line);
	if (op === "status") return reply(id, { protocol: "afterstate-bridge/1", memories: { active: 0 } });
	if (op === "recall" && process.env.FAKE_HANG_RECALL) return;
	reply(id, op === "open" ? { opened: true } : { evidence: [] });
});
rl.on("close", () => process.exit(0));`;
	const good = fake("good", SPEAKS);
	const hangsOnRecall = fake(
		"hangs-on-recall",
		`process.env.FAKE_HANG_RECALL = "1";\n${SPEAKS}`,
	);
	const oldProtocol = fake(
		"old-protocol",
		`rl.on("line", (line) => reply(JSON.parse(line).id, { protocol: "afterstate-bridge/0", opened: true }));`,
	);
	const silent = fake("silent", "setInterval(() => {}, 1 << 30);");
	const diesAtStart = fake("dies-at-start", "process.exit(3);");
	const notExecutable = join(fakes, "not-executable");
	writeFileSync(notExecutable, "#!/bin/sh\n");
	const store = mkdtempSync(join(tmpdir(), "rowcat-afterstate-store-"));
	const quick = { openTimeoutMs: 400, callTimeoutMs: 400, closeTimeoutMs: 400 };
	const running = (path: string): number => {
		try {
			return execFileSync("pgrep", ["-f", path], { encoding: "utf8" })
				.trim()
				.split("\n")
				.filter(Boolean).length;
		} catch {
			return 0;
		}
	};
	const spawned = (name: string): number => {
		try {
			return readFileSync(spawns, "utf8")
				.split("\n")
				.filter((l) => l === name).length;
		} catch {
			return 0;
		}
	};
	const gone = async (pid: number) => {
		for (let i = 0; i < 50; i++) {
			try {
				process.kill(pid, 0);
			} catch {
				return;
			}
			await new Promise((r) => setTimeout(r, 20));
		}
		throw new Error(`process ${pid} still running`);
	};

	afterAll(() => {
		rmSync(fakes, { recursive: true, force: true });
		rmSync(store, { recursive: true, force: true });
	});

	it("refuses an engine that speaks another protocol and leaves no process", async () => {
		// Exercise the normal handshake deadline here. The silent-child test below uses the short timer.
		const hosts = new AfterstateHosts(oldProtocol, store);
		const ipc = afterstateIpc(hosts, () => WEB);
		await expect(ipc.call(from(WEB), "m", "status", {})).rejects.toThrow(
			"afterstate open: incompatible",
		);
		expect(running(oldProtocol)).toBe(0);
		await hosts.closeAll();
	});

	it("refuses an engine that never answers, within the open timeout", async () => {
		const hosts = new AfterstateHosts(silent, store, quick);
		const started = Date.now();
		await expect(hosts.host("m")).rejects.toThrow("afterstate open: timeout");
		expect(Date.now() - started).toBeLessThan(3_000);
		expect(running(silent)).toBe(0);
		await hosts.closeAll();
	});

	it("quitting does not wait on an engine still in its handshake", async () => {
		const hosts = new AfterstateHosts(silent, store, {
			...quick,
			openTimeoutMs: 60_000,
		});
		const opening = hosts.host("m").catch((e: Error) => e.message);
		await new Promise((r) => setTimeout(r, 200));
		const started = Date.now();
		await hosts.closeAll();
		expect(Date.now() - started).toBeLessThan(3_000);
		expect(await opening).toMatch(/afterstate open/);
		expect(running(silent)).toBe(0);
		await expect(hosts.host("m")).rejects.toThrow("afterstate: closing");
	});

	it("starts a killed engine again on the next call", async () => {
		const hosts = new AfterstateHosts(good, store, quick);
		const ipc = afterstateIpc(hosts, () => WEB);
		await ipc.call(from(WEB), "m", "status", {});
		const first = (await hosts.host("m")).pid as number;
		process.kill(first, "SIGKILL");
		await gone(first);
		await new Promise((r) => setTimeout(r, 50));
		await expect(ipc.call(from(WEB), "m", "status", {})).resolves.toBeTruthy();
		const second = (await hosts.host("m")).pid as number;
		expect(second).not.toBe(first);
		await hosts.closeAll();
		expect(running(good)).toBe(0);
	});

	it("kills an engine that does not answer a call, and the next call gets a fresh one", async () => {
		const hosts = new AfterstateHosts(hangsOnRecall, store, quick);
		const ipc = afterstateIpc(hosts, () => WEB);
		const first = (await hosts.host("m")).pid as number;
		await expect(
			ipc.call(from(WEB), "m", "recall", { conversation: "c", query: "q" }),
		).rejects.toThrow("afterstate recall: timeout");
		await gone(first);
		await expect(ipc.call(from(WEB), "m", "status", {})).resolves.toBeTruthy();
		expect((await hosts.host("m")).pid).not.toBe(first);
		await hosts.closeAll();
	});

	it("a missing or non-executable engine is a rejected call, not a crash", async () => {
		for (const path of [join(fakes, "missing"), notExecutable]) {
			const hosts = new AfterstateHosts(path, store, quick);
			const ipc = afterstateIpc(hosts, () => WEB);
			await expect(ipc.call(from(WEB), "m", "status", {})).rejects.toThrow(
				"afterstate open: closed",
			);
			await hosts.closeAll();
		}
	});

	it("pauses restarts of an engine that keeps dying, then tries again", async () => {
		let now = 1_000_000;
		// The fake exits by itself; a short open timeout would race its exit on a loaded machine.
		const hosts = new AfterstateHosts(
			diesAtStart,
			store,
			{ ...quick, openTimeoutMs: 10_000 },
			() => now,
		);
		const ipc = afterstateIpc(hosts, () => WEB);
		const results: string[] = [];
		for (let i = 0; i < 5; i++)
			results.push(
				await ipc.call(from(WEB), "m", "status", {}).then(
					() => "ok",
					(e: Error) => e.message,
				),
			);
		expect(results.slice(0, 3)).toEqual(
			Array(3).fill("afterstate open: closed"),
		);
		expect(results.slice(3)).toEqual(Array(2).fill("afterstate: unavailable"));
		expect(spawned("dies-at-start")).toBe(3);
		now += 61_000;
		await expect(ipc.call(from(WEB), "m", "status", {})).rejects.toThrow(
			"afterstate open: closed",
		);
		expect(spawned("dies-at-start")).toBe(4);
		await hosts.closeAll();
	});
});
