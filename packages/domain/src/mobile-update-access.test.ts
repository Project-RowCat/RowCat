import { describe, expect, test } from "vitest";
import {
	hasMobileUpdateCapability,
	isMobileUpdateJobActive,
	nextRolloutSteps,
} from "./mobile-update-access.ts";
import type { Viewer } from "./viewer.ts";

const viewer = (role: Viewer["role"], status: Viewer["status"] = "approved") =>
	({ id: "m", role, status }) as Viewer;

describe("mobile OTA capabilities", () => {
	test("staff read only, admin has all three, ordinary members none", () => {
		const table = (role: Viewer["role"]) =>
			(["read", "operate", "publish"] as const).map((capability) =>
				hasMobileUpdateCapability(viewer(role), capability),
			);
		expect(table("user")).toEqual([false, false, false]);
		expect(table("staff")).toEqual([true, false, false]);
		expect(table("admin")).toEqual([true, true, true]);
	});

	test("a suspended operator has no capability, the same predicate as the server gate", () => {
		expect(
			hasMobileUpdateCapability(viewer("admin", "suspended"), "read"),
		).toBe(false);
		expect(hasMobileUpdateCapability(null, "read")).toBe(false);
	});
});

describe("next rollout steps", () => {
	test("only higher steps", () => {
		expect(nextRolloutSteps("draft", 0)).toEqual([5, 10, 25, 50, 100]);
		expect(nextRolloutSteps("active", 25)).toEqual([50, 100]);
		expect(nextRolloutSteps("active", 100)).toEqual([]);
	});

	test("pause and rollback have no step; resume reopens a pause", () => {
		expect(nextRolloutSteps("paused", 25)).toEqual([]);
		expect(nextRolloutSteps("rolled_back", 25)).toEqual([]);
	});

	test("a rollback to the store bundle is 100% only", () => {
		expect(nextRolloutSteps("draft", 0, "rollback_to_embedded")).toEqual([100]);
	});

	test("is the job alive", () => {
		expect(isMobileUpdateJobActive("queued")).toBe(true);
		expect(isMobileUpdateJobActive("running")).toBe(true);
		expect(isMobileUpdateJobActive("failed")).toBe(false);
	});
});
