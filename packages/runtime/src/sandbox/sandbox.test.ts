import { describe, expect, it } from "vitest";
import {
	collectRuntimeSources,
	digestRuntimeSources,
} from "../../scripts/lib/declaration-sources.ts";
import {
	RUNTIME_SANDBOX_BUILD_VERSION as BUILD_RULE_VERSION,
	buildSandboxModules,
	renderSandbox,
	sandboxModuleId,
} from "../../scripts/lib/sandbox-build.ts";
import {
	RUNTIME_API_VERSION,
	RUNTIME_BUILTIN_SPECIFIERS,
	RUNTIME_DECLARATIONS_SOURCE_DIGEST,
} from "../declarations/index.ts";
import * as runtime from "../index.ts";
import * as jsxDevRuntime from "../jsx-dev-runtime.ts";
import * as jsxRuntime from "../jsx-runtime.ts";
import {
	RUNTIME_SANDBOX_API_VERSION,
	RUNTIME_SANDBOX_BUILD_VERSION,
	RUNTIME_SANDBOX_BUILT_WITH,
	RUNTIME_SANDBOX_DISPATCHER_ID,
	RUNTIME_SANDBOX_MODULES,
	RUNTIME_SANDBOX_PUBLIC_IDS,
	RUNTIME_SANDBOX_SOURCE_DIGEST,
	RUNTIME_SANDBOX_SYMBOLS_ID,
} from "./index.ts";

/**
 * Sandbox generated output must match its source, be deterministic, and know nothing about the
 * host. Like the declared-output check, this regenerates the output in memory and compares, without
 * touching the working tree. Two more checks: the same input must produce the same bytes
 * (determinism), and the emitted modules must contain no DOM, Node, React, or host objects, since
 * they run in an isolated VM. Whether the modules load in a real VM is tested by
 * @rowcat/runtime-host. This package does not know the engine.
 */

const sources = collectRuntimeSources();

describe("the output derives from the source", () => {
	it("the output matches the current source", () => {
		const expected = renderSandbox(sources, RUNTIME_API_VERSION);
		const actual = renderSandbox(
			sources.map((file) => file),
			RUNTIME_API_VERSION,
		);
		expect(actual).toBe(expected);
		const digestFresh =
			RUNTIME_SANDBOX_SOURCE_DIGEST === digestRuntimeSources(sources) &&
			RUNTIME_SANDBOX_BUILT_WITH === BUILD_RULE_VERSION;
		expect(digestFresh, "run `pnpm runtime:sandbox` and commit along").toBe(
			true,
		);
		expect(
			RUNTIME_SANDBOX_MODULES.map((module) => [module.id, module.source]),
			"run `pnpm runtime:sandbox` and commit along",
		).toEqual(
			buildSandboxModules(sources).map((module) => [module.id, module.source]),
		);
	});

	it("the same input is the same bytes: no paths, times or machine names come in", () => {
		const once = renderSandbox(sources, RUNTIME_API_VERSION);
		const twice = renderSandbox(
			[...sources].reverse().sort((a, b) => (a.path < b.path ? -1 : 1)),
			RUNTIME_API_VERSION,
		);
		expect(twice).toBe(once);
		expect(once).not.toMatch(/\/Users\/|\/home\/|C:\\\\/);
		expect(once).not.toMatch(/\b20\d\d-\d\d-\d\dT/);
	});

	it("comes from the same source as the declaration output", () => {
		expect(RUNTIME_SANDBOX_SOURCE_DIGEST).toBe(
			RUNTIME_DECLARATIONS_SOURCE_DIGEST,
		);
		expect(RUNTIME_SANDBOX_API_VERSION).toBe(RUNTIME_API_VERSION);
		expect(RUNTIME_SANDBOX_BUILT_WITH).toBe(RUNTIME_SANDBOX_BUILD_VERSION);
	});

	it("the output itself and the tests are not carried over", () => {
		expect(
			sources.filter(
				(file) =>
					file.path.startsWith("sandbox/") ||
					file.path.startsWith("declarations/") ||
					file.path.includes(".test."),
			),
		).toEqual([]);
	});
});

describe("module ids", () => {
	it("the public three follow the same rule as the creator's bare names", () => {
		expect([...RUNTIME_SANDBOX_PUBLIC_IDS].sort()).toEqual(
			RUNTIME_BUILTIN_SPECIFIERS.map(
				(specifier) => `rowcat:${specifier.replace(/^@rowcat\//, "")}`,
			).sort(),
		);
	});

	it("everything else is internal", () => {
		for (const module of RUNTIME_SANDBOX_MODULES)
			expect(module.internal).toBe(
				!RUNTIME_SANDBOX_PUBLIC_IDS.includes(module.id),
			);
		expect(sandboxModuleId("internal/symbols.ts")).toBe(
			RUNTIME_SANDBOX_SYMBOLS_ID,
		);
		expect(sandboxModuleId("internal/dispatcher.ts")).toBe(
			RUNTIME_SANDBOX_DISPATCHER_ID,
		);
		expect(sandboxModuleId("asset.ts")).toBe("rowcat:internal/asset");
	});

	it("every import in a module is an id in this table: no relative paths or bare npm names", () => {
		const ids = new Set(RUNTIME_SANDBOX_MODULES.map((module) => module.id));
		for (const module of RUNTIME_SANDBOX_MODULES)
			for (const match of module.source.matchAll(
				/(?:from|import)\s+"([^"]+)"/g,
			))
				expect(ids.has(match[1] as string), `${module.id} → ${match[1]}`).toBe(
					true,
				);
	});
});

describe("code that runs in the VM", () => {
	it("there are no DOM, Node, React or host objects", () => {
		const forbidden = [
			/\bwindow\b/,
			/\bdocument\b/,
			/\bnavigator\b/,
			/\bprocess\b/,
			/\brequire\(/,
			/\bfetch\(/,
			/\bsetTimeout\b/,
			/__rowcat/,
			/\bReact\b/,
			/@rowcat\/runtime-host/,
			/quickjs/i,
		];
		for (const module of RUNTIME_SANDBOX_MODULES)
			for (const pattern of forbidden)
				expect(module.source, `${module.id} — ${pattern}`).not.toMatch(pattern);
	});

	it("types are erased and only values remain", () => {
		for (const module of RUNTIME_SANDBOX_MODULES) {
			expect(module.source).not.toMatch(
				/\binterface\b|\bimport type\b|: string\b/,
			);
		}
	});

	it("the public modules' export names match this package's real exports", () => {
		const exportsOf = (id: string): string[] => {
			const source =
				RUNTIME_SANDBOX_MODULES.find((m) => m.id === id)?.source ?? "";
			const names = new Set<string>();
			for (const match of source.matchAll(/export \{([^}]*)\}/g))
				for (const part of (match[1] as string).split(",")) {
					const name = part
						.trim()
						.split(/\s+as\s+/)
						.pop();
					if (name) names.add(name);
				}
			for (const match of source.matchAll(
				/export (?:const|function|class|let|var)\s+([A-Za-z_$][\w$]*)/g,
			))
				names.add(match[1] as string);
			return [...names].sort();
		};
		expect(exportsOf("rowcat:runtime")).toEqual(Object.keys(runtime).sort());
		expect(exportsOf("rowcat:runtime/jsx-runtime")).toEqual(
			Object.keys(jsxRuntime).sort(),
		);
		expect(exportsOf("rowcat:runtime/jsx-dev-runtime")).toEqual(
			Object.keys(jsxDevRuntime).sort(),
		);
	});
});
