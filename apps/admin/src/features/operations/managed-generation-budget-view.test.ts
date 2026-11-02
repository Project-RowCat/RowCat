import type { ManagedGenerationBudgetDto } from "@rowcat/contracts";
import { describe, expect, test } from "vitest";
import {
	BLOCKER_SENTENCE,
	managedGenerationBudgetView,
} from "./managed-generation-budget-view.ts";

const budget = (
	over: Partial<ManagedGenerationBudgetDto> = {},
): ManagedGenerationBudgetDto => ({
	configured: true,
	access: "allowlist",
	store: "redis",
	dailyTokens: { used: 1_250_000, limit: 2_000_000, resetsInMs: 3_600_000 },
	concurrency: { active: 3, limit: 8 },
	requestTokenLimit: 300_000,
	perMember: { perMinute: 30, perDay: 400 },
	blockers: [],
	...over,
});

const rowValue = (
	view: ReturnType<typeof managedGenerationBudgetView>,
	label: string,
) => view.rows.find((row) => row.label === label)?.value;

describe("managed generation budget view", () => {
	test("states use, limit and what is left without abbreviating", () => {
		const view = managedGenerationBudgetView(budget());
		expect(rowValue(view, "Tokens in this window")).toBe(
			"1,250,000 of 2,000,000 (750,000 left)",
		);
		expect(rowValue(view, "Streams open now")).toBe("3 of 8");
		expect(rowValue(view, "Window resets")).toBe("In 1h 0m");
		expect(view.open).toBe(true);
	});

	/** The one mistake this module exists to make impossible: an unreadable store drawn as an empty budget. */
	test("unknown usage is said as unknown, never as 0, and the blocker is named", () => {
		const view = managedGenerationBudgetView(
			budget({
				dailyTokens: { used: null, limit: 2_000_000, resetsInMs: null },
				concurrency: { active: null, limit: 8 },
				blockers: ["store_unavailable"],
			}),
		);
		expect(rowValue(view, "Tokens in this window")).toMatch(/^Unknown/);
		expect(rowValue(view, "Streams open now")).toMatch(/^Unknown/);
		expect(rowValue(view, "Window resets")).toBeUndefined();
		expect(view.blockers).toEqual([BLOCKER_SENTENCE.store_unavailable]);
		expect(view.open).toBe(false);
	});

	test("no window yet is a fact of its own, not a countdown", () => {
		const view = managedGenerationBudgetView(
			budget({ dailyTokens: { used: 0, limit: 2_000_000, resetsInMs: null } }),
		);
		expect(rowValue(view, "Window resets")).toBe(
			"No window open — nothing spent yet",
		);
	});

	test("a process-local store says each replica counts its own", () => {
		const view = managedGenerationBudgetView(budget({ store: "memory" }));
		expect(rowValue(view, "Counted by")).toMatch(/each replica/);
	});
});
