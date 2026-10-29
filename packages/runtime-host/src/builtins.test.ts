import * as runtime from "@rowcat/runtime";
import * as jsxDevRuntime from "@rowcat/runtime/jsx-dev-runtime";
import * as jsxRuntime from "@rowcat/runtime/jsx-runtime";
import { describe, expect, it } from "vitest";
import { createRuntimeVmSession } from "./session.ts";
import { poc, testEngine } from "./test/fixtures.ts";

/**
 * Sandbox builtins must export the same names as the real package. If a stub drifts, an artifact
 * that compiles fails in the VM with a SyntaxError (importing a missing name), and only artifacts
 * using that name fail. The comparison runs in a real VM. Reading stub source with a regex would
 * tie the check to the stub's syntax.
 */

const names = (namespace: object): string[] => Object.keys(namespace).sort();

describe("sandbox builtins", () => {
	it.each([
		["@rowcat/runtime", names(runtime)],
		["@rowcat/runtime/jsx-runtime", names(jsxRuntime)],
		["@rowcat/runtime/jsx-dev-runtime", names(jsxDevRuntime)],
	])("%s has the same exports", async (specifier, expected) => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: poc([
				{
					id: "src/main.ts",
					code: `import * as ns from ${JSON.stringify(specifier)};\nexport function keys() { return Object.keys(ns).sort(); }`,
					poc: false,
				},
			]),
		});
		try {
			expect(await session.callExport("src/main.ts", "keys", [])).toEqual({
				ok: true,
				value: expected,
			});
		} finally {
			await session.dispose();
		}
	});
});
