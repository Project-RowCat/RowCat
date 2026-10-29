import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Server runtime code imports only `@rowcat/sync/server` (rationale in the header of
 * `packages/sync/src/server.ts`): once `decryptRecord`, `unlockWithRecovery` or `createSyncEngine`
 * enters the server bundle, "the server does not decrypt" is just a comment's promise, and one
 * import line looks like an ordinary diff in review. Test files are exempt;
 * `routes/me/sync.test.ts` plays the device side, and the claim is about the runtime bundle.
 */
/** Scans all of `src`; this file sits one level deeper, hence two `..`. */
const SRC = join(import.meta.dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
			out.push(path);
	}
	return out;
}

describe("sync server boundary", () => {
	const files = walk(SRC).filter(
		(file) => !file.includes(`${join("src", "test")}`),
	);

	test("the files to scan actually exist", () => {
		expect(files.length).toBeGreaterThan(100);
	});

	test("no runtime file takes a path of @rowcat/sync outside server", () => {
		const offenders = files.filter((file) => {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(
				/from\s+"(@rowcat\/sync(?:\/[^"]*)?)"/g,
			))
				if (match[1] !== "@rowcat/sync/server") return true;
			return false;
		});
		expect(offenders).toEqual([]);
	});
});
