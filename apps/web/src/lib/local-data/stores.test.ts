import { afterEach, describe, expect, it } from "vitest";
import { LocalDb } from "./db.ts";
import { createLocalDataStores, STORE_READS } from "./stores.ts";

/**
 * Read-only methods at the assembly point. The wrapper treats every unknown method as a write, and
 * that default stays. This check guards against a query being left out of the list. An omitted
 * query wakes auto-sync on every call. On mobile, with screen subscriptions, that caused an endless
 * round trip (listSceneImages, listRuntimeAssets and listCharacters were each missed this way).
 */

const QUERY_NAME = /^(get|list|has|load)([A-Z]|$)/;

let counter = 0;
let db: LocalDb | null = null;

afterEach(async () => {
	await db?.delete();
	db = null;
});

describe("read list", () => {
	for (const [name, reads] of Object.entries(STORE_READS)) {
		it(`${name}: every read-named method is in the read list`, () => {
			db = new LocalDb(`stores_reads_${name}_${++counter}`);
			const stores = createLocalDataStores(db, "viewer-1");
			const store = stores[name as keyof typeof STORE_READS] as object;
			const queries = Object.entries(store)
				.filter(
					([key, value]) => typeof value === "function" && QUERY_NAME.test(key),
				)
				.map(([key]) => key);
			expect(queries.length).toBeGreaterThan(0);
			expect(
				queries.filter((key) => !(reads as ReadonlySet<string>).has(key)),
			).toEqual([]);
		});
	}
});
