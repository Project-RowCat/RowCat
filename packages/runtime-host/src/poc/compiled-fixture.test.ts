import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { compileRuntimeProject } from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";
import { describe, expect, it } from "vitest";
import { POC_COMPILED_ARTIFACT } from "./compiled-fixture.ts";
import { POC_FIXTURE_FILES } from "./compiled-fixture-source.ts";

/**
 * Whether the snapshot matches the current compiler. If not, regenerate the snapshot; do not edit
 * the test.
 */
describe("PoC artifact snapshot", () => {
	it("equals the result of recompiling the source", () => {
		const result = compileRuntimeProject(
			{
				apiVersion: RUNTIME_API_VERSION,
				entry: "src/main.tsx",
				files: POC_FIXTURE_FILES,
			},
			nodeRuntimeEnvironment(),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.artifact).toEqual(POC_COMPILED_ARTIFACT);
	});
});
