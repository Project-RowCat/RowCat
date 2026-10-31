import { describe, expect, it } from "vitest";
import { RUNTIME_HOST_ERROR_CODE, RuntimeHostError } from "./errors.ts";
import { POC_HOST_BUILTIN } from "./poc/host-builtin.ts";
import {
	createRuntimeVmSession,
	type RuntimeVmSessionOptions,
} from "./session.ts";
import { compiled, pocMain, testEngine } from "./test/fixtures.ts";

/**
 * The budgets against what the interrupt cannot reach: a native builtin, host work inside the turn,
 * reading thrown values, and the wording that names which budget cut a turn. These run on the real
 * QuickJS engine; the scheduler rules themselves are in scheduler/scheduler.test.ts.
 */

const open = (
	overrides: Partial<RuntimeVmSessionOptions> & { artifact: unknown },
) =>
	createRuntimeVmSession({
		engine: testEngine(),
		builtins: [POC_HOST_BUILTIN],
		...overrides,
	});

const hostError = (outcome: {
	ok: boolean;
	error?: unknown;
}): RuntimeHostError | null =>
	!outcome.ok && outcome.error instanceof RuntimeHostError
		? outcome.error
		: null;

describe("a turn that returns late", () => {
	/**
	 * `includes` with a long needle that almost matches everywhere is one quadratic native call. The
	 * interrupt never fires inside it: 20,000 / 10,000 characters took about 600 ms under a 50 ms budget
	 * and came back as success. These sessions run at 200 ms, not 50: boot runs under the same deadline,
	 * and an oversubscribed runner pushed a cold boot past 50 ms. The 40,000 / 20,000 search keeps the
	 * overrun seconds past 200 ms + the grace.
	 */
	it("a native call that outlives the budget is a budget failure, and the session ends", async () => {
		const session = await open({
			artifact: pocMain(
				"export function search() { return 'a'.repeat(40000).includes('a'.repeat(20000) + 'b'); }\nexport function ok() { return 1; }",
			),
			limits: { executionMs: 200 },
		});
		try {
			const outcome = await session.callExport("src/main.ts", "search", []);
			expect(hostError(outcome)?.code).toBe(
				RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded,
			);
			expect(session.state).toBe("failed");
			expect(
				hostError(await session.callExport("src/main.ts", "ok", []))?.code,
			).toBe(RUNTIME_HOST_ERROR_CODE.sessionFailed);
		} finally {
			await session.dispose();
		}
	});

	it("the same call on a short input is an ordinary value", async () => {
		const session = await open({
			artifact: pocMain(
				"export function search() { return 'a'.repeat(1000).includes('a'.repeat(500) + 'b'); }",
			),
			limits: { executionMs: 200 },
		});
		try {
			expect(await session.callExport("src/main.ts", "search", [])).toEqual({
				ok: true,
				value: false,
			});
			expect(session.state).toBe("ready");
		} finally {
			await session.dispose();
		}
	});

	/**
	 * A host completion's turn pumps every pending VM job, so it also runs other executions'
	 * continuations, and its sweep settles them. Here the code that overruns is `wait`'s continuation,
	 * run in `hold`'s turn. Only `hold`'s result used to be replaced: `wait` came back as a success from
	 * a session that failed computing it.
	 */
	it("an overrun turn delivers no value to any execution it settled", async () => {
		let release: (() => void) | null = null;
		const session = await open({
			artifact: pocMain(`
let open; const gate = new Promise((resolve) => { open = resolve; });
export function hold() { return hostCall("test.slow", null); }
export async function wait() { await gate; return 'a'.repeat(40000).includes('a'.repeat(20000) + 'b') ? 'found' : 'computed past the budget'; }
export function release() { open(); return 1; }`),
			limits: { executionMs: 200 },
			capabilities: {
				"test.slow": () =>
					new Promise((resolve) => {
						release = () => resolve(null);
					}),
			},
		});
		try {
			const held = session.callExport("src/main.ts", "hold", []);
			const waited = session.callExport("src/main.ts", "wait", []);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(await session.callExport("src/main.ts", "release", [])).toEqual({
				ok: true,
				value: 1,
			});
			(release as (() => void) | null)?.();
			expect(hostError(await held)?.code).toBe(
				RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded,
			);
			expect(hostError(await waited)?.code).toBe(
				RUNTIME_HOST_ERROR_CODE.sessionFailed,
			);
			expect(session.state).toBe("failed");
		} finally {
			await session.dispose();
		}
	});

	it("an overrun turn delivers no failure carrying what it computed either", async () => {
		let release: (() => void) | null = null;
		const session = await open({
			artifact: pocMain(`
let open; const gate = new Promise((resolve) => { open = resolve; });
export function hold() { return hostCall("test.slow", null); }
export async function wait() { await gate; throw new Error('a'.repeat(40000).includes('a'.repeat(20000) + 'b') ? 'found' : 'computed past the budget'); }
export function release() { open(); return 1; }`),
			limits: { executionMs: 200 },
			capabilities: {
				"test.slow": () =>
					new Promise((resolve) => {
						release = () => resolve(null);
					}),
			},
		});
		try {
			const held = session.callExport("src/main.ts", "hold", []);
			const waited = session.callExport("src/main.ts", "wait", []);
			await new Promise((resolve) => setTimeout(resolve, 20));
			await session.callExport("src/main.ts", "release", []);
			(release as (() => void) | null)?.();
			expect(hostError(await held)?.code).toBe(
				RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded,
			);
			const outcome = await waited;
			expect(hostError(outcome)?.code).toBe(
				RUNTIME_HOST_ERROR_CODE.sessionFailed,
			);
			expect(JSON.stringify(outcome)).not.toContain("computed past the budget");
		} finally {
			await session.dispose();
		}
	});

	/**
	 * The ledger walk, commit validation and the reconciler all count against the turn. 3,000 ordinary
	 * nodes used to fail on the ledger alone: about 240 ms of a 300 ms mount, past the 250 ms session
	 * window. What the ledger costs is pinned by counting its work (patches.test.ts, "ledger cost"),
	 * because a wall-clock bound here measured machine load as much as the walk: an oversubscribed CI
	 * runner is several times slower than a desktop. So this mount runs with budgets nothing ordinary
	 * reaches, and asserts only that the real reconciler's batch stands.
	 */
	it("a 3,000-node mount stands", async () => {
		const rows = 600;
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			limits: { executionMs: 60_000 },
			scheduling: { policy: { session: null } },
			artifact: compiled([
				{
					path: "src/main.tsx",
					content: `import { Button, Row, ScrollView, Text } from "@rowcat/runtime";
const items = Array.from({ length: ${rows} }, (_, i) => i);
export default function App() {
	return <ScrollView>{items.map((i) => <Row key={i}><Text>row {i}</Text><Button onPress={() => {}}>go</Button></Row>)}</ScrollView>;
}`,
				},
			]),
		});
		try {
			let created = 0;
			const outcome = await session.mountRoot({
				onCommit: (batch) => {
					created += batch.patches.filter(
						(patch) => patch.op === "create",
					).length;
				},
			});
			expect(outcome.ok).toBe(true);
			expect(created).toBe(rows * 5 + 1);
			expect(session.state).toBe("ready");
		} finally {
			await session.dispose();
		}
	});
});

