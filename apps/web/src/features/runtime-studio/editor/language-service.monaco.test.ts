/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { createRuntimeTsWorker } from "#/test/monaco-ts-worker.ts";

/**
 * Checks that syntax highlighting does not touch the type service, using the real language service.
 * This slice changed only the lexical grammar (Monarch) and theme data, both outside the type
 * service. That was true only in words. Recoloring can easily disable diagnostics, strip `.tsx`
 * handling, or drop ambient declarations. The symptom of each is that the editor still opens
 * normally, while red underlines and autocomplete vanish. So three facts are recorded here as
 * values.
 */

/**
 * The root of the URI is a value. Ambient declarations sit under
 * `<root>/node_modules/@rowcat/runtime/…`, and module resolution walks up from the model's location
 * looking for `node_modules`. If the root differs, the declarations are never reached, and the
 * symptom is error 2307 on the creator's code. The address here matches the shape
 * `runtime-editor-models.ts` actually creates.
 */
const FILE = "file:///rowcat-project/__studio__/s1/src/main.tsx";

describe("`.tsx` enables JSX", () => {
	const JSX_SOURCE = [
		"declare const Screen: (props: { children?: unknown }) => unknown;",
		"declare const Text: (props: { children?: unknown }) => unknown;",
		"export const view = (",
		"\t<Screen>",
		"\t\t<Text>hi</Text>",
		"\t</Screen>",
		");",
	].join("\n");

	/**
	 * The extension decides the `ScriptKind` (`getScriptKind` in `tsWorker.js`). Folding to `.ts`
	 * makes `<Screen>` a syntax error, and that error is not about the creator's code.
	 */
	it("a `.tsx` model has no JSX syntax errors", async () => {
		expect(
			await createRuntimeTsWorker([
				{ uri: FILE, content: JSX_SOURCE },
			]).getSyntacticDiagnostics(FILE),
		).toEqual([]);
	});

	/**
	 * The same source is a syntax error at a `.ts` address, which shows the assertion above is not
	 * accidental.
	 */
	it("the same source is a syntax error in a `.ts` model", async () => {
		const ts = "file:///rowcat-project/__studio__/s1/src/main.ts";
		expect(
			(
				await createRuntimeTsWorker([
					{ uri: ts, content: JSX_SOURCE },
				]).getSyntacticDiagnostics(ts)
			).length,
		).toBeGreaterThan(0);
	});
});

describe("diagnostics are live", () => {
	it("catches a mistyped assignment", async () => {
		const source = 'export const count: number = "twelve";';
		const diagnostics = await createRuntimeTsWorker([
			{ uri: FILE, content: source },
		]).getSemanticDiagnostics(FILE);
		expect(diagnostics.map((one) => one.code)).toContain(2322);
	});

	/**
	 * Does not turn off 2307 (module not found). Keeping it on is the honest choice: importing a file
	 * that does not exist really is missing.
	 */
	it("catches a missing module", async () => {
		const source = 'import { x } from "./nowhere.ts";\nexport const y = x;';
		const diagnostics = await createRuntimeTsWorker([
			{ uri: FILE, content: source },
		]).getSemanticDiagnostics(FILE);
		expect(diagnostics.map((one) => one.code)).toContain(2307);
	});

	it("sound source has no diagnostics", async () => {
		const source = [
			"interface Character {",
			"\tname: string;",
			"}",
			"",
			"export function greet(who: Character): string {",
			"\treturn who.name;",
			"}",
		].join("\n");
		const worker = createRuntimeTsWorker([{ uri: FILE, content: source }]);
		expect(await worker.getSyntacticDiagnostics(FILE)).toEqual([]);
		expect(await worker.getSemanticDiagnostics(FILE)).toEqual([]);
	});
});

/**
 * Ambient declarations: the exact files the compiler places in its virtual file system. Phase 1 had
 * hand-written `.d.ts` strings whose `JSX.Element` was `unknown`, so nested children were not
 * assignable. The starter project opened with red underlines. The source below has that shape.
 */
describe("the `@rowcat/runtime` declarations reach it", () => {
	const SOURCE = [
		'import { Screen, Stack, Text, useState } from "@rowcat/runtime";',
		"",
		"export default function App() {",
		"\tconst [count, setCount] = useState(0);",
		"\treturn (",
		"\t\t<Screen>",
		"\t\t\t<Stack gap={12}>",
		"\t\t\t\t<Text>{count}</Text>",
		"\t\t\t</Stack>",
		"\t\t</Screen>",
		"\t);",
		"}",
	].join("\n");

	it("imports and nested children have no diagnostics", async () => {
		const worker = createRuntimeTsWorker([{ uri: FILE, content: SOURCE }], {
			declarations: true,
		});
		expect(await worker.getSyntacticDiagnostics(FILE)).toEqual([]);
		expect(
			(await worker.getSemanticDiagnostics(FILE)).map((one) => ({
				code: one.code,
				message: one.messageText,
			})),
		).toEqual([]);
	});

	/**
	 * Without the declarations, the same source yields 2307, which shows the assertion above is not
	 * accidental.
	 */
	it("without the declarations the import is not found", async () => {
		expect(
			(
				await createRuntimeTsWorker([
					{ uri: FILE, content: SOURCE },
				]).getSemanticDiagnostics(FILE)
			).map((one) => one.code),
		).toContain(2307);
	});

	/**
	 * Autocomplete knows the module's exported names, from the same service that supplies the
	 * coloring.
	 */
	it("autocomplete knows that module's names", async () => {
		const worker = createRuntimeTsWorker([{ uri: FILE, content: SOURCE }], {
			declarations: true,
		});
		const completions = await worker.getCompletionsAtPosition(
			FILE,
			SOURCE.indexOf("Screen,") + "Scree".length,
		);
		expect(
			(completions?.entries ?? []).map((entry: { name: string }) => entry.name),
		).toContain("Screen");
	});
});
