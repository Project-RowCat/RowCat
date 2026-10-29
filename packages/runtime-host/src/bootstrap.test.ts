import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { describe, expect, it } from "vitest";
import {
	BOOTSTRAP_STAGES,
	CURRENT_RUNTIME_SANDBOX,
	checkSandboxCompatibility,
	planRuntimeBootstrap,
	RUNTIME_SANDBOX_EXPECTATION,
} from "./bootstrap.ts";
import {
	DISPATCHER_BUILTIN_ID,
	HOST_BRIDGE_BUILTIN_ID,
	HOST_PORT_BUILTIN_ID,
	HOST_PORT_INSTALLER_BUILTIN_ID,
	PUBLIC_BUILTIN_IDS,
	RUNTIME_ROOT_BUILTIN_ID,
	SYMBOLS_BUILTIN_ID,
} from "./builtins/modules.ts";

/**
 * Ordering and compatibility checks are pure, so they are tested as values without a VM. Booting in
 * a real VM is covered by `session.test.ts`.
 */
describe("boot plan", () => {
	const plan = planRuntimeBootstrap(CURRENT_RUNTIME_SANDBOX, [
		{
			id: "rowcat:internal/extra",
			source: "export const x = 1;",
			internal: true,
		},
	]);

	it("five phases in a fixed order", () => {
		expect(plan.stages.map((s) => s.stage)).toEqual([...BOOTSTRAP_STAGES]);
	});

	it("identity → bridge → runtime (internals first) → extras", () => {
		const ids = plan.builtins.map((m) => m.id);
		expect(ids[0]).toBe(SYMBOLS_BUILTIN_ID);
		expect(ids[1]).toBe(HOST_BRIDGE_BUILTIN_ID);
		const runtime = plan.stages[2]?.moduleIds ?? [];
		const firstPublic = runtime.findIndex((id) =>
			PUBLIC_BUILTIN_IDS.includes(id),
		);
		const lastInternal = runtime
			.map((id) => !PUBLIC_BUILTIN_IDS.includes(id))
			.lastIndexOf(true);
		expect(lastInternal).toBeLessThan(firstPublic);
		expect(ids[ids.length - 1]).toBe("rowcat:internal/extra");
	});

	/**
	 * The port installer runs after both the slot (generated runtime) and the bridge, but before the
	 * extra builtins. If it ran earlier, the import would fail because the slot module does not exist
	 * yet. If it ran after the extras, extra builtins such as the test dispatcher would be evaluated
	 * on a runtime without ports.
	 */
	it("port installation comes after the runtime and before extras", () => {
		const ids = plan.builtins.map((m) => m.id);
		const installer = ids.indexOf(HOST_PORT_INSTALLER_BUILTIN_ID);
		expect(installer).toBeGreaterThan(ids.indexOf(HOST_PORT_BUILTIN_ID));
		expect(installer).toBeGreaterThan(ids.indexOf(HOST_BRIDGE_BUILTIN_ID));
		expect(installer).toBeGreaterThan(ids.indexOf(RUNTIME_ROOT_BUILTIN_ID));
		expect(installer).toBeLessThan(ids.indexOf("rowcat:internal/extra"));
		expect(plan.stages[3]).toEqual({
			stage: "host-port",
			moduleIds: [HOST_PORT_INSTALLER_BUILTIN_ID],
		});
		expect(plan.importableIds.has(HOST_PORT_INSTALLER_BUILTIN_ID)).toBe(false);
		expect(plan.importableIds.has(RUNTIME_ROOT_BUILTIN_ID)).toBe(false);
	});

	it("artifacts can point only at the public three", () => {
		expect([...plan.importableIds].sort()).toEqual(
			[...PUBLIC_BUILTIN_IDS].sort(),
		);
		expect(plan.importableIds.has(SYMBOLS_BUILTIN_ID)).toBe(false);
		expect(plan.importableIds.has(DISPATCHER_BUILTIN_ID)).toBe(false);
		expect(plan.importableIds.has(HOST_BRIDGE_BUILTIN_ID)).toBe(false);
	});

	it("installing the same id twice is a host bug", () => {
		expect(() =>
			planRuntimeBootstrap(CURRENT_RUNTIME_SANDBOX, [
				{ id: SYMBOLS_BUILTIN_ID, source: "", internal: true },
			]),
		).toThrow(/installed twice/);
	});
});

describe("compatibility decision", () => {
	it("the current output matches the host", () => {
		expect(checkSandboxCompatibility(CURRENT_RUNTIME_SANDBOX)).toEqual({
			ok: true,
		});
		expect(RUNTIME_SANDBOX_EXPECTATION.apiVersion).toBe(RUNTIME_API_VERSION);
	});

	it.each([
		["api version", { apiVersion: 99 }, /api 99/],
		["build rules version", { builtWith: 99 }, /build rules 99/],
		["source digest", { sourceDigest: "deadbeef" }, /different sources/],
	])("refuses when the %s mismatches", (_label, patch, message) => {
		const result = checkSandboxCompatibility({
			...CURRENT_RUNTIME_SANDBOX,
			...patch,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(message);
	});

	it("refuses when required modules are missing", () => {
		const result = checkSandboxCompatibility({
			...CURRENT_RUNTIME_SANDBOX,
			modules: CURRENT_RUNTIME_SANDBOX.modules.filter(
				(m) => m.id !== "rowcat:runtime/jsx-runtime",
			),
		});
		expect(result).toEqual({
			ok: false,
			reason: "sandbox runtime is missing rowcat:runtime/jsx-runtime",
		});
	});

	it("refuses with unknown public modules too: the contract decides the creator's vocabulary, not the generator", () => {
		const result = checkSandboxCompatibility({
			...CURRENT_RUNTIME_SANDBOX,
			modules: [
				...CURRENT_RUNTIME_SANDBOX.modules,
				{ id: "rowcat:extra", source: "", internal: false },
			],
		});
		expect(result.ok).toBe(false);
	});
});
