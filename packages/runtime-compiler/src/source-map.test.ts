import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { describe, expect, it } from "vitest";
import { compileRuntimeProject } from "./compile.ts";
import { nodeRuntimeEnvironment } from "./environment/node.ts";
import { originalPositionFor } from "./source-map.ts";

/**
 * Sourcemap tracing is checked against the real compiler's map. A hand-written mappings string is
 * not guaranteed to match the format this compiler emits.
 */

const environment = nodeRuntimeEnvironment();

const compile = (content: string) => {
	const result = compileRuntimeProject(
		{
			apiVersion: RUNTIME_API_VERSION,
			entry: "src/main.tsx",
			files: [{ path: "src/main.tsx", content }],
		},
		environment,
	);
	if (!result.ok)
		throw new Error(result.diagnostics.map((d) => d.message).join(" / "));
	const module = result.artifact.modules.find((m) => m.id === "src/main.tsx");
	if (!module?.map) throw new Error("no map");
	return module;
};

const locate = (code: string, token: string) => {
	const index = code.indexOf(token);
	if (index < 0) throw new Error(`token missing: ${token}`);
	const before = code.slice(0, index);
	const line = before.split("\n").length;
	const column = index - before.lastIndexOf("\n");
	return { line, column };
};

describe("originalPositionFor", () => {
	it("emitted positions trace back to source lines, even when earlier type annotations vanish", () => {
		const source = [
			'import { Screen, Text } from "@rowcat/runtime";',
			"",
			"type Props = { label: string };",
			"",
			"export function boom(): never {",
			'\tthrow new Error("kaboom");',
			"}",
			"",
			"export default function App() {",
			"\treturn <Screen><Text>hi</Text></Screen>;",
			"}",
		].join("\n");
		const module = compile(source);
		const at = locate(module.code, '"kaboom"');
		const original = originalPositionFor(module.map as string, at);
		expect(original?.line).toBe(6);
	});

	it("lines outside the map and broken maps are null: no invented positions", () => {
		const module = compile("export default function App() { return null; }\n");
		expect(
			originalPositionFor(module.map as string, { line: 999, column: 1 }),
		).toBeNull();
		expect(originalPositionFor("not json", { line: 1, column: 1 })).toBeNull();
		expect(
			originalPositionFor(JSON.stringify({ version: 2, mappings: "" }), {
				line: 1,
				column: 1,
			}),
		).toBeNull();
		expect(
			originalPositionFor(module.map as string, { line: 0, column: 1 }),
		).toBeNull();
	});
});
