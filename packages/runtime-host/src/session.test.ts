import { describe, expect, it } from "vitest";
import {
	CreatorExecutionError,
	RUNTIME_HOST_ERROR_CODE,
	RuntimeHostError,
} from "./errors.ts";
import { POC_HOST_BUILTIN } from "./poc/host-builtin.ts";
import {
	createRuntimeVmSession,
	type RuntimeVmSessionOptions,
} from "./session.ts";
import { compiled, poc, pocMain, testEngine } from "./test/fixtures.ts";
import type { RuntimeWireValue } from "./wire.ts";

/**
 * VM integration test: sessions run in a real engine. It covers the session's promises: isolated
 * realm, static ESM, built-ins, wire round trip, host bridge and promise resumption, budget,
 * memory, recursion and call limits, cancellation, and disposal. The engine is not mocked, because
 * a test that passes against a fake engine cannot show that the VM works.
 */

const open = (
	overrides: Partial<RuntimeVmSessionOptions> & { artifact: unknown },
) =>
	createRuntimeVmSession({
		engine: testEngine(),
		builtins: [POC_HOST_BUILTIN],
		...overrides,
	});

const echo = { "test.echo": async (payload: RuntimeWireValue) => payload };

const hostCode = (outcome: { ok: boolean; error?: unknown }): string | null =>
	!outcome.ok && outcome.error instanceof RuntimeHostError
		? outcome.error.code
		: null;

describe("compiled artifacts", () => {
	it("calls exported functions and values come back", async () => {
		const session = await open({
			artifact: compiled([
				{
					path: "src/main.tsx",
					content: `import { Screen, Text } from "@rowcat/runtime";\nimport { next } from "./counter";\nexport function add(a: number, b: number) { return a + b + next(); }\nexport default function App() { return <Screen><Text>hi</Text></Screen>; }`,
				},
				{
					path: "src/counter.ts",
					content: "let v = 0;\nexport function next() { return ++v; }",
				},
			]),
		});
		try {
			expect(await session.callExport("src/main.tsx", "add", [20, 21])).toEqual(
				{ ok: true, value: 42 },
			);
			expect(await session.callExport("src/main.tsx", "add", [20, 20])).toEqual(
				{ ok: true, value: 42 },
			);
		} finally {
			await session.dispose();
		}
	});

	it("modules are evaluated once: two modules see the same instance", async () => {
		const session = await open({
			artifact: compiled([
				{
					path: "src/main.tsx",
					content: `import { next } from "./counter";\nimport { nextFromOther } from "./other";\nexport function probe() { return [next(), nextFromOther(), next()]; }\nexport default function App() { return null; }`,
				},
				{
					path: "src/other.ts",
					content: `import { next } from "./counter";\nexport function nextFromOther() { return next(); }`,
				},
				{
					path: "src/counter.ts",
					content: "let v = 0;\nexport function next() { return ++v; }",
				},
			]),
		});
		try {
			expect(await session.callExport("src/main.tsx", "probe", [])).toEqual({
				ok: true,
				value: [1, 2, 3],
			});
		} finally {
			await session.dispose();
		}
	});

	it("static circular imports run with ESM semantics", async () => {
		const session = await open({
			artifact: compiled([
				{
					path: "src/main.tsx",
					content: `import { fromB } from "./a";\nexport function probe() { return fromB(); }\nexport default function App() { return null; }`,
				},
				{
					path: "src/a.ts",
					content: `import { b } from "./b";\nexport const a = 1;\nexport function fromB() { return b(); }`,
				},
				{
					path: "src/b.ts",
					content: `import { a } from "./a";\nexport function b() { return a + 1; }`,
				},
			]),
		});
		try {
			expect(await session.callExport("src/main.tsx", "probe", [])).toEqual({
				ok: true,
				value: 2,
			});
		} finally {
			await session.dispose();
		}
	});

	it("runtime builtins and the JSX transform hold inside the VM realm", async () => {
		const session = await open({
			artifact: compiled([
				{
					path: "src/main.tsx",
					content: `import { Screen, Text, isRuntimeElement, isRuntimeHostComponent, runtimeHostKindOf } from "@rowcat/runtime";\nexport default function App() { return <Screen><Text>hi</Text></Screen>; }\nexport function probe() { const el = App() as unknown as { props: { children: unknown } }; return [isRuntimeElement(el), isRuntimeHostComponent(Screen), runtimeHostKindOf(Screen), typeof el.props.children]; }`,
				},
			]),
		});
		try {
			expect(await session.callExport("src/main.tsx", "probe", [])).toEqual({
				ok: true,
				value: [true, true, "screen", "object"],
			});
		} finally {
			await session.dispose();
		}
	});
});

