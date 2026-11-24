/** Runs under the packaged Electron executable with ELECTRON_RUN_AS_NODE=1.
 * No server, account, network, source checkout or persistent data is used. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { AfterstateWorker } from "./afterstate-host.ts";

const artifactDir = resolve(process.argv[2] ?? "");
if (!process.argv[2])
	throw new Error("usage: afterstate-smoke <artifact-directory>");
const worker = new AfterstateWorker({ artifactDir, snapshot: null });
try {
	await worker.open();
	const status = (await worker.call("status", {})) as { protocol: string };
	assert.equal(status.protocol, "afterstate-bridge/1");
	await worker.call("ingest", {
		items: [
			{
				conversation: "smoke",
				record: "message",
				id: "promise",
				revision: "1",
				text: "I promised a silver compass.",
				at_ms: 1_700_000_000_000,
				author: { role: "character", name: "Haru" },
				audience: { kind: "room" },
				narrative: { arc: "compass", kind: "promise", basis: "stated" },
			},
			{
				conversation: "smoke",
				record: "message",
				id: "private",
				revision: "1",
				text: "The silver compass hides a secret.",
				at_ms: 1_700_000_000_000,
				author: { role: "character", name: "Haru" },
				audience: { kind: "participants", members: ["other"] },
			},
		],
	});
	for (const record of ["message", "note", "summary"])
		await worker.call("reconcile", {
			conversation: "smoke",
			record,
			live:
				record === "message"
					? [
							{ id: "promise", revision: "1" },
							{ id: "private", revision: "1" },
						]
					: [],
		});
	const recalled = (await worker.call("recall", {
		conversation: "smoke",
		query: "silver compass",
		visible: { story: true },
		channels: true,
		perspective: { kind: "participants", members: ["haru"] },
		character_policy: { token_budget: 8192, before_ms: 1_800_000_000_000 },
	})) as { evidence: { id: string }[] };
	assert.ok(recalled.evidence.some((e) => e.id === "promise"));
	assert.ok(recalled.evidence.every((e) => e.id !== "private"));
	await worker.call("erase", {
		conversation: "smoke",
		record: "message",
		ids: ["promise"],
	});
	const verified = (await worker.call("verify", {})) as { ok: boolean };
	assert.equal(verified.ok, true);
	console.log(
		JSON.stringify({
			protocol: status.protocol,
			packagedWorker: "passed",
			privacy: "passed",
			erasure: "passed",
		}),
	);
} finally {
	await worker.close();
}
