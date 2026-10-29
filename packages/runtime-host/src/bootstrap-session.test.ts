import {
	RUNTIME_API_MIN_COMPATIBLE_VERSION,
	RUNTIME_API_VERSION,
} from "@rowcat/runtime/declarations";
import type { RuntimeArtifact } from "@rowcat/runtime-compiler/contracts";
import { describe, expect, it } from "vitest";
import { CURRENT_RUNTIME_SANDBOX } from "./bootstrap.ts";
import {
	DISPATCHER_BUILTIN_ID,
	SYMBOLS_BUILTIN_ID,
} from "./builtins/modules.ts";
import { RUNTIME_HOST_ERROR_CODE, RuntimeHostError } from "./errors.ts";
import { POC_HOST_BUILTIN } from "./poc/host-builtin.ts";
import { createRuntimeVmSession } from "./session.ts";
import { compiled, poc, testEngine } from "./test/fixtures.ts";
import type { RuntimeVmEngine } from "./vm/types.ts";

/**
 * What booting in a real VM guarantees: the compatibility check runs before the VM is created, the
 * generated runtime runs, and the dispatcher slot is empty, but only the host may fill it.
 */

const hostCode = (outcome: { ok: boolean; error?: unknown }): string | null =>
	!outcome.ok && outcome.error instanceof RuntimeHostError
		? outcome.error.code
		: null;

/**
 * Engine that counts how many VMs were created. It shows whether the compatibility check runs
 * before creation.
 */
const countingEngine = (): RuntimeVmEngine & { created: number } => {
	const real = testEngine();
	const engine = {
		name: real.name,
		created: 0,
		create: async (options: Parameters<RuntimeVmEngine["create"]>[0]) => {
			engine.created += 1;
			return real.create(options);
		},
	};
	return engine;
};

const app = () =>
	compiled([
		{
			path: "src/main.tsx",
			content: `import { Screen, Text, useState } from "@rowcat/runtime";\nexport function hook() { try { const [v] = useState(7); return "value:" + v; } catch (e) { return "threw:" + (e as { code: string }).code; } }\nexport default function App() { return <Screen><Text>hi</Text></Screen>; }`,
		},
	]);

describe("compatibility decision", () => {
	it("a mismatched api version is refused before creating the VM", async () => {
		const engine = countingEngine();
		await expect(
			createRuntimeVmSession({
				engine,
				artifact: app(),
				sandbox: { ...CURRENT_RUNTIME_SANDBOX, apiVersion: 99 },
			}),
		).rejects.toMatchObject({
			code: RUNTIME_HOST_ERROR_CODE.sandboxIncompatible,
		});
		expect(engine.created).toBe(0);
	});

	it("does not boot when generated modules are missing", async () => {
		const engine = countingEngine();
		await expect(
			createRuntimeVmSession({
				engine,
				artifact: app(),
				sandbox: {
					...CURRENT_RUNTIME_SANDBOX,
					modules: CURRENT_RUNTIME_SANDBOX.modules.filter(
						(m) => m.id !== "rowcat:runtime",
					),
				},
			}),
		).rejects.toMatchObject({
			code: RUNTIME_HOST_ERROR_CODE.sandboxIncompatible,
		});
		expect(engine.created).toBe(0);
	});

	it("an artifact api version newer than the host is refused at validation", async () => {
		await expect(
			createRuntimeVmSession({
				engine: testEngine(),
				artifact: { ...app(), apiVersion: 99 },
			}),
		).rejects.toMatchObject({ code: RUNTIME_HOST_ERROR_CODE.artifactInvalid });
	});

	it("old versions below the window and non-integer versions are refused before creating the VM", async () => {
		for (const apiVersion of [RUNTIME_API_MIN_COMPATIBLE_VERSION - 1, "7"]) {
			const engine = countingEngine();
			await expect(
				createRuntimeVmSession({
					engine,
					artifact: { ...app(), apiVersion } as unknown as RuntimeArtifact,
				}),
			).rejects.toMatchObject({
				code: RUNTIME_HOST_ERROR_CODE.artifactInvalid,
			});
			expect(engine.created).toBe(0);
		}
	});

	/**
	 * The previous API version inside the window actually runs. It is not only validated: the VM boots
	 * and the module is evaluated.
	 *
	 * An artifact compiled against the previous version has the same shape as one compiled now,
	 * because the compiler version did not change. Declaring the previous version on the current
	 * artifact is therefore an exact imitation of it.
	 */
	it("old versions inside the window boot and run: the identity adapter is a fact", async () => {
		const previous = RUNTIME_API_VERSION - 1;
		if (previous < RUNTIME_API_MIN_COMPATIBLE_VERSION) return;
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: { ...app(), apiVersion: previous },
		});
		try {
			/**
			 * The fixture's `hook` catches an exception and returns it as a string. That is evidence the
			 * module was evaluated and actually ran.
			 */
			expect(await session.callExport("src/main.tsx", "hook", [])).toEqual({
				ok: true,
				value: "threw:runtime_hook_outside_render",
			});
		} finally {
			await session.dispose();
		}
	});
});