describe("module boundaries", () => {
	it("imports not in the table fail deterministically: never falling back to host resolution", async () => {
		await expect(
			open({
				artifact: poc([
					{
						id: "src/main.ts",
						code: `import { x } from "./secret";\nexport const y = x;`,
						poc: false,
					},
					{ id: "src/secret.ts", code: "export const x = 1;", poc: false },
				]),
			}),
		).rejects.toMatchObject({
			code: RUNTIME_HOST_ERROR_CODE.moduleEvaluationFailed,
		});
	});

	it("bare names go nowhere", async () => {
		await expect(
			open({
				artifact: poc([
					{
						id: "src/main.ts",
						code: `import fs from "fs";\nexport const y = fs;`,
						poc: false,
					},
				]),
			}),
		).rejects.toMatchObject({
			code: RUNTIME_HOST_ERROR_CODE.moduleEvaluationFailed,
		});
	});

	it("artifacts pointing at builtins not installed are refused at validation", async () => {
		await expect(
			createRuntimeVmSession({
				engine: testEngine(),
				artifact: pocMain("export const x = 1;"),
			}),
		).rejects.toMatchObject({ code: RUNTIME_HOST_ERROR_CODE.artifactInvalid });
	});

	it("missing modules, missing exports and non-function exports", async () => {
		const session = await open({
			artifact: pocMain("export const value = 1;"),
		});
		try {
			expect(hostCode(await session.callExport("src/nope.ts", "x", []))).toBe(
				RUNTIME_HOST_ERROR_CODE.moduleUnknown,
			);
			expect(hostCode(await session.callExport("src/main.ts", "x", []))).toBe(
				RUNTIME_HOST_ERROR_CODE.exportMissing,
			);
			expect(
				hostCode(await session.callExport("src/main.ts", "value", [])),
			).toBe(RUNTIME_HOST_ERROR_CODE.exportNotCallable);
		} finally {
			await session.dispose();
		}
	});

	it("top-level await can wait on the host", async () => {
		const session = await open({
			artifact: pocMain(
				`const seed = await hostCall("test.echo", { n: 7 });\nexport function probe() { return seed.n * 6; }`,
			),
			capabilities: echo,
		});
		try {
			expect(await session.callExport("src/main.ts", "probe", [])).toEqual({
				ok: true,
				value: 42,
			});
		} finally {
			await session.dispose();
		}
	});
});

describe("wire", () => {
	it("nested arguments and results cross as is", async () => {
		const session = await open({
			artifact: pocMain("export function id(v) { return v; }"),
		});
		try {
			const value = { a: [1, 2.5, "x", null, true], b: { c: { d: [] } } };
			expect(await session.callExport("src/main.ts", "id", [value])).toEqual({
				ok: true,
				value,
			});
		} finally {
			await session.dispose();
		}
	});

	it("unsupported values are refused in both directions", async () => {
		const session = await open({
			artifact: pocMain(
				"export function fn() { return () => 1; }\nexport function cyc() { const o = {}; o.self = o; return o; }\nexport function und() {}",
			),
		});
		try {
			expect(
				hostCode(
					await session.callExport("src/main.ts", "fn", [
						(() => 1) as unknown as RuntimeWireValue,
					]),
				),
			).toBe(RUNTIME_HOST_ERROR_CODE.wireValueInvalid);
			expect(hostCode(await session.callExport("src/main.ts", "fn", []))).toBe(
				RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
			);
			expect(hostCode(await session.callExport("src/main.ts", "cyc", []))).toBe(
				RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
			);
			expect(hostCode(await session.callExport("src/main.ts", "und", []))).toBe(
				RUNTIME_HOST_ERROR_CODE.wireValueInvalid,
			);
		} finally {
			await session.dispose();
		}
	});
});

