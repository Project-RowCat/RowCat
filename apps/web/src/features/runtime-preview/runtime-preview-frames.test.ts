import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import {
	compileRuntimeProject,
	originalPositionFor,
} from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";
import { describe, expect, it } from "vitest";
import {
	PREVIEW_ERROR_FRAME_LIMIT,
	previewErrorFrames,
} from "./runtime-preview-frames.ts";

/**
 * Checks how the creator's stack is trimmed, mapped back to source positions, and dropped, using
 * real compiler output rather than hand-written fixtures.
 */

const environment = nodeRuntimeEnvironment();

const artifact = () => {
	const result = compileRuntimeProject(
		{
			apiVersion: RUNTIME_API_VERSION,
			entry: "src/main.tsx",
			files: [
				{
					path: "src/main.tsx",
					content: [
						'import { Screen } from "@rowcat/runtime";',
						"",
						"type Unused = { a: number };",
						"",
						"export function boom(): never {",
						'\tthrow new Error("kaboom");',
						"}",
						"export default function App() { return <Screen />; }",
					].join("\n"),
				},
			],
		},
		environment,
	);
	if (!result.ok) throw new Error("fixture does not compile");
	return result.artifact;
};

/**
 * Line and column of a token in the emitted code. Engine stacks report positions in emitted
 * coordinates, not source coordinates.
 */
const emittedPosition = (code: string, token: string) => {
	const index = code.indexOf(token);
	const before = code.slice(0, index);
	return {
		line: before.split("\n").length,
		column: index - before.lastIndexOf("\n"),
	};
};

describe("previewErrorFrames", () => {
	it("a creator module's frame becomes source coordinates", () => {
		const built = artifact();
		const main = built.modules.find((m) => m.id === "src/main.tsx");
		if (!main) throw new Error("no main");
		const at = emittedPosition(main.code, '"kaboom"');
		const frames = previewErrorFrames(
			[{ functionName: "boom", moduleId: "src/main.tsx", ...at }],
			built,
			originalPositionFor,
		);
		expect(frames).toEqual([
			{
				path: "src/main.tsx",
				functionName: "boom",
				line: 6,
				column: expect.any(Number),
			},
		]);
	});

	it("modules outside the artifact (host builtins, engine) are dropped", () => {
		const frames = previewErrorFrames(
			[
				{
					functionName: "render",
					moduleId: "rowcat:internal/root",
					line: 3,
					column: 1,
				},
				{ functionName: null, moduleId: "<eval>", line: 1, column: 1 },
				{ functionName: "boom", moduleId: null, line: 1, column: 1 },
			],
			artifact(),
			originalPositionFor,
		);
		expect(frames).toEqual([]);
	});

	it("an unmapped frame keeps no position; an emitted line is never written as a source line", () => {
		const frames = previewErrorFrames(
			[
				{
					functionName: "boom",
					moduleId: "src/main.tsx",
					line: 9_999,
					column: 1,
				},
				{
					functionName: null,
					moduleId: "src/main.tsx",
					line: null,
					column: null,
				},
			],
			artifact(),
			originalPositionFor,
		);
		expect(frames).toEqual([
			{ path: "src/main.tsx", functionName: "boom", line: null, column: null },
			{ path: "src/main.tsx", functionName: null, line: null, column: null },
		]);
	});

	it("frames are capped; one recursion makes dozens of lines", () => {
		const frames = previewErrorFrames(
			Array.from({ length: 40 }, () => ({
				functionName: "loop",
				moduleId: "src/main.tsx",
				line: 1,
				column: 1,
			})),
			artifact(),
			originalPositionFor,
		);
		expect(frames).toHaveLength(PREVIEW_ERROR_FRAME_LIMIT);
	});
});
