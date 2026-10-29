import { describe, expect, test } from "vitest";
import { canUseManagedGeneration } from "./access.ts";

/**
 * The **matrix** of the managed generation access decision — two deployment modes × three roles × two column values.
 *
 * The mode is passed as an argument because the value is read once at module load (`env.ts`). One
 * process cannot imitate two deployments, so the route test (`routes/chat.test.ts`) checks the default
 * `allowlist` door through the real wiring, and the meaning of `everyone` is checked by value here.
 */
describe("canUseManagedGeneration", () => {
	test.each([
		["user", false, false],
		["user", true, true],
		["staff", false, true],
		["admin", false, true],
	] as const)("allowlist · %s · column=%s → %s", (role, allowed, expected) => {
		expect(
			canUseManagedGeneration(
				{ role, managedGenerationAllowed: allowed },
				"allowlist",
			),
		).toBe(expected);
	});

	test.each([
		"user",
		"staff",
		"admin",
	] as const)("everyone · %s is allowed regardless of the column", (role) => {
		expect(
			canUseManagedGeneration(
				{ role, managedGenerationAllowed: false },
				"everyone",
			),
		).toBe(true);
	});
});