describe("host bridge", () => {
	const fixture =
		pocMain(`export async function run(v) { const r = await hostCall("test.echo", v); return { received: r }; }
export async function caught() { try { return await hostCall("test.fail", null); } catch (error) { return "caught:" + error.rowcatHostCode; } }
export async function throwsAfterAwait() { await hostCall("test.echo", 1); throw new TypeError("after await"); }
export async function unknown() { return await hostCall("test.nope", 1); }
export async function chain() { const a = await hostCall("test.echo", 1); const b = await hostCall("test.echo", a + 1); const c = await hostCall("test.echo", b + 1); return [a, b, c]; }
export function flood() { for (let i = 0; i < 100000; i += 1) hostCall("test.echo", i); return "unreachable"; }
export function never() { return new Promise(() => {}); }
export async function slow() { return await hostCall("test.slow", null); }`);

	it("the creator's promise resumes whether the host answers immediately or later", async () => {
		const session = await open({
			artifact: fixture,
			capabilities: {
				"test.echo": (payload) =>
					typeof payload === "number" && payload > 100
						? new Promise((resolve) => setTimeout(() => resolve(payload), 15))
						: payload,
			},
		});
		try {
			expect(
				await session.callExport("src/main.ts", "run", [{ hello: "rowcat" }]),
			).toEqual({ ok: true, value: { received: { hello: "rowcat" } } });
			expect(await session.callExport("src/main.ts", "run", [500])).toEqual({
				ok: true,
				value: { received: 500 },
			});
		} finally {
			await session.dispose();
		}
	});

	it("host refusals can be caught by the creator, and the host's stack does not cross", async () => {
		const session = await open({
			artifact: fixture,
			capabilities: {
				"test.fail": async () => {
					throw new Error("secret host detail /Users/nobody/app.ts:1");
				},
			},
		});
		try {
			expect(await session.callExport("src/main.ts", "caught", [])).toEqual({
				ok: true,
				value: `caught:${RUNTIME_HOST_ERROR_CODE.hostCallFailed}`,
			});
		} finally {
			await session.dispose();
		}
	});

	it("what is thrown after await is a creator error and keeps the module position", async () => {
		const session = await open({ artifact: fixture, capabilities: echo });
		try {
			const outcome = await session.callExport(
				"src/main.ts",
				"throwsAfterAwait",
				[],
			);
			expect(outcome.ok).toBe(false);
			if (outcome.ok) return;
			expect(outcome.error).toBeInstanceOf(CreatorExecutionError);
			const error = outcome.error as CreatorExecutionError;
			expect(error.creatorName).toBe("TypeError");
			expect(error.message).toBe("after await");
			expect(error.frames[0]?.moduleId).toBe("src/main.ts");
			expect(error.frames[0]?.line).toBe(4);
		} finally {
			await session.dispose();
		}
	});

	it("unknown capabilities are failures, and host properties are not called by reflection", async () => {
		const session = await open({ artifact: fixture, capabilities: echo });
		try {
			expect(
				hostCode(await session.callExport("src/main.ts", "unknown", [])),
			).toBe(RUNTIME_HOST_ERROR_CODE.hostCapabilityUnknown);
		} finally {
			await session.dispose();
		}
	});

	it("three consecutive host calls chain through the queue", async () => {
		const session = await open({ artifact: fixture, capabilities: echo });
		try {
			expect(await session.callExport("src/main.ts", "chain", [])).toEqual({
				ok: true,
				value: [1, 2, 3],
			});
		} finally {
			await session.dispose();
		}
	});

	it("a flood of calls stops at the pending limit", async () => {
		let served = 0;
		const session = await open({
			artifact: fixture,
			capabilities: {
				"test.echo": async (payload) => {
					served += 1;
					return payload;
				},
			},
			limits: { maxPendingHostCalls: 8 },
		});
		try {
			expect(
				hostCode(await session.callExport("src/main.ts", "flood", [])),
			).toBe(RUNTIME_HOST_ERROR_CODE.hostCallLimitExceeded);
			expect(served).toBeLessThanOrEqual(8);
		} finally {
			await session.dispose();
		}
	});

	it("a promise that never settles is reported as a stall", async () => {
		const session = await open({ artifact: fixture, capabilities: echo });
		try {
			expect(
				hostCode(await session.callExport("src/main.ts", "never", [])),
			).toBe(RUNTIME_HOST_ERROR_CODE.executionStalled);
		} finally {
			await session.dispose();
		}
	});

	it("disposing while waiting on the host cancels the call and aborts the signal", async () => {
		let aborted = false;
		let release: (() => void) | null = null;
		const session = await open({
			artifact: fixture,
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
		const call = session.callExport("src/main.ts", "slow", []);
		await new Promise((resolve) => setTimeout(resolve, 10));
		await session.dispose();
		expect(hostCode(await call)).toBe(RUNTIME_HOST_ERROR_CODE.cancelled);
		expect(aborted).toBe(true);
		/**
		 * A late completion after disposal must not re-enter the disposed VM. It neither throws nor stops
		 * anything.
		 */
		(release as (() => void) | null)?.();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(session.state).toBe("disposed");
	});
});

describe("resource limits", () => {
	it("a synchronous infinite loop is cut by the budget and the session fails", async () => {
		const session = await open({
			artifact: pocMain("export function loop() { while (true) {} }"),
			limits: { executionMs: 100 },
		});
		try {
			const started = Date.now();
			expect(
				hostCode(await session.callExport("src/main.ts", "loop", [])),
			).toBe(RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded);
			expect(Date.now() - started).toBeLessThan(2_000);
			expect(session.state).toBe("failed");
			expect(
				hostCode(await session.callExport("src/main.ts", "loop", [])),
			).toBe(RUNTIME_HOST_ERROR_CODE.sessionFailed);
		} finally {
			await session.dispose();
		}
	});

	it("a large synchronous loop has the same budget", async () => {
		const session = await open({
			artifact: pocMain(
				"export function big() { let s = 0; for (let i = 0; i < 1e10; i += 1) s += i; return s; }",
			),
			limits: { executionMs: 100 },
		});
		try {
			expect(hostCode(await session.callExport("src/main.ts", "big", []))).toBe(
				RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded,
			);
		} finally {
			await session.dispose();
		}
	});

	it("runaway recursion is a catchable creator error and the VM stays alive", async () => {
		const session = await open({
			artifact: pocMain(
				"export function rec() { return rec(); }\nexport function ok() { return 1; }",
			),
		});
		try {
			const outcome = await session.callExport("src/main.ts", "rec", []);
			expect(outcome.ok).toBe(false);
			if (outcome.ok) return;
			expect(outcome.error).toBeInstanceOf(CreatorExecutionError);
			expect((outcome.error as CreatorExecutionError).creatorName).toBe(
				"RangeError",
			);
			expect(await session.callExport("src/main.ts", "ok", [])).toEqual({
				ok: true,
				value: 1,
			});
		} finally {
			await session.dispose();
		}
	});

	it("runaway memory is cut at the limit", async () => {
		const session = await open({
			artifact: pocMain(
				'export function mem() { const values = []; while (true) { values.push("x".repeat(1_000_000)); } }',
			),
			limits: { memoryBytes: 8 * 1024 * 1024, executionMs: 10_000 },
		});
		try {
			const started = Date.now();
			expect(hostCode(await session.callExport("src/main.ts", "mem", []))).toBe(
				RUNTIME_HOST_ERROR_CODE.memoryLimitExceeded,
			);
			expect(Date.now() - started).toBeLessThan(5_000);
			expect(session.state).toBe("failed");
		} finally {
			await session.dispose();
		}
	});
});

describe("isolation", () => {
	it("browser and Node globals are not visible", async () => {
		const names = [
			"window",
			"document",
			"navigator",
			"localStorage",
			"indexedDB",
			"process",
			"require",
			"module",
			"Buffer",
			"fetch",
			"WebSocket",
			"XMLHttpRequest",
			"Worker",
			"WebAssembly",
			"eval",
			"Function",
			"setTimeout",
		];
		const session = await open({
			artifact:
				pocMain(`export function probe(names) { return names.map((n) => typeof globalThis[n]); }
export function dynamic() { try { (function () {}).constructor("return 1")(); return "allowed"; } catch (e) { return "blocked:" + e.message; } }
export function directEval() { try { return eval("1+1"); } catch (e) { return "blocked:" + e.name; } }
export function asyncCtor() { try { (async function () {}).constructor("return 1"); return "allowed"; } catch (e) { return "blocked"; } }`),
		});
		try {
			expect(await session.callExport("src/main.ts", "probe", [names])).toEqual(
				{ ok: true, value: names.map(() => "undefined") },
			);
			expect(await session.callExport("src/main.ts", "dynamic", [])).toEqual({
				ok: true,
				value: "blocked:dynamic code is not available in the RowCat runtime",
			});
			expect(await session.callExport("src/main.ts", "directEval", [])).toEqual(
				{ ok: true, value: "blocked:ReferenceError" },
			);
			expect(await session.callExport("src/main.ts", "asyncCtor", [])).toEqual({
				ok: true,
				value: "blocked",
			});
		} finally {
			await session.dispose();
		}
	});

	it("the bridge global vanishes before creator code runs", async () => {
		const session = await open({
			artifact: pocMain(
				'export const seen = typeof globalThis.__rowcatBridge + "/" + typeof globalThis.__rowcatNative;\nexport function probe() { return seen; }',
			),
		});
		try {
			expect(await session.callExport("src/main.ts", "probe", [])).toEqual({
				ok: true,
				value: "undefined/undefined",
			});
		} finally {
			await session.dispose();
		}
	});

	it("the console reaches the host as serialized values", async () => {
		const lines: unknown[] = [];
		const session = await open({
			artifact: pocMain(
				'export function log() { console.log("a", { b: [1] }); console.warn(() => 1); return 1; }',
			),
			onConsole: (level, args) => lines.push([level, args]),
		});
		try {
			await session.callExport("src/main.ts", "log", []);
			expect(lines[0]).toEqual(["log", ["a", { b: [1] }]]);
			expect(lines[1]?.toString()).toContain("warn");
		} finally {
			await session.dispose();
		}
	});
});

describe("lifecycle", () => {
	/**
	 * Phase 3 serialized two calls completely: the second did not start while the first waited on the
	 * host. With the scheduler, calls interleave per turn. While call a waits on the host, the first
	 * turn of b runs, and a's completion returns to the queue and continues. Still, only one VM turn
	 * runs at a time, because both executions share one counter and the numbers must never collide.
	 */
	it("two calls started together interleave per turn, entering the VM one at a time", async () => {
		const session = await open({
			artifact: pocMain(
				'let counter = 0;\nexport async function bump(label) { counter += 1; const mine = counter; await hostCall("test.echo", label); counter += 1; return [label, mine, counter]; }',
			),
			capabilities: echo,
		});
		try {
			const [a, b] = await Promise.all([
				session.callExport("src/main.ts", "bump", ["a"]),
				session.callExport("src/main.ts", "bump", ["b"]),
			]);
			expect(a).toEqual({ ok: true, value: ["a", 1, 3] });
			expect(b).toEqual({ ok: true, value: ["b", 2, 4] });
			expect(session.state).toBe("ready");
			expect(session.metrics().scheduler.hostCompletions).toBe(2);
		} finally {
			await session.dispose();
		}
	});

	it("dispose is idempotent and nothing enters after it", async () => {
		const session = await open({
			artifact: pocMain("export function one() { return 1; }"),
		});
		const first = session.dispose();
		const second = session.dispose();
		expect(first).toBe(second);
		await Promise.all([first, second]);
		expect(session.state).toBe("disposed");
		expect(hostCode(await session.callExport("src/main.ts", "one", []))).toBe(
			RUNTIME_HOST_ERROR_CODE.disposed,
		);
		expect(session.memoryUsedBytes()).toBeNull();
	});

	it("sessions opened with the same artifact are independent of device and path", async () => {
		const artifact = pocMain("export function one() { return 1; }");
		const a = await open({ artifact, sessionId: "fixed" });
		const b = await open({ artifact, sessionId: "fixed" });
		try {
			expect(a.id).toBe("fixed");
			expect(await a.callExport("src/main.ts", "one", [])).toEqual(
				await b.callExport("src/main.ts", "one", []),
			);
		} finally {
			await a.dispose();
			await b.dispose();
		}
	});
});

describe("internal builtins", () => {
	it("artifacts pointing at rowcat:internal/symbols are refused at validation", async () => {
		await expect(
			open({
				artifact:
					poc([
						{
							id: "src/main.ts",
							code: `import { ELEMENT } from "rowcat:internal/symbols";\nexport const x = ELEMENT;`,
							poc: false,
						},
					]).modules.length === 1
						? {
								...poc([{ id: "src/main.ts", code: "export {};", poc: false }]),
								modules: [
									{
										id: "src/main.ts",
										code: `import { ELEMENT } from "rowcat:internal/symbols";\nexport const x = ELEMENT;`,
										dependencies: [
											{
												specifier: "rowcat:internal/symbols",
												kind: "builtin",
												resolved: "rowcat:internal/symbols",
											},
										],
									},
								],
							}
						: null,
			}),
		).rejects.toMatchObject({ code: RUNTIME_HOST_ERROR_CODE.artifactInvalid });
	});

	it("writing it by name without the table does not resolve", async () => {
		await expect(
			open({
				artifact: poc([
					{
						id: "src/main.ts",
						code: `import { ELEMENT } from "rowcat:internal/symbols";\nexport const x = ELEMENT;`,
						poc: false,
					},
				]),
			}),
		).rejects.toMatchObject({
			code: RUNTIME_HOST_ERROR_CODE.moduleEvaluationFailed,
		});
	});
});
