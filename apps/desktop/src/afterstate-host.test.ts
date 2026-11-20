import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
			const status = (await ipc.call(from(WEB), "member-a", "status", {})) as {
				memories: Record<string, number>;
			};
			expect(status.memories.active).toBe(1);
		});
	},
);
