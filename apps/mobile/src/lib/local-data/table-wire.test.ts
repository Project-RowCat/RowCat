import { authoringSyncCodecs } from "@rowcat/authoring";
import { chatSyncCodecs } from "@rowcat/chat";
import { SyncRecordType } from "@rowcat/contracts/sync";
import { runtimePersistenceSyncCodecs } from "@rowcat/runtime-persistence";
import { describe, expect, it } from "vitest";
import { syncCodecRegistry } from "../local-sync/registry.ts";
import { TABLE_ORDER, tableOf } from "./tables.ts";

/**
 * Locks that every type this app can send passes the wire contract.
 *
 * The web has a counterpart (`local-sync/codec-wire.test.ts`). Each app keeps its own
 * `TABLE_ORDER`, so locking only one leaves the other's vocabulary open, and the failure appears
 * only in that app: the server rejects the whole batch with 400, the engine does not retry 400, and
 * that device's sync halts (`authoring.sceneImage` did exactly this).
 */
describe("sync type vocabulary", () => {
	it("every type this app sends passes the contract", () => {
		const rejected = TABLE_ORDER.filter(
			(t) => !SyncRecordType.safeParse(t).success,
		);
		expect(rejected).toEqual([]);
	});
});

/**
 * Checks that the assembly point includes every domain codec. The web has the matching check.
 *
 * Each app keeps its own registry and `TABLE_ORDER`, so locking only one leaves the other open. The
 * omission then shows only as "this feature does not sync on the phone".
 */
describe("assembly point", () => {
	it("the registry has the codecs of all three domains", () => {
		for (const codec of [
			...chatSyncCodecs,
			...authoringSyncCodecs,
			...runtimePersistenceSyncCodecs,
		])
			expect(syncCodecRegistry.get(codec.type), codec.type).not.toBeNull();
	});

	it("the registry's vocabulary equals the store's table", () => {
		expect([...syncCodecRegistry.types()].sort()).toEqual(
			[...TABLE_ORDER].sort(),
		);
	});

	/** Every type resolves to a real table; if any resolves to `null`, its rows silently drop out. */
	it("every type resolves to a table", () => {
		for (const type of TABLE_ORDER) expect(tableOf(type), type).not.toBeNull();
	});
});
