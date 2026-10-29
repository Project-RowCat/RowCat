import { defineConfig } from "vitest/config";

/**
 * Mobile test config. **No React Native and no simulator are started.**
 *
 * What is verified here is whether the SQLite adapter keeps the shared port contracts (`ChatStore`,
 * `AuthoringStore`, `SyncStore`). That can be checked without a screen. SQL does run for real: the
 * tests plug Node 22's `node:sqlite` into the same driver port (`src/test/sqlite-node.ts`), so the
 * adapter code runs unchanged. A test that passes against a mock SQLite does not prove the native
 * database works, so that claim is handled by simulator QA (the runtime QA section of `README.md`).
 *
 * So this config has no polyfills. Modules that import `expo-sqlite` or `expo-secure-store` do not
 * enter the test graph. If they did, native modules would have to be faked, and code that passed
 * against the fake would break on a device first.
 */
export default defineConfig({
	test: {
		include: [
			"src/**/*.test.ts",
			"src/**/*.test.tsx",
			/** The pure layer of the release tooling (`scripts/ota/`), code that never enters the app bundle. */
			"scripts/**/*.test.ts",
		],
		/**
		 * One process per file. An open SQLite connection is a file-scoped resource. If one file's
		 * cleanup closed a connection another file opened, the failure would appear and disappear
		 * depending on execution order.
		 */
		isolate: true,
	},
});
