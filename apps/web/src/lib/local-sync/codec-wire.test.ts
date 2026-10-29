import { authoringSyncCodecs } from "@rowcat/authoring";
import { chatSyncCodecs } from "@rowcat/chat";
import { SyncRecordType } from "@rowcat/contracts/sync";
import { runtimePersistenceSyncCodecs } from "@rowcat/runtime-persistence";
import { describe, expect, it } from "vitest";
import { syncCodecRegistry } from "./registry.ts";
import { SYNC_STORE_TABLE_ORDER } from "./store.ts";

/**
 * Locks in that every record type this device can send passes the wire contract.
 *
 * This leaked before. authoring.sceneImage failed the lowercase predicate of SyncRecordType, so
 * every push batch carrying it got a 400 (sync_record_invalid). Batches are atomic, so the
 * conversations and drafts riding in the same batch were rejected too. The engine does not treat
 * 400 as retryable, so that account's sync stopped uploading entirely from then on.
 *
 * It stayed silent because types do not check string literals, codec tests compare type names
 * against values they wrote themselves, and server tests only see well-formed requests they built.
 * The only place where the two values meet is a running browser.
 *
 * The location follows codec-order.test.ts: only the assembly point can import the domain packages
 * and the contract at the same time.
 */
describe("sync type vocabulary", () => {
	const types = [
		...chatSyncCodecs,
		...authoringSyncCodecs,
		...runtimePersistenceSyncCodecs,
	].map((c) => c.type);

	it("every type a codec exports passes the contract", () => {
		const rejected = types.filter((t) => !SyncRecordType.safeParse(t).success);
		expect(rejected).toEqual([]);
	});

	it("types do not repeat", () => {
		expect(new Set(types).size).toBe(types.length);
	});
});

/**
 * Checks that the assembly point registers every domain codec. Outbound collection walks
 * TABLE_ORDER, and encoding goes through the registry. If a codec is written but not registered
 * here, its table's rows are collected and then toOutbound returns null, so they drop out silently.
 * Two-device tests show that as 'this feature just does not sync', which goes unnoticed until
 * someone reproduces it.
 */
describe("assembly point", () => {
	it("the registry has every codec of the three domains", () => {
		for (const codec of [
			...chatSyncCodecs,
			...authoringSyncCodecs,
			...runtimePersistenceSyncCodecs,
		])
			expect(syncCodecRegistry.get(codec.type), codec.type).not.toBeNull();
	});

	/**
	 * The registry's type list and the store's table order must match exactly. Both directions fail
	 * silently: a codec without a table means its rows are never collected, and a table without a
	 * codec means collected rows fail to encode.
	 */
	it("the registry vocabulary matches the store table", () => {
		expect([...syncCodecRegistry.types()].sort()).toEqual(
			[...SYNC_STORE_TABLE_ORDER].sort(),
		);
	});
});
