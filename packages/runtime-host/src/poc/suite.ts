import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import type { RuntimeCapabilityRegistry } from "../capabilities.ts";
import {
	CreatorExecutionError,
	RUNTIME_HOST_ERROR_CODE,
	RuntimeHostError,
} from "../errors.ts";
import {
	createRuntimeVmSession,
	type RuntimeCallOutcome,
	type RuntimeSessionSchedulingOptions,
	type RuntimeVmSession,
} from "../session.ts";
import type { RuntimeVmEngine } from "../vm/types.ts";
import type { RuntimeWireValue } from "../wire.ts";
import { POC_COMPILED_ARTIFACT } from "./compiled-fixture.ts";
import { POC_BUILTIN_ID, POC_HOST_BUILTIN } from "./host-builtin.ts";

/**
 * The Phase 3 PoC suite. Three platforms run the same checks.
 *
 * The web worker, iOS, and Android harnesses each build their own engine and host bridge, then call
 * this one function. As a result, the PASS/FAIL lines in the three decision records come from the
 * same list, and no check is missing on one platform. Node tests run the same suite
 * (suite.test.ts), which is the evidence that the suite itself is correct.
 *
 * The host bridge is a parameter because on the native harness the capability handlers live on the
 * Hermes side, and the WebView host calls them over postMessage. That round trip is the three-layer
 * path: trusted native adapter, then WASM VM host, then the creator's VM. If the suite skipped that
 * layer, a native pass would prove less. The default bridge is an in-process implementation.
 *
 * The measurements are not a benchmark. Their only use here is to detect catastrophic cost. They
 * are not optimized, and the values are recorded in the decision records as they are.
 */

export interface PocHostBridge {
	echo(payload: RuntimeWireValue): Promise<RuntimeWireValue>;
	/** Always rejects. The rejection message contains host details that must never reach the VM. */
	fail(): Promise<RuntimeWireValue>;
	/** Never settles until the signal aborts. This is the input to the cancellation check. */
	slow(signal: AbortSignal): Promise<RuntimeWireValue>;
}

export const inProcessBridge = (): PocHostBridge => ({
	echo: async (payload) => payload,
	fail: async () => {
		throw new Error("host-only detail: /internal/path.ts:12");
	},
	slow: (signal) =>
		new Promise((resolve) => {
			signal.addEventListener("abort", () => resolve("late"), { once: true });
		}),
});

export interface PocStep {
	name: string;
	ok: boolean;
	detail: string;
	ms: number;
}

export interface PocMeasurements {
	/** The first session. Counts WASM compilation and instantiation together. */
	coldSessionMs: number;
	/** The second session. Reuses the compiled module. */
	warmSessionMs: number;
	warmCreateVmMs: number;
	warmBootstrapMs: number;
	warmEvaluateGraphMs: number;
	/** Average time of a call that takes two arguments and returns a number, in microseconds. */
	callRoundTripUs: number;
	/**
	 * Average time of a call that waits on a host capability that answers immediately, in
	 * microseconds.
	 */
	hostRoundTripUs: number;
	/**
	 * Average time of a call that waits on a host capability that answers after one macrotask, in
	 * microseconds.
	 */
	asyncHostRoundTripUs: number;
	disposeMs: number;
	/** Linear memory of one session in bytes, measured right after graph evaluation. */
	baselineMemoryBytes: number | null;
}

/**
 * One stack-probe row. At which ceiling does runaway recursion get caught, and at which does it
 * leak to the host?
 *
 * `contained` means a creator RangeError caught it and the same session still answered afterward.
 * `leaked` means a host exception, engine failure, or disposal failure occurred, so that ceiling
 * cannot be used on this platform. The probes run last in the suite. A leaking ceiling can corrupt
 * the process, so the earlier results must be emitted first.
 */
export interface PocStackProbe {
	ceilingBytes: number;
	outcome: "contained" | "leaked";
	/** Whether all three repetitions (fail, dispose, retry) gave the same answer. */
	repeatable: boolean;
	detail: string;
}

export interface PocReport {
	platform: string;
	engine: string;
	ok: boolean;
	steps: PocStep[];
	measurements: PocMeasurements;
	/** Empty when the probes were not run. */
	stackProbe: PocStackProbe[];
}

