import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	runtimeConversationStoreContract,
	runtimeSaveStoreContract,
} from "./store-contract.ts";
import {
	createMemoryConversationStore,
	createMemorySaveStore,
} from "./testing.ts";

/**
 * Dependencies this package must not have, locked by value. The header sentence alone does not keep
 * them out. The risky line is importing the root of @rowcat/runtime-host. It would pull the QuickJS
 * engine and the generated sandbox string into the web and mobile storage layers, with no symptom
 * other than bundle size.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const sources = async (): Promise<{ path: string; text: string }[]> => {
	const names = await readdir(HERE);
	const files: { path: string; text: string }[] = [];
	for (const name of names) {
		if (!name.endsWith(".ts")) continue;
		files.push({ path: name, text: await readFile(join(HERE, name), "utf8") });
	}
	return files;
};

const productionSources = async (): Promise<{ path: string; text: string }[]> =>
	(await sources()).filter(
		(file) =>
			!file.path.endsWith(".test.ts") &&
			file.path !== "testing.ts" &&
			file.path !== "store-contract.ts",
	);

describe("layer boundaries", () => {
	it("does not bring in runtime-host's root: only the snapshot subpaths", async () => {
		for (const file of await sources()) {
			expect(file.text, file.path).not.toMatch(/from "@rowcat\/runtime-host"/);
			for (const match of file.text.matchAll(
				/from "@rowcat\/runtime-host\/([^"]+)"/g,
			))
				expect(
					["story-state", "persistent-state"],
					`${file.path} → ${match[1]}`,
				).toContain(match[1]);
		}
	});

	it("brings in no platform, transport or UI", async () => {
		const forbidden = [
			/from "dexie"/,
			/from "react/,
			/from "expo/,
			/from "@rowcat\/sdk/,
			/from "@rowcat\/query/,
			/from "@rowcat\/sync/,
			/from "@rowcat\/authoring/,
			/from "@rowcat\/chat/,
			/from "@rowcat\/runtime-compiler/,
			/from "@rowcat\/runtime-renderer/,
			/\bfetch\s*\(/,
			/\bindexedDB\b/,
			/\bwindow\b/,
			/\bdocument\b/,
			/\blocalStorage\b/,
		];
		for (const file of await productionSources())
			for (const pattern of forbidden)
				expect(pattern.test(file.text), `${file.path} — ${pattern}`).toBe(
					false,
				);
	});

	/**
	 * Creates no path that sends data to the server. This layer knows only the local record shape and
	 * the merge rules. Encryption, transport and cursors belong to the existing sync (§20).
	 */
	it("there is no server save path vocabulary", async () => {
		for (const file of await productionSources())
			for (const pattern of [
				/runtime-save/,
				/["`]\/v2\//,
				/POST\s/,
				/\baxios\b/,
			])
				expect(pattern.test(file.text), `${file.path} — ${pattern}`).toBe(
					false,
				);
	});

	/**
	 * Does not depend on generation or billing. Those must not become entangled with capability
	 * families (§81).
	 */
	it("knows nothing of generation or payment", async () => {
		for (const file of await productionSources())
			for (const pattern of [/useGeneration/, /churu/i, /billing/i])
				expect(pattern.test(file.text), `${file.path} — ${pattern}`).toBe(
					false,
				);
	});

	/**
	 * §117: never put the maker's values into logs. Snapshots are the player's progress, and the words
	 * inside them were chosen by the maker. Diagnostics need the kind of failure, not its value. One
	 * leaked line would turn the log into a copy of someone else's conversation history.
	 */
	it("writes no logs", async () => {
		for (const file of await productionSources())
			expect(/\bconsole\s*\./.test(file.text), file.path).toBe(false);
	});
});

/**
 * The memory implementation also passes the same contract suite. Running that suite against all
 * three adapters (memory, Dexie, SQLite) is the point of this file: it shows early whether the
 * contract is actually checkable.
 */
runtimeSaveStoreContract({
	name: "memory",
	async create() {
		const store = createMemorySaveStore({ initialSyncDone: true });
		return {
			store,
			reopen: async () => store,
			dispose: async () => {},
		};
	},
});

/** The memory implementation of the library metadata also passes the same contract suite. */
runtimeConversationStoreContract({
	name: "memory",
	async create() {
		const store = createMemoryConversationStore();
		return {
			store,
			async reopen() {
				return store;
			},
			async dispose() {},
		};
	},
});
