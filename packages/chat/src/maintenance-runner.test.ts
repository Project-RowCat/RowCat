import { describe, expect, it } from "vitest";
import {
	type MaintenanceOutcome,
	type MemoryMaintenancePort,
	MemoryMaintenanceScheduler,
	resolveUtilityTarget,
	runMemoryMaintenance,
} from "./maintenance-runner.ts";
import type { ChatMemory } from "./memory.ts";
import {
	CHAT_MAINTENANCE_RECENT_KEEP,
	CHAT_MAINTENANCE_TRIGGER,
	type ChatMaintenancePlan,
	type MaintenanceMessage,
} from "./memory-maintenance.ts";
import type { ChatSummary } from "./summary.ts";

const messages = (count: number): MaintenanceMessage[] =>
	Array.from({ length: count }, (_, index) => ({
		id: `m${String(index).padStart(4, "0")}`,
		role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
		speaker: "",
		content: `말 ${index}`,
		createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
	}));

const DUE = messages(CHAT_MAINTENANCE_RECENT_KEEP + CHAT_MAINTENANCE_TRIGGER);

interface Recorder {
	port: MemoryMaintenancePort;
	requests: number;
	commits: ChatMaintenancePlan[];
}

/**
 * Port with overrides, plus the observed values. The request counter sits outside the overrides on
 * purpose. Inside them, a throwing override would never be counted, and there would be no way to
 * tell whether a call went out before the failure.
 */
function recorder(overrides: Partial<MemoryMaintenancePort> = {}): Recorder {
	const state: Recorder = {
		requests: 0,
		commits: [],
		port: {} as MemoryMaintenancePort,
	};
	const base: MemoryMaintenancePort = {
		loadMessages: async () => DUE,
		loadSummary: async (): Promise<ChatSummary | null> => null,
		loadMemories: async (): Promise<ChatMemory[]> => [],
		requestMaintenance: async () => '{"summary":"S2","memoryOperations":[]}',
		commit: async (plan) => {
			state.commits.push(plan);
			return true;
		},
		isValid: () => true,
		...overrides,
	};
	state.port = {
		...base,
		requestMaintenance: (request, signal) => {
			state.requests += 1;
			return base.requestMaintenance(request, signal);
		},
	};
	return state;
}

describe("maintenance runs", () => {
	it("makes no request when there is no span to process", async () => {
		const state = recorder({ loadMessages: async () => messages(10) });
		const outcome = await runMemoryMaintenance(state.port);
		expect(outcome).toEqual({ status: "skipped", reason: "not-due" });
		expect(state.requests).toBe(0);
	});

	it("commits when it is worth running", async () => {
		const state = recorder();
		const outcome = await runMemoryMaintenance(state.port);
		expect(outcome.status).toBe("applied");
		expect(state.commits).toHaveLength(1);
		expect(state.commits[0]?.summary).toBe("S2");
	});

	it("checks ownership before starting: no paid call for a conversation that was left", async () => {
		const state = recorder({ isValid: () => false });
		const outcome = await runMemoryMaintenance(state.port);
		expect(outcome).toEqual({ status: "skipped", reason: "invalid" });
		expect(state.requests).toBe(0);
	});

	it("commits nothing when the utility call fails", async () => {
		const state = recorder({
			requestMaintenance: async () => {
				throw new Error("network");
			},
		});
		const outcome = await runMemoryMaintenance(state.port);
		expect(outcome).toEqual({ status: "failed", reason: "request" });
		expect(state.commits).toEqual([]);
	});

	it("a malformed response makes no partial commit", async () => {
		const state = recorder({
			requestMaintenance: async () => "요약: 두 사람이 만났습니다.",
		});
		const outcome = await runMemoryMaintenance(state.port);
		expect(outcome).toEqual({ status: "failed", reason: "malformed" });
		expect(state.commits).toEqual([]);
	});

	it("checks ownership again **after** the response arrives", async () => {
		/**
		 * This case is not caught by the abort signal. A request whose body has fully arrived ignores the
		 * signal and succeeds, so the check reads state, not the signal.
		 */
		let calls = 0;
		const state = recorder({
			isValid: () => {
				calls += 1;
				return calls === 1;
			},
		});
		const outcome = await runMemoryMaintenance(state.port);
		expect(outcome).toEqual({ status: "failed", reason: "stale" });
		expect(state.commits).toEqual([]);
	});

	it("ends as a failure when the store refuses on a condition mismatch", async () => {
		const state = recorder({ commit: async () => false });
		const outcome = await runMemoryMaintenance(state.port);
		expect(outcome).toEqual({ status: "failed", reason: "stale" });
	});

	it("**does not throw** when the store throws: does not turn a successful turn into a failure", async () => {
		const state = recorder({
			commit: async () => {
				throw new Error("quota exceeded");
			},
		});
		await expect(runMemoryMaintenance(state.port)).resolves.toEqual({
			status: "failed",
			reason: "request",
		});
	});

	it("does not throw when a store lookup throws", async () => {
		const state = recorder({
			loadMessages: async () => {
				throw new Error("closed");
			},
		});
		await expect(runMemoryMaintenance(state.port)).resolves.toMatchObject({
			status: "failed",
		});
	});
});

describe("utility target", () => {
	it("managed goes to the product default model", () => {
		expect(
			resolveUtilityTarget({ provider: "rowcat", model: "claude-sonnet-5" }),
		).toEqual({ provider: "rowcat", model: expect.any(String) });
		expect(
			resolveUtilityTarget({ provider: "rowcat", model: "claude-sonnet-5" })
				.provider,
		).toBe("rowcat");
	});

	it("BYO stays BYO: never quietly falls to managed", () => {
		/**
		 * If this fell back, a conversation the user chose not to send to the server would reach it, and
		 * the billed provider would change silently.
		 */
		for (const target of [
			{ provider: "anthropic-byo", model: "claude-x" } as const,
			{ provider: "gemini-byo", model: "gemini-x" } as const,
		])
			expect(resolveUtilityTarget(target)).toEqual(target);
	});
});

describe("single run per room", () => {
	it("a second request for the same room joins the running one", async () => {
		const scheduler = new MemoryMaintenanceScheduler();
		let started = 0;
		let release = (): void => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const start = async (): Promise<MaintenanceOutcome> => {
			started += 1;
			await gate;
			return { status: "skipped", reason: "not-due" };
		};

		const first = scheduler.run("room-a", start);
		const second = scheduler.run("room-a", start);
		expect(started).toBe(1);
		expect(second).toBe(first);

		release();
		await first;
		expect(scheduler.isRunning("room-a")).toBe(false);
	});

	it("different rooms do not block each other", async () => {
		const scheduler = new MemoryMaintenanceScheduler();
		let started = 0;
		let release = (): void => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const start = async (): Promise<MaintenanceOutcome> => {
			started += 1;
			await gate;
			return { status: "skipped", reason: "not-due" };
		};

		const a = scheduler.run("room-a", start);
		const b = scheduler.run("room-b", start);
		expect(started).toBe(2);
		release();
		await Promise.all([a, b]);
	});

	it("a failed run also releases its slot", async () => {
		const scheduler = new MemoryMaintenanceScheduler();
		await scheduler
			.run("room-a", async () => {
				throw new Error("boom");
			})
			.catch(() => undefined);
		expect(scheduler.isRunning("room-a")).toBe(false);
	});
});