export interface PocSuiteOptions {
	engine: RuntimeVmEngine;
	platform: string;
	bridge?: PocHostBridge;
	/** How the host produces "one macrotask later". Defaults to `setTimeout(0)`. */
	defer?: () => Promise<void>;
	/** Called after each step. This is where the harness draws progress. */
	onStep?: (step: PocStep) => void;
	/**
	 * The platform clock and yield port. Without it, the session default (`setTimeout(0)`) is used.
	 */
	scheduling?: RuntimeSessionSchedulingOptions;
	/**
	 * Stack probe: for each ceiling candidate, creates an engine that allows that ceiling. The
	 * adapter's default ceiling (128 KiB) would cut off the candidates, so the suite cannot create the
	 * engines directly.
	 */
	stackProbe?: {
		ceilings: readonly number[];
		engineFor: (ceilingBytes: number) => RuntimeVmEngine;
	};
}

const now = (): number =>
	typeof performance === "object" && typeof performance.now === "function"
		? performance.now()
		: Date.now();

const defaultDefer = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));

const hostCode = (outcome: RuntimeCallOutcome): string | null =>
	!outcome.ok && outcome.error instanceof RuntimeHostError
		? outcome.error.code
		: null;

const describe = (outcome: RuntimeCallOutcome): string =>
	outcome.ok
		? JSON.stringify(outcome.value)
		: `${outcome.error.name}:${
				outcome.error instanceof RuntimeHostError
					? outcome.error.code
					: outcome.error.message
			}`;

const pocArtifact = (code: string) => ({
	formatVersion: 1,
	apiVersion: RUNTIME_API_VERSION,
	compilerVersion: 1,
	entry: "src/main.ts",
	sourceHash: "poc",
	modules: [
		{
			id: "src/main.ts",
			code: `import { hostCall } from ${JSON.stringify(POC_BUILTIN_ID)};\n${code}`,
			dependencies: [
				{
					specifier: POC_BUILTIN_ID,
					kind: "builtin",
					resolved: POC_BUILTIN_ID,
				},
			],
		},
	],
});

const BRIDGE_FIXTURE =
	pocArtifact(`export async function run(v) { const r = await hostCall("test.echo", v); return { received: r }; }
export async function caught() { try { return await hostCall("test.fail", null); } catch (error) { return "caught:" + error.rowcatHostCode + ":" + error.message; } }
export async function throwsAfterAwait() { await hostCall("test.echo", 1); throw new TypeError("after await"); }
export async function unknown() { return await hostCall("test.nope", 1); }
export async function chain() { const a = await hostCall("test.echo", 1); const b = await hostCall("test.echo", a + 1); const c = await hostCall("test.echo", b + 1); return [a, b, c]; }
export function flood() { for (let i = 0; i < 100000; i += 1) hostCall("test.echo", i); return "unreachable"; }
export async function slow() { return await hostCall("test.slow", null); }
export function loop() { while (true) {} }
export function rec() { return rec(); }
export function ok() { return "alive"; }
export function mem() { const values = []; while (true) { values.push(new Array(125000).fill(1)); } }
export function globals(names) { return names.map((n) => typeof globalThis[n]); }
export function dynamic() { try { (function () {}).constructor("return 1")(); return "allowed"; } catch (e) { return "blocked"; } }
export function log() { console.log("poc", { n: 1 }); return 1; }
export function add(a, b) { return a + b; }`);

