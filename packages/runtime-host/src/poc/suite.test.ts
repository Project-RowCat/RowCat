import { describe, expect, it } from "vitest";
import { engineWithStackCeiling, testEngine } from "../test/fixtures.ts";
import { RUNTIME_STACK_LIMITS } from "../vm/stack-limits.ts";
import { runRuntimeVmPoc } from "./suite.ts";

/**
 * The suite passes under Node. The device harness runs the same list, so a broken line here is a
 * problem with the suite, not with the platform.
 */
describe("PoC suite", () => {
	it("every step passes", async () => {
		const report = await runRuntimeVmPoc({
			engine: testEngine(),
			platform: "node",
		});
		const failed = report.steps.filter((step) => !step.ok);
		expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
		expect(report.ok).toBe(true);
		expect(report.measurements.callRoundTripUs).toBeGreaterThan(0);
		expect(report.measurements.baselineMemoryBytes).not.toBeNull();
	}, 30_000);

	/**
	 * Whether Node's table value (128 KiB) is actually caught on this worker's stack. Whether the
	 * ceiling above it (256 KiB) leaks is Phase 3's measurement, and this test does not rerun it. If
	 * that ceiling leaks, the runtime is corrupted, and the corruption would contaminate the next test
	 * on the same worker.
	 */
	it("the Node stack cap written in the table holds", async () => {
		const ceiling = RUNTIME_STACK_LIMITS.node.ceilingBytes;
		const report = await runRuntimeVmPoc({
			engine: testEngine(),
			platform: "node",
			stackProbe: { ceilings: [ceiling], engineFor: engineWithStackCeiling },
		});
		expect(report.stackProbe).toEqual([
			{
				ceilingBytes: ceiling,
				outcome: "contained",
				repeatable: true,
				detail: "contained · contained · contained",
			},
		]);
	}, 30_000);
});
