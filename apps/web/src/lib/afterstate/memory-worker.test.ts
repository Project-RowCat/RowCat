import { Afterstate } from "afterstate-wasm/node";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryWorkerHandler } from "./memory-worker.ts";

const engines: Afterstate[] = [];
afterEach(() => {
	for (const engine of engines.splice(0)) engine.free();
});

function handler() {
	return createMemoryWorkerHandler(async () => {
		const engine = new Afterstate();
		engines.push(engine);
		return engine;
	});
}

const item = {
	conversation: "room",
	record: "message",
	id: "m1",
	revision: "1",
	text: "서울에서 파란 우산을 찾았어요.",
	author: { role: "user", name: "Rowan" },
	at_ms: 1_700_000_000_000,
};
const query = { conversation: "room", query: "서울", visible: { story: true } };

it("keeps ingest, recall and erase in arrival order while WASM initializes", async () => {
	const call = handler();
	const results = await Promise.all([
		call({ id: 1, op: "ingest", params: { items: [item] } }),
		call({ id: 2, op: "recall", params: query }),
		call({ id: 3, op: "erase", params: { conversation: "room" } }),
		call({ id: 4, op: "recall", params: query }),
	]);
	expect(results[0]).toMatchObject({ id: 1, ok: true });
	expect(results[1]).toMatchObject({
		id: 2,
		ok: true,
		result: { evidence: [{ id: "m1" }] },
	});
	expect(results[2]).toMatchObject({ id: 3, ok: true });
	expect(results[3]).toMatchObject({
		id: 4,
		ok: true,
		result: { evidence: [] },
	});
	expect(engines).toHaveLength(1);
});

it("separate worker engines cannot read another member's records", async () => {
	const alice = handler();
	const bob = handler();
	await alice({ id: 1, op: "ingest", params: { items: [item] } });
	expect(await bob({ id: 2, op: "recall", params: query })).toMatchObject({
		result: { evidence: [] },
	});
	expect(await alice({ id: 3, op: "recall", params: query })).toMatchObject({
		result: { evidence: [{ id: "m1" }] },
	});
});

it("a rejected protocol operation does not stop later requests", async () => {
	const call = handler();
	expect(
		await call({ id: 1, op: "ingest", params: { items: "invalid" } }),
	).toMatchObject({ id: 1, ok: false });
	expect(await call({ id: 2, op: "status", params: {} })).toMatchObject({
		id: 2,
		ok: true,
	});
});

it("does not expose a loading exception or repeatedly initialize a broken engine", async () => {
	const open = vi.fn(async () => {
		throw new Error("private record content");
	});
	const call = createMemoryWorkerHandler(open);
	for (const id of [1, 2]) {
		const response = await call({ id, op: "status", params: {} });
		expect(response).toMatchObject({
			id,
			ok: false,
			error: { code: "engine" },
		});
		expect(JSON.stringify(response)).not.toContain("private record");
	}
	expect(open).toHaveBeenCalledTimes(1);
});