describe("reading thrown values inside one turn", () => {
	/**
	 * Every settled waiting execution is classified in the same sweep turn. Each read used to get a
	 * fresh 25 ms, and an interrupted read was a recoverable creator error, so forty looping `name`
	 * getters held one turn for a second and the session stayed `ready`. The getters are counted, not
	 * timed: the first one to loop spends what is left of the turn and ends the session, so no other is
	 * read (none at all, if the turn's time was already gone). A wall-clock bound on the turn would
	 * measure the machine's load as much as the rule.
	 */
	it("forty looping getters cannot each take a fresh budget", async () => {
		let reads = 0;
		let release: (() => void) | null = null;
		const session = await open({
			artifact: pocMain(`
let open; const gate = new Promise((resolve) => { open = resolve; });
export function hold() { return hostCall("test.slow", null); }
export async function wait() { await gate; throw { get name() { console.log("read"); for (;;) {} } }; }
export function release() { open(); return 1; }`),
			limits: { executionMs: 200 },
			capabilities: {
				"test.slow": () =>
					new Promise((resolve) => {
						release = () => resolve(null);
					}),
			},
			onConsole: () => {
				reads += 1;
			},
		});
		try {
			const held = session.callExport("src/main.ts", "hold", []);
			const waits = Array.from({ length: 40 }, () =>
				session.callExport("src/main.ts", "wait", []),
			);
			await new Promise((resolve) => setTimeout(resolve, 50));
			await session.callExport("src/main.ts", "release", []);
			/** The continuations run, and are swept, in the turn that delivers the host completion. */
			(release as (() => void) | null)?.();
			await held;
			const results = await Promise.all(waits);
			expect(results.every((result) => !result.ok)).toBe(true);
			expect(session.state).toBe("failed");
			expect(reads).toBeLessThanOrEqual(1);
		} finally {
			await session.dispose();
		}
	});

	/**
	 * The sweep runs inside another execution's turn. When a swept value ends the session, that turn's
	 * owner is neither queued nor waiting yet, so nothing else would ever settle it.
	 */
	it("the turn's own execution settles when a swept value ends the session", async () => {
		const session = await open({
			artifact: pocMain(`
let open; const gate = new Promise((resolve) => { open = resolve; });
export function hold() { return hostCall("test.never", null); }
export async function wait() { await gate; throw { get name() { for (;;) {} } }; }
export async function opener() { open(); await hostCall("test.never", null); return 1; }`),
			limits: { executionMs: 200 },
			capabilities: { "test.never": () => new Promise(() => {}) },
		});
		try {
			void session.callExport("src/main.ts", "hold", []);
			const waits = Array.from({ length: 3 }, () =>
				session.callExport("src/main.ts", "wait", []),
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			const opener = await Promise.race([
				session.callExport("src/main.ts", "opener", []),
				new Promise<"hung">((resolve) =>
					setTimeout(() => resolve("hung"), 2_000),
				),
			]);
			expect(opener).not.toBe("hung");
			if (opener === "hung") return;
			expect(hostError(opener)?.code).toBe(
				RUNTIME_HOST_ERROR_CODE.sessionFailed,
			);
			expect(session.state).toBe("failed");
			expect((await Promise.all(waits)).every((result) => !result.ok)).toBe(
				true,
			);
		} finally {
			await session.dispose();
		}
	});

	it("a read the interrupt cut ends the session and says what was cut", async () => {
		const session = await open({
			artifact: pocMain(
				"export function boom() { throw { get name() { for (;;) {} } }; }",
			),
			limits: { executionMs: 10_000 },
		});
		try {
			const error = hostError(
				await session.callExport("src/main.ts", "boom", []),
			);
			expect(error?.code).toBe(RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded);
			expect(error?.message).toMatch(/reading a thrown value/);
			expect(session.state).toBe("failed");
		} finally {
			await session.dispose();
		}
	});

	it("a getter that throws on its own is still an ordinary creator error", async () => {
		const session = await open({
			artifact: pocMain(
				"export function boom() { throw { get name() { throw new Error('no'); }, message: 'kept' }; }\nexport function ok() { return 1; }",
			),
		});
		try {
			const outcome = await session.callExport("src/main.ts", "boom", []);
			expect(outcome.ok).toBe(false);
			expect(hostError(outcome)).toBeNull();
			expect(session.state).toBe("ready");
			expect(await session.callExport("src/main.ts", "ok", [])).toEqual({
				ok: true,
				value: 1,
			});
		} finally {
			await session.dispose();
		}
	});
});

describe("the budget a failure names", () => {
	it("the rolling session window, when it is what cut the turn", async () => {
		const session = await open({
			artifact: pocMain("export function loop() { for (;;) {} }"),
			limits: { executionMs: 10_000 },
		});
		try {
			const error = hostError(
				await session.callExport("src/main.ts", "loop", []),
			);
			expect(error?.code).toBe(RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded);
			expect(error?.message).toBe(
				"execution exceeded the session budget of 250ms per 1000ms",
			);
		} finally {
			await session.dispose();
		}
	});

	it("the execution budget, when it is the earlier one", async () => {
		const session = await open({
			artifact: pocMain("export function loop() { for (;;) {} }"),
			limits: { executionMs: 200 },
		});
		try {
			const error = hostError(
				await session.callExport("src/main.ts", "loop", []),
			);
			expect(error?.message).toBe("execution exceeded its budget of 200ms");
		} finally {
			await session.dispose();
		}
	});
});