const HIDDEN_GLOBALS = [
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

export async function runRuntimeVmPoc(
	options: PocSuiteOptions,
): Promise<PocReport> {
	const bridge = options.bridge ?? inProcessBridge();
	const defer = options.defer ?? defaultDefer;
	const steps: PocStep[] = [];
	const capabilities: RuntimeCapabilityRegistry = {
		"test.echo": (payload) => bridge.echo(payload),
		"test.fail": () => bridge.fail(),
		"test.slow": (_payload, context) => bridge.slow(context.signal),
	};
	const open = (
		artifact: unknown,
		extra: Partial<Parameters<typeof createRuntimeVmSession>[0]> = {},
	) =>
		createRuntimeVmSession({
			engine: options.engine,
			artifact,
			builtins: [POC_HOST_BUILTIN],
			capabilities,
			...(options.scheduling === undefined
				? {}
				: { scheduling: options.scheduling }),
			...extra,
		});

	const step = async (
		name: string,
		body: () => Promise<{ ok: boolean; detail: string }>,
	): Promise<void> => {
		const started = now();
		let recorded: PocStep;
		try {
			const result = await body();
			recorded = { name, ...result, ms: now() - started };
		} catch (cause) {
			recorded = {
				name,
				ok: false,
				detail: `threw ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`,
				ms: now() - started,
			};
		}
		steps.push(recorded);
		options.onStep?.(recorded);
	};

	const withSession = async (
		artifact: unknown,
		extra: Partial<Parameters<typeof createRuntimeVmSession>[0]>,
		body: (
			session: RuntimeVmSession,
		) => Promise<{ ok: boolean; detail: string }>,
	) => {
		const session = await open(artifact, extra);
		try {
			return await body(session);
		} finally {
			await session.dispose();
		}
	};

	const measurements: PocMeasurements = {
		coldSessionMs: 0,
		warmSessionMs: 0,
		warmCreateVmMs: 0,
		warmBootstrapMs: 0,
		warmEvaluateGraphMs: 0,
		callRoundTripUs: 0,
		hostRoundTripUs: 0,
		asyncHostRoundTripUs: 0,
		disposeMs: 0,
		baselineMemoryBytes: null,
	};

	await step(
		"compiled artifact: evaluate, call export, cycle, singleton, JSX",
		async () => {
			const started = now();
			const session = await open(POC_COMPILED_ARTIFACT);
			measurements.coldSessionMs = now() - started;
			try {
				const add = await session.callExport("src/main.tsx", "add", [20, 22]);
				const probe = await session.callExport("src/main.tsx", "probe", []);
				const expectedProbe = JSON.stringify([true, 1, 2, 42]);
				const ok =
					JSON.stringify(add) === JSON.stringify({ ok: true, value: 42 }) &&
					probe.ok &&
					JSON.stringify(probe.value) === expectedProbe;
				return { ok, detail: `add=${describe(add)} probe=${describe(probe)}` };
			} finally {
				await session.dispose();
			}
		},
	);

	await step("warm session timings", async () => {
		const started = now();
		const session = await open(POC_COMPILED_ARTIFACT);
		measurements.warmSessionMs = now() - started;
		measurements.warmCreateVmMs = session.timings.createVmMs;
		measurements.warmBootstrapMs = session.timings.bootstrapMs;
		measurements.warmEvaluateGraphMs = session.timings.evaluateGraphMs;
		measurements.baselineMemoryBytes = session.memoryUsedBytes();
		const disposeStarted = now();
		await session.dispose();
		measurements.disposeMs = now() - disposeStarted;
		return {
			ok: true,
			detail: `warm=${measurements.warmSessionMs.toFixed(2)}ms`,
		};
	});

	await step("unknown module cannot fall back to host resolution", async () => {
		try {
			await open({
				...pocArtifact("export const x = 1;"),
				modules: [
					{
						id: "src/main.ts",
						code: 'import fs from "fs";\nexport const x = fs;',
						dependencies: [],
					},
				],
			});
			return { ok: false, detail: "session opened" };
		} catch (cause) {
			const code = cause instanceof RuntimeHostError ? cause.code : "?";
			return {
				ok: code === RUNTIME_HOST_ERROR_CODE.moduleEvaluationFailed,
				detail: code,
			};
		}
	});

	await step("artifact validation rejects unknown built-ins", async () => {
		try {
			await createRuntimeVmSession({
				engine: options.engine,
				artifact: pocArtifact("export const x = 1;"),
			});
			return { ok: false, detail: "session opened" };
		} catch (cause) {
			const code = cause instanceof RuntimeHostError ? cause.code : "?";
			return {
				ok: code === RUNTIME_HOST_ERROR_CODE.artifactInvalid,
				detail: code,
			};
		}
	});

	await withSession(BRIDGE_FIXTURE, {}, async (session) => {
		await step("wire round trip through export call", async () => {
			const value = { a: [1, 2.5, "x", null, true], b: { c: { d: [] } } };
			const outcome = await session.callExport("src/main.ts", "run", [value]);
			return {
				ok:
					JSON.stringify(outcome) ===
					JSON.stringify({ ok: true, value: { received: value } }),
				detail: describe(outcome),
			};
		});
		await step(
			"host rejection is caught by creator without host details",
			async () => {
				const outcome = await session.callExport("src/main.ts", "caught", []);
				const ok =
					outcome.ok &&
					outcome.value ===
						`caught:${RUNTIME_HOST_ERROR_CODE.hostCallFailed}:host capability failed`;
				return { ok, detail: describe(outcome) };
			},
		);
		await step(
			"creator throw after await is a creator error with module frames",
			async () => {
				const outcome = await session.callExport(
					"src/main.ts",
					"throwsAfterAwait",
					[],
				);
				const error = !outcome.ok ? outcome.error : null;
				const ok =
					error instanceof CreatorExecutionError &&
					error.creatorName === "TypeError" &&
					error.frames[0]?.moduleId === "src/main.ts";
				return {
					ok,
					detail:
						error instanceof CreatorExecutionError
							? JSON.stringify(error.frames[0])
							: describe(outcome),
				};
			},
		);
		await step("unknown capability fails", async () => {
			const outcome = await session.callExport("src/main.ts", "unknown", []);
			return {
				ok: hostCode(outcome) === RUNTIME_HOST_ERROR_CODE.hostCapabilityUnknown,
				detail: describe(outcome),
			};
		});
		await step("nested host calls from async continuations", async () => {
			const outcome = await session.callExport("src/main.ts", "chain", []);
			return {
				ok:
					JSON.stringify(outcome) ===
					JSON.stringify({ ok: true, value: [1, 2, 3] }),
				detail: describe(outcome),
			};
		});
		await step("hidden globals", async () => {
			const outcome = await session.callExport("src/main.ts", "globals", [
				HIDDEN_GLOBALS,
			]);
			const ok =
				outcome.ok &&
				Array.isArray(outcome.value) &&
				outcome.value.every((type) => type === "undefined");
			return { ok, detail: describe(outcome) };
		});
		await step("dynamic code blocked", async () => {
			const outcome = await session.callExport("src/main.ts", "dynamic", []);
			return {
				ok: outcome.ok && outcome.value === "blocked",
				detail: describe(outcome),
			};
		});
		await step("recursion is contained and the VM survives", async () => {
			const outcome = await session.callExport("src/main.ts", "rec", []);
			const alive = await session.callExport("src/main.ts", "ok", []);
			const ok =
				!outcome.ok &&
				outcome.error instanceof CreatorExecutionError &&
				outcome.error.creatorName === "RangeError" &&
				alive.ok;
			return { ok, detail: `${describe(outcome)} then ${describe(alive)}` };
		});

		const calls = 200;
		let started = now();
		for (let i = 0; i < calls; i += 1)
			await session.callExport("src/main.ts", "add", [i, 1]);
		measurements.callRoundTripUs = ((now() - started) / calls) * 1000;
		const hostCalls = 50;
		started = now();
		for (let i = 0; i < hostCalls; i += 1)
			await session.callExport("src/main.ts", "run", [i]);
		measurements.hostRoundTripUs = ((now() - started) / hostCalls) * 1000;
		return { ok: true, detail: "" };
	});

	await step("async host completion resumes the creator promise", async () => {
		const deferredBridge: PocHostBridge = {
			...bridge,
			echo: async (payload) => {
				await defer();
				return bridge.echo(payload);
			},
		};
		return withSession(
			BRIDGE_FIXTURE,
			{
				capabilities: {
					"test.echo": (payload) => deferredBridge.echo(payload),
				},
			},
			async (session) => {
				const outcome = await session.callExport("src/main.ts", "run", [
					{ hello: "rowcat" },
				]);
				const hostCalls = 20;
				const started = now();
				for (let i = 0; i < hostCalls; i += 1)
					await session.callExport("src/main.ts", "run", [i]);
				measurements.asyncHostRoundTripUs =
					((now() - started) / hostCalls) * 1000;
				return {
					ok:
						JSON.stringify(outcome) ===
						JSON.stringify({
							ok: true,
							value: { received: { hello: "rowcat" } },
						}),
					detail: describe(outcome),
				};
			},
		);
	});

	await step("console routes serialized values to the host", async () => {
		const lines: unknown[] = [];
		return withSession(
			BRIDGE_FIXTURE,
			{ onConsole: (level, args) => lines.push([level, args]) },
			async (session) => {
				await session.callExport("src/main.ts", "log", []);
				const detail = JSON.stringify(lines);
				return {
					ok: detail === JSON.stringify([["log", ["poc", { n: 1 }]]]),
					detail,
				};
			},
		);
	});

	await step(
		"infinite loop is interrupted by the execution budget",
		async () => {
			return withSession(
				BRIDGE_FIXTURE,
				{ limits: { executionMs: 100 } },
				async (session) => {
					const started = now();
					const outcome = await session.callExport("src/main.ts", "loop", []);
					const elapsed = now() - started;
					const again = await session.callExport("src/main.ts", "ok", []);
					const ok =
						hostCode(outcome) ===
							RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded &&
						elapsed < 2_000 &&
						hostCode(again) === RUNTIME_HOST_ERROR_CODE.sessionFailed;
					return {
						ok,
						detail: `${describe(outcome)} after ${elapsed.toFixed(0)}ms; then ${describe(again)}`,
					};
				},
			);
		},
	);

	await step("memory growth is bounded", async () => {
		return withSession(
			BRIDGE_FIXTURE,
			{ limits: { memoryBytes: 24 * 1024 * 1024, executionMs: 10_000 } },
			async (session) => {
				const started = now();
				const outcome = await session.callExport("src/main.ts", "mem", []);
				const elapsed = now() - started;
				const memory = session.memoryUsedBytes();
				const ok =
					hostCode(outcome) === RUNTIME_HOST_ERROR_CODE.memoryLimitExceeded &&
					memory !== null &&
					memory <= 24 * 1024 * 1024;
				return {
					ok,
					detail: `${describe(outcome)} after ${elapsed.toFixed(0)}ms, linear memory ${memory} bytes`,
				};
			},
		);
	});

	await step("host call flooding is bounded", async () => {
		let served = 0;
		return withSession(
			BRIDGE_FIXTURE,
			{
				limits: { maxPendingHostCalls: 8 },
				capabilities: {
					"test.echo": async (payload) => {
						served += 1;
						return bridge.echo(payload);
					},
				},
			},
			async (session) => {
				const outcome = await session.callExport("src/main.ts", "flood", []);
				return {
					ok:
						hostCode(outcome) ===
							RUNTIME_HOST_ERROR_CODE.hostCallLimitExceeded && served <= 8,
					detail: `${describe(outcome)}, served ${served}`,
				};
			},
		);
	});

	await step(
		"dispose during a pending host call cancels it and aborts the signal",
		async () => {
			let aborted = false;
			const session = await open(BRIDGE_FIXTURE, {
				capabilities: {
					"test.slow": (_payload, context) => {
						context.signal.addEventListener("abort", () => {
							aborted = true;
						});
						return bridge.slow(context.signal);
					},
				},
			});
			const call = session.callExport("src/main.ts", "slow", []);
			await defer();
			await session.dispose();
			const outcome = await call;
			await defer();
			const ok =
				hostCode(outcome) === RUNTIME_HOST_ERROR_CODE.cancelled &&
				aborted &&
				session.state === "disposed";
			return {
				ok,
				detail: `${describe(outcome)}, aborted=${aborted}, state=${session.state}`,
			};
		},
	);

	await step(
		"dispose is idempotent and the session cannot be re-entered",
		async () => {
			const session = await open(BRIDGE_FIXTURE);
			const first = session.dispose();
			const second = session.dispose();
			await Promise.all([first, second]);
			const outcome = await session.callExport("src/main.ts", "ok", []);
			const ok =
				first === second &&
				hostCode(outcome) === RUNTIME_HOST_ERROR_CODE.disposed &&
				session.state === "disposed";
			return { ok, detail: describe(outcome) };
		},
	);

	const stackProbe: PocStackProbe[] = [];
	for (const ceilingBytes of options.stackProbe?.ceilings ?? []) {
		const engine = options.stackProbe?.engineFor(ceilingBytes);
		if (engine === undefined) break;
		const answers: string[] = [];
		for (let round = 0; round < 3; round += 1) {
			try {
				const session = await createRuntimeVmSession({
					engine,
					artifact: BRIDGE_FIXTURE,
					builtins: [POC_HOST_BUILTIN],
					capabilities,
					limits: { maxStackBytes: ceilingBytes },
				});
				try {
					const outcome = await session.callExport("src/main.ts", "rec", []);
					const alive = await session.callExport("src/main.ts", "ok", []);
					answers.push(
						!outcome.ok &&
							outcome.error instanceof CreatorExecutionError &&
							outcome.error.creatorName === "RangeError" &&
							alive.ok
							? "contained"
							: `unexpected:${describe(outcome)}`,
					);
				} finally {
					await session.dispose();
				}
			} catch (cause) {
				answers.push(
					`leaked:${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`,
				);
			}
		}
		const contained = answers.every((answer) => answer === "contained");
		stackProbe.push({
			ceilingBytes,
			outcome: contained ? "contained" : "leaked",
			repeatable: new Set(answers).size === 1,
			detail: answers.join(" · "),
		});
		if (!contained) break;
	}

	return {
		platform: options.platform,
		engine: options.engine.name,
		ok: steps.every((step) => step.ok),
		steps,
		measurements,
		stackProbe,
	};
}
