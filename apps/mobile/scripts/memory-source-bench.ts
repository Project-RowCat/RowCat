// Offline source-validation benchmark on the app's SQLite store under Node.
import { sourceLookupSql } from "../src/lib/local-data/chat-store.ts";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { seed } from "../src/test/fixtures.ts";
import {
	createTempDirectory,
	createMemorySecureStorage,
	createTestScopeController,
} from "../src/test/sqlite-node.ts";

async function main() {
	const output = process.argv[2];
	if (!output) throw Error("Pass a JSON output path.");
	const temp = createTempDirectory();
	const controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const stats = (samples: number[]) => {
		const sorted = samples.sort((a, b) => a - b);
		const at = (q: number) => sorted[Math.ceil(q * sorted.length) - 1];
		return {
			n: sorted.length,
			p50: at(0.5),
			p95: at(0.95),
			p99: at(0.99),
			max: at(1),
		};
	};
	async function times(work: () => Promise<unknown>, n: number) {
		const samples: number[] = [];
		for (let i = 0; i < n + 2; i++) {
			const start = performance.now();
			await work();
			if (i >= 2) samples.push(performance.now() - start);
		}
		return stats(samples);
	}
	try {
		const {
			db,
			stores: { chat },
		} = await controller.activate("synthetic-source-bench");
		const reports = [];
		for (const n of [1000, 10000, 50000, 100000]) {
			const room = await chat.createRoom({
				originStoryId: null,
				seed: seed("synthetic benchmark"),
			});
			await db.run(
				`WITH RECURSIVE seq(i) AS(SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<?)
			INSERT INTO chat_message(id,room_id,role,speaker,content,created_at,updated_at,dirty,server_version,rev_t,rev_c,rev_d)
			SELECT printf('%s-%06d',?,i),?,'user','Speaker',printf('Indexed source %d',i),
			strftime('%Y-%m-%dT%H:%M:%fZ',1700000000+i,'unixepoch'),strftime('%Y-%m-%dT%H:%M:%fZ',1700000000+i,'unixepoch'),0,0,i,0,'synthetic' FROM seq`,
				[n, room.id, room.id],
			);
			const ids = Array.from(
				{ length: 64 },
				(_, i) =>
					`${room.id}-${String(1 + Math.floor((i * (n - 1)) / 64)).padStart(6, "0")}`,
			);
			if (!chat.getMessagesByIds || !chat.listFollowingMessages)
				throw Error("indexed readers missing");
			const byId = chat.getMessagesByIds.bind(chat);
			const following = chat.listFollowingMessages.bind(chat);
			assert.equal(await chat.countMessages(room.id), n);
			const targeted = await times(async () => {
				const [rows, neighbors] = await Promise.all([
					byId(room.id, ids),
					following(room.id, ids[0] ?? "", 2),
				]);
				assert.equal(rows.length, 64);
				assert.equal(neighbors.length, 2);
			}, 60);
			const full = await times(
				async () =>
					assert.equal((await chat.listAllMessages(room.id)).length, n),
				8,
			);
			// Change the oldest record without reindexing. The authoritative lookup must see it immediately.
			const first = ids[0] ?? "";
			await chat.updateMessage(first, { content: "corrected source" });
			assert.equal(
				(await byId(room.id, [first]))[0]?.content,
				"corrected source",
			);
			await db.run(
				"UPDATE chat_message SET deleted_at = updated_at WHERE id=?",
				[first],
			);
			assert.equal((await byId(room.id, [first])).length, 0);
			const plan = await db.all<{ detail: string }>(
				`EXPLAIN QUERY PLAN ${sourceLookupSql(ids.length)}`,
				[...ids, room.id],
			);
			reports.push({
				messages: n,
				unit: "ms",
				targeted,
				full,
				plan: plan.map((r) => r.detail),
				editDeletionChecks: true,
			});
		}
		writeFileSync(
			output,
			JSON.stringify(
				{
					runtime: process.version,
					storage: "Node SQLite using RowCat mobile ChatStore",
					reports,
				},
				null,
				2,
			) + "\n",
		);
	} finally {
		await controller.release();
		temp.dispose();
	}
}
void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