describe("generated runtime", () => {
	it("asset and color validation from the real source runs inside the VM", async () => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: compiled([
				{
					path: "src/main.tsx",
					content: `import { asset, color, RuntimeError } from "@rowcat/runtime";\nexport function ok() { asset("characters/sena/smile"); return color("#ff00aa"); }\nexport function badAsset() { try { asset("https://x"); return "allowed"; } catch (e) { return e instanceof RuntimeError ? e.code : "other"; } }\nexport default function App() { return null; }`,
				},
			]),
		});
		try {
			expect(await session.callExport("src/main.tsx", "ok", [])).toEqual({
				ok: true,
				value: "#ff00aa",
			});
			expect(await session.callExport("src/main.tsx", "badAsset", [])).toEqual({
				ok: true,
				value: "runtime_invalid_asset_ref",
			});
		} finally {
			await session.dispose();
		}
	});

	it("artifacts cannot point at internal modules: dispatcher, symbols, bridge", async () => {
		for (const id of [
			DISPATCHER_BUILTIN_ID,
			SYMBOLS_BUILTIN_ID,
			"rowcat:internal/host",
			"rowcat:internal/hooks",
		]) {
			const artifact = poc([
				{ id: "src/main.ts", code: "export const x = 1;", poc: false },
			]);
			await expect(
				createRuntimeVmSession({
					engine: testEngine(),
					artifact: {
						...artifact,
						modules: [
							{
								id: "src/main.ts",
								code: `import * as m from ${JSON.stringify(id)};\nexport const x = m;`,
								dependencies: [
									{ specifier: id, kind: "builtin", resolved: id },
								],
							},
						],
					},
				}),
			).rejects.toMatchObject({
				code: RUNTIME_HOST_ERROR_CODE.artifactInvalid,
			});
		}
	});

	it("production boot holds without the PoC bridge", async () => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: app(),
		});
		try {
			expect(session.state).toBe("ready");
		} finally {
			await session.dispose();
		}
	});
});

describe("dispatcher slot", () => {
	const fakeDispatcher = {
		id: "rowcat:internal/test-dispatcher",
		internal: true,
		source: `export const dispatcher = { useState: (initial) => [initial, () => {}], useReducer: (r, i) => [i, () => {}], useMemo: (f) => f(), useRef: (i) => ({ current: i }), useEffect: () => {} };\nexport const notAFunction = 1;`,
	};

	it("hooks throw deterministically when it is empty", async () => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: app(),
		});
		try {
			expect(await session.hasDispatcher()).toBe(false);
			expect(await session.callExport("src/main.tsx", "hook", [])).toEqual({
				ok: true,
				value: "threw:runtime_hook_outside_render",
			});
		} finally {
			await session.dispose();
		}
	});

	it("the host plugs and unplugs internal builtin implementations", async () => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: app(),
			builtins: [POC_HOST_BUILTIN, fakeDispatcher],
		});
		try {
			expect(
				await session.bindDispatcher({
					moduleId: fakeDispatcher.id,
					exportName: "dispatcher",
				}),
			).toEqual({ ok: true, value: null });
			expect(await session.hasDispatcher()).toBe(true);
			expect(await session.callExport("src/main.tsx", "hook", [])).toEqual({
				ok: true,
				value: "value:7",
			});
			expect(await session.bindDispatcher(null)).toEqual({
				ok: true,
				value: null,
			});
			expect(await session.hasDispatcher()).toBe(false);
			expect(await session.callExport("src/main.tsx", "hook", [])).toEqual({
				ok: true,
				value: "threw:runtime_hook_outside_render",
			});
		} finally {
			await session.dispose();
		}
	});

	it("neither creator modules nor public builtins can become the dispatcher", async () => {
		const session = await createRuntimeVmSession({
			engine: testEngine(),
			artifact: app(),
			builtins: [fakeDispatcher],
		});
		try {
			expect(
				hostCode(
					await session.bindDispatcher({
						moduleId: "src/main.tsx",
						exportName: "hook",
					}),
				),
			).toBe(RUNTIME_HOST_ERROR_CODE.moduleUnknown);
			expect(
				hostCode(
					await session.bindDispatcher({
						moduleId: "rowcat:runtime",
						exportName: "useState",
					}),
				),
			).toBe(RUNTIME_HOST_ERROR_CODE.moduleUnknown);
			expect(
				hostCode(
					await session.bindDispatcher({
						moduleId: fakeDispatcher.id,
						exportName: "missing",
					}),
				),
			).toBe(RUNTIME_HOST_ERROR_CODE.exportMissing);
			expect(await session.hasDispatcher()).toBe(false);
		} finally {
			await session.dispose();
		}
	});
});
