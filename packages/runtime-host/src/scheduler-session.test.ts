import { describe, expect, it } from "vitest";
import { RUNTIME_HOST_ERROR_CODE, RuntimeHostError } from "./errors.ts";
import { POC_HOST_BUILTIN } from "./poc/host-builtin.ts";
import {
	createRuntimeVmSession,
	type RuntimeVmSessionOptions,
} from "./session.ts";
import { pocMain, testEngine } from "./test/fixtures.ts";

/**
 * What the scheduler guarantees on a real VM. This covers only the axes that pure tests
 * (scheduler/scheduler.test.ts) cannot answer: whether turns really split, whether completions
 * really pass through the queue, whether cancellation cuts both the queue and the in-progress item,
 * and whether nothing enters after a fatal failure.
 */

const open = (
	overrides: Partial<RuntimeVmSessionOptions> & { artifact: unknown },
) =>
	createRuntimeVmSession({
		engine: testEngine(),
		builtins: [POC_HOST_BUILTIN],
		...overrides,
	});

const hostCode = (outcome: { ok: boolean; error?: unknown }): string | null =>
	!outcome.ok && outcome.error instanceof RuntimeHostError
		? outcome.error.code
		: null;

const FIXTURE = pocMain(`let log = [];
export function tag(label) { log.push(label); return log.slice(); }
export async function viaHost(label) { const v = await hostCall("test.echo", label); log.push(v); return log.slice(); }
export function chain(n) { let p = Promise.resolve(0); for (let i = 0; i < n; i += 1) p = p.then((v) => v + 1); return p; }
export function throws() { throw new TypeError("creator"); }
export function ok() { return "alive"; }
export function loop() { while (true) {} }
export async function slow() { return await hostCall("test.slow", null); }`);

describe("order", () => {
	it("the same priority in arrival order, higher priority to the front, in a real VM", async () => {
		const session = await open({ artifact: FIXTURE });
		try {
			const results = await Promise.all([
				session.callExport("src/main.ts", "tag", ["a"], {
					priority: "background",
				}),
				session.callExport("src/main.ts", "tag", ["b"]),
				session.callExport("src/main.ts", "tag", ["c"], {
					priority: "userBlocking",
				}),
				session.callExport("src/main.ts", "tag", ["d"]),
			]);
			/** a is background, so it runs last. a's observed list is the full order. */
			expect(results[0]).toEqual({ ok: true, value: ["c", "b", "d", "a"] });
			expect(results[3]).toEqual({ ok: true, value: ["c", "b", "d"] });
		} finally {
			await session.dispose();
		}
	});
});

describe("turns and slices", () => {
	it("long promise chains split into turns at the task cap", async () => {
		const turns: number[] = [];
		const session = await open({
			artifact: FIXTURE,
			limits: { maxJobsPerSlice: 10 },
			scheduling: {
				policy: { maxTurnsPerSlice: 2 },
				observer: { onTurn: (info) => turns.push(info.depth) },
			},
		});
		try {
			const before = session.metrics().scheduler;
			expect(await session.callExport("src/main.ts", "chain", [100])).toEqual({
				ok: true,
				value: 100,
			});
			const after = session.metrics().scheduler;
			expect(after.turns - before.turns).toBeGreaterThan(5);
			expect(after.yields - before.yields).toBeGreaterThan(1);
			expect(Math.max(...turns)).toBe(1);
		} finally {
			await session.dispose();
		}
	});

	it("host completions resume on the next turn through the queue: never re-entering the VM within a turn", async () => {
		let depth = 0;
		let maxDepth = 0;
		const session = await open({
			artifact: FIXTURE,
			capabilities: { "test.echo": (payload) => payload },
			scheduling: {
				observer: {
					onTurn: (info) => {
						depth = info.depth;
						maxDepth = Math.max(maxDepth, info.depth);
					},
				},
			},
		});
		try {
			expect(await session.callExport("src/main.ts", "viaHost", ["x"])).toEqual(
				{ ok: true, value: ["x"] },
			);
			expect(session.metrics().scheduler.hostCompletions).toBe(1);
			expect(session.metrics().scheduler.turns).toBeGreaterThanOrEqual(3);
			expect(maxDepth).toBe(1);
			expect(depth).toBe(1);
		} finally {
			await session.dispose();
		}
	});

	it("calls made inside a host handler enter the queue and run after that turn", async () => {
		let nested: Promise<unknown> | null = null;
		const session = await open({
			artifact: FIXTURE,
			capabilities: {
				"test.echo": (payload) => {
					nested = session.callExport("src/main.ts", "tag", ["nested"]);
					return payload;
				},
			},
		});
		try {
			const outer = await session.callExport("src/main.ts", "viaHost", [
				"outer",
			]);
			expect(outer).toEqual({ ok: true, value: ["nested", "outer"] });
			expect(await nested).toEqual({ ok: true, value: ["nested"] });
		} finally {
			await session.dispose();
		}
	});
});

describe("the weight of failures", () => {
	it("creator exceptions refuse only that call and the session lives", async () => {
		const session = await open({ artifact: FIXTURE });
		try {
			const [bad, good] = await Promise.all([
				session.callExport("src/main.ts", "throws", []),
				session.callExport("src/main.ts", "ok", []),
			]);
			expect(bad.ok).toBe(false);
			expect(good).toEqual({ ok: true, value: "alive" });
			expect(session.state).toBe("ready");
			expect(session.metrics().scheduler.discarded).toBe(0);
		} finally {
			await session.dispose();
		}
	});

	it("a fatal failure refuses even the queued calls and leaves only disposal", async () => {
		const session = await open({
			artifact: FIXTURE,
			limits: { executionMs: 50 },
		});
		try {
			const [loop, queued] = await Promise.all([
				session.callExport("src/main.ts", "loop", []),
				session.callExport("src/main.ts", "ok", []),
			]);
			expect(hostCode(loop)).toBe(
				RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded,
			);
			expect(hostCode(queued)).toBe(RUNTIME_HOST_ERROR_CODE.sessionFailed);
			expect(session.state).toBe("failed");
			expect(hostCode(await session.callExport("src/main.ts", "ok", []))).toBe(
				RUNTIME_HOST_ERROR_CODE.sessionFailed,
			);
			expect(await session.hasDispatcher()).toBe(false);
		} finally {
			await session.dispose();
			expect(session.state).toBe("disposed");
		}
	});
});

describe("cancellation", () => {
	it("disposal cuts what is waiting, what is queued and late completions together", async () => {
		let release: (() => void) | null = null;
		let aborted = false;
		const session = await open({
			artifact: FIXTURE,
			capabilities: {
				"test.slow": (_payload, context) =>
					new Promise((resolve) => {
						context.signal.addEventListener("abort", () => {
							aborted = true;
						});
						release = () => resolve("late");
					}),
			},
		});
		const waiting = session.callExport("src/main.ts", "slow", []);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const queued = session.callExport("src/main.ts", "ok", [], {
			priority: "immediate",
		});
		const disposal = session.dispose();
		const late = session.callExport("src/main.ts", "ok", []);
		await disposal;
		expect(hostCode(await waiting)).toBe(RUNTIME_HOST_ERROR_CODE.cancelled);
		expect(hostCode(await queued)).toBe(RUNTIME_HOST_ERROR_CODE.cancelled);
		expect(hostCode(await late)).toBe(RUNTIME_HOST_ERROR_CODE.disposed);
		expect(aborted).toBe(true);
		(release as (() => void) | null)?.();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(session.state).toBe("disposed");
		expect(session.metrics().scheduler.discarded).toBeGreaterThanOrEqual(1);
	});
});
