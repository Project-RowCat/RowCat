import { checkRuntimePath, normalizeRuntimePath } from "@rowcat/authoring";
import {
	escapesProjectRoot,
	isReservedProjectPath,
	normalizeProjectPath,
} from "@rowcat/runtime-compiler";
import { describe, expect, it } from "vitest";

/**
 * The path rule exists as two copies, and this file verifies that they agree.
 *
 * - @rowcat/authoring holds the authoring record rules and pulls in contracts, domain, and zod.
 * - @rowcat/runtime-compiler is a pure compiler. Importing authoring would carry that weight
 *   along when the server runs the same validation at publish time.
 *
 * So each side keeps a narrow copy, and this test checks that the overlapping parts are truly
 * equal. The same pattern already exists for compareRev, which lives in three copies compared by
 * codec-order.test.ts. Only the assembly point can import both packages.
 *
 * The overlap is normalization (whitespace, backslashes, repeated slashes, leading ./) and
 * rejecting `..`. The rest is intentionally separate: authoring asks whether a file may exist,
 * while the compiler asks where a string points.
 */

/** Inputs that both path implementations must normalize to the same result. */
const NORMALIZATION: string[] = [
	"src/main.tsx",
	"  src/main.tsx  ",
	"./src/main.tsx",
	"src//main.tsx",
	"src\\main.tsx",
	"src/./main.tsx",
	"./src/./components//counter.tsx",
	"src/../main.tsx",
	"../secret.ts",
	"",
	"/src/main.tsx",
];

describe("normalization is the same in both packages", () => {
	it.each(NORMALIZATION)("%j", (input) => {
		expect(normalizeProjectPath(input)).toBe(normalizeRuntimePath(input));
	});
});

describe("neither side folds `..`", () => {
	/**
	 * If normalization resolved `..`, the intent to point outside the project would be lost, and the
	 * later check would see a path that looks valid. Both implementations keep `..` so the later check
	 * can reject it.
	 */
	it("normalization keeps `..`", () => {
		expect(normalizeProjectPath("../secret.ts")).toBe("../secret.ts");
		expect(normalizeRuntimePath("../secret.ts")).toBe("../secret.ts");
	});

	it("authoring rejects it as traversal", () => {
		const check = checkRuntimePath("../secret.ts");
		expect(check.ok).toBe(false);
		if (!check.ok) expect(check.code).toBe("traversal");
	});

	it("the compiler reads it as outside the root", () => {
		expect(escapesProjectRoot("../secret.ts")).toBe(true);
		expect(escapesProjectRoot("/src/main.tsx")).toBe(true);
		expect(escapesProjectRoot("src/main.tsx")).toBe(false);
	});

	/**
	 * A path that climbs up and back down inside the root is legitimate. It is a common shape (a file
	 * in a deep folder pointing at a sibling folder) and never leaves the root.
	 */
	it("paths that go up and down within the root are not blocked", () => {
		expect(escapesProjectRoot("src/components/../state.ts")).toBe(false);
		expect(escapesProjectRoot("src/../src/main.tsx")).toBe(false);
		expect(escapesProjectRoot("src/../../main.tsx")).toBe(true);
	});
});

describe("extension decisions are the same", () => {
	/**
	 * Each package has its own `RUNTIME_SOURCE_EXTENSIONS`. If they diverge, authoring can create a
	 * file the compiler does not treat as source: it opens in the editor but silently stays out of
	 * compilation, with no error.
	 */
	it.each([
		["src/main.tsx", true],
		["src/main.ts", true],
		["src/main.js", false],
		["src/main.json", false],
		/**
		 * A file whose name is only the extension is accepted by both. The length check runs on the full
		 * path (`"src/.ts".length > ".ts".length`), so judging by the bare file name would reject it.
		 * This is recorded because the test guards equivalence, not correctness: a commit that changes
		 * only one side fails on this line.
		 */
		["src/.ts", true],
		/** A root-level `.ts` is rejected by both, because its length equals the extension's. */
		[".ts", false],
	] as const)("%s", async (path, expected) => {
		const { isRuntimeSourcePath: authoring } = await import(
			"@rowcat/authoring"
		);
		const { isRuntimeSourcePath: compiler } = await import(
			"@rowcat/runtime-compiler"
		);
		expect(compiler(path)).toBe(expected);
		expect(authoring(path)).toBe(expected);
	});
});

describe("reserved folders are the same", () => {
	/**
	 * The compiler keeps its own files under two top-level folders of the virtual file system. If
	 * authoring accepted a path there that the compiler refuses, a file could be created and edited
	 * normally and then only fail at compile; the reverse would let the compiler read a creator file as
	 * its own. Both copies must give one answer.
	 */
	it.each([
		["node_modules/x.ts", true],
		[".rowcat/entry-check.ts", true],
		["node_modules/a/b.tsx", true],
		["src/node_modules/x.ts", false],
		["src/.rowcat/x.ts", false],
		["Node_Modules/x.ts", false],
		["rowcat/x.ts", false],
		["src/main.tsx", false],
	] as const)("%s", (path, reserved) => {
		expect(isReservedProjectPath(path)).toBe(reserved);
		const check = checkRuntimePath(path);
		expect(check.ok).toBe(!reserved);
		if (!check.ok) expect(check.code).toBe("reserved");
	});
});
