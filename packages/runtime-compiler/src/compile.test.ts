import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { describe, expect, it } from "vitest";
import { canonicalArtifactJson, canonicalSourceBytes } from "./canonical.ts";
import { analyzeRuntimeProject, compileRuntimeProject } from "./compile.ts";
import {
	RUNTIME_ARTIFACT_FORMAT_VERSION,
	RUNTIME_COMPILER_VERSION,
	RUNTIME_DIAGNOSTIC_CODE,
	type RuntimeCompileFile,
	type RuntimeCompileInput,
} from "./contracts.ts";
import { nodeRuntimeEnvironment } from "./environment/node.ts";

/**
 * What the compiler guarantees: environment isolation, language policy, and determinism.
 *
 * No author code runs in these tests. They check diagnostics and artifact values, which is enough
 * to observe all of this slice's promises.
 */

const environment = nodeRuntimeEnvironment();

const project = (
	files: readonly RuntimeCompileFile[],
	entry = "src/main.tsx",
): RuntimeCompileInput => ({ apiVersion: RUNTIME_API_VERSION, entry, files });

const main = (content: string): RuntimeCompileFile => ({
	path: "src/main.tsx",
	content,
});

const APP = `
import { Screen, Text } from "@rowcat/runtime";
export default function App() {
	return <Screen><Text>hello</Text></Screen>;
}
`;

const compile = (input: RuntimeCompileInput) =>
	compileRuntimeProject(input, environment);

const codes = (result: {
	diagnostics: readonly { code: string }[];
}): string[] => [
	...new Set(result.diagnostics.map((diagnostic) => diagnostic.code)),
];

describe("a valid project", () => {
	it("compiles and produces an artifact", () => {
		const result = compile(project([main(APP)]));
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.artifact.formatVersion).toBe(RUNTIME_ARTIFACT_FORMAT_VERSION);
		expect(result.artifact.compilerVersion).toBe(RUNTIME_COMPILER_VERSION);
		expect(result.artifact.entry).toBe("src/main.tsx");
		expect(result.artifact.modules.map((module) => module.id)).toEqual([
			"src/main.tsx",
		]);
	});

	/**
	 * The exact shape a starter project creates: nested children.
	 *
	 * The hand-written declaration in Phase 1 made `JSX.Element` resolve to `unknown`, which put a red
	 * underline on this code. Since it is the first screen a creator opens, that regression is
	 * especially costly.
	 */
	it("nested children pass", () => {
		const result = compile(
			project([
				main(`
import { Screen, Stack, Text } from "@rowcat/runtime";
export default function App() {
	return (
		<Screen>
			<Stack>
				<Text>Hello from RowCat Runtime</Text>
			</Stack>
		</Screen>
	);
}
`),
			]),
		);
		expect(codes(result)).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it("emits ES modules importing the RowCat JSX runtime", () => {
		const result = compile(project([main(APP)]));
		if (!result.ok) throw new Error("compile failed");
		const code = result.artifact.modules[0]?.code ?? "";
		expect(code).toContain('from "@rowcat/runtime/jsx-runtime"');
		expect(code).not.toContain("react/jsx-runtime");
		expect(code).toContain("export default");
		/** Emitted code must not point at a source map file that does not exist. */
		expect(code).not.toContain("sourceMappingURL");
	});

	it("each module gets a source map that holds no source text", () => {
		const result = compile(project([main(APP)]));
		if (!result.ok) throw new Error("compile failed");
		const map = JSON.parse(result.artifact.modules[0]?.map ?? "{}") as {
			sources: string[];
			sourcesContent?: unknown;
		};
		expect(map.sources).toEqual(["src/main.tsx"]);
		expect(map.sourcesContent).toBeUndefined();
	});

	it("custom hooks pass type checking naturally", () => {
		const result = compile(
			project([
				main(`
import { Stack, Text, Button, useState } from "@rowcat/runtime";
function useCounter() {
	const [count, setCount] = useState(0);
	return { count, increment: () => setCount(value => value + 1) };
}
export default function App() {
	const counter = useCounter();
	return (
		<Stack gap={12}>
			<Text>{counter.count}</Text>
			<Button onPress={counter.increment}>Increment</Button>
		</Stack>
	);
}
`),
			]),
		);
		expect(codes(result)).toEqual([]);
	});

	it("defineStoryState passes with an interface too", () => {
		const result = compile(
			project([
				{
					path: "src/state.ts",
					content: `
import { defineStoryState } from "@rowcat/runtime";
interface GameState { count: number }
export const gameState = defineStoryState<GameState>({
	key: "game",
	version: 1,
	initial: { count: 0 },
});
`,
				},
				main(`
import { Screen } from "@rowcat/runtime";
import { gameState } from "./state";
export default function App() { void gameState; return <Screen />; }
`),
			]),
		);
		expect(codes(result)).toEqual([]);
	});

	it("non-serializable state is blocked by the type", () => {
		const result = compile(
			project([
				main(`
import { Screen, defineStoryState } from "@rowcat/runtime";
export const bad = defineStoryState({
	key: "game",
	version: 1,
	initial: { run: () => {} },
});
export default function App() { return <Screen />; }
`),
			]),
		);
		expect(result.ok).toBe(false);
	});
});

describe("several files", () => {
	const multi = project([
		{
			path: "src/state.ts",
			content: "export const bump = (n: number) => n + 1;",
		},
		{
			path: "src/components/counter.tsx",
			content: `
import { Text, useState } from "@rowcat/runtime";
import { bump } from "../state";
export function Counter() {
	const [n, setN] = useState(0);
	void setN(bump);
	return <Text>{n}</Text>;
}
`,
		},
		main(`
import { Screen } from "@rowcat/runtime";
import { Counter } from "./components/counter";
export default function App() { return <Screen><Counter /></Screen>; }
`),
	]);

	it("relative paths resolve and the graph rides in the artifact", () => {
		const result = compile(multi);
		if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
		expect(result.artifact.modules.map((module) => module.id)).toEqual([
			"src/components/counter.tsx",
			"src/main.tsx",
			"src/state.ts",
		]);
		const entry = result.artifact.modules.find(
			(module) => module.id === "src/main.tsx",
		);
		expect(entry?.dependencies).toEqual([
			{
				specifier: "@rowcat/runtime",
				kind: "builtin",
				resolved: "rowcat:runtime",
			},
			{
				specifier: "./components/counter",
				kind: "local",
				resolved: "src/components/counter.tsx",
			},
		]);
	});

	/**
	 * A module that is in the project but not reachable from the entry is absent from the artifact.
	 */
	it("modules unreachable from the entry are not included", () => {
		const result = compile(
			project([
				main(APP),
				{ path: "src/orphan.ts", content: "export const x = 1;" },
			]),
		);
		if (!result.ok) throw new Error("compile failed");
		expect(result.artifact.modules.map((module) => module.id)).toEqual([
			"src/main.tsx",
		]);
	});
});

describe("extension resolution order", () => {
	const order = ["foo.ts", "foo.tsx", "foo/index.ts", "foo/index.tsx"];

	it.each(order)("./foo finds %s", (target) => {
		const result = compile(
			project([
				main(`
import { Screen } from "@rowcat/runtime";
import { value } from "./foo";
export default function App() { void value; return <Screen />; }
`),
				{ path: `src/${target}`, content: "export const value = 1;" },
			]),
		);
		expect(codes(result)).toEqual([]);
	});

	/**
	 * When several candidates exist, the EARLIER one wins. That order must not shift between
	 * deployments.
	 */
	it("when several exist, list order wins", () => {
		const result = compile(
			project([
				main(`
import { Screen } from "@rowcat/runtime";
import { value } from "./foo";
const check: "ts" = value;
export default function App() { void check; return <Screen />; }
`),
				{ path: "src/foo.ts", content: 'export const value = "ts" as const;' },
				{
					path: "src/foo.tsx",
					content: 'export const value = "tsx" as const;',
				},
				{
					path: "src/foo/index.ts",
					content: 'export const value = "dir" as const;',
				},
			]),
		);
		expect(codes(result)).toEqual([]);
	});
});

describe("forbidden things", () => {
	const cases: [string, string, string][] = [
		[
			"npm package",
			'import React from "react";',
			RUNTIME_DIAGNOSTIC_CODE.importForbidden,
		],
		[
			"node builtin",
			'import fs from "node:fs";',
			RUNTIME_DIAGNOSTIC_CODE.importForbidden,
		],
		[
			"runtime internal module",
			'import { dispatcher } from "@rowcat/runtime/internal/dispatcher";',
			RUNTIME_DIAGNOSTIC_CODE.importForbidden,
		],
		[
			"escaping the project",
			'import x from "../../secret";',
			RUNTIME_DIAGNOSTIC_CODE.moduleEscape,
		],
		[
			"missing module",
			'import x from "./missing";',
			RUNTIME_DIAGNOSTIC_CODE.moduleNotFound,
		],
	];

	it.each(cases)("refuses %s", (_name, statement, code) => {
		const result = compile(
			project([
				main(`${statement}\nexport default function App() { return null; }`),
			]),
		);
		expect(result.ok).toBe(false);
		expect(codes(result)).toContain(code);
	});

	const syntax: [string, string, string][] = [
		[
			"dynamic import",
			'void import("./x");',
			RUNTIME_DIAGNOSTIC_CODE.dynamicImportForbidden,
		],
		["require", 'require("./x");', RUNTIME_DIAGNOSTIC_CODE.requireForbidden],
		["eval", 'eval("1");', RUNTIME_DIAGNOSTIC_CODE.evalForbidden],
		[
			"Function constructor",
			'const f = Function("return 1");',
			RUNTIME_DIAGNOSTIC_CODE.functionConstructorForbidden,
		],
		[
			"WebAssembly",
			"void WebAssembly;",
			RUNTIME_DIAGNOSTIC_CODE.webAssemblyForbidden,
		],
	];

	it.each(syntax)("refuses %s", (_name, statement, code) => {
		const result = compile(
			project([
				main(`export default function App() { ${statement} return null; }`),
			]),
		);
		expect(result.ok).toBe(false);
		expect(codes(result)).toContain(code);
	});

	/**
	 * The policy pass must not touch property names or declarations; otherwise ordinary code gets
	 * blocked.
	 */
	it("property names are not caught by the policy", () => {
		const result = compile(
			project([
				main(`
import { Screen } from "@rowcat/runtime";
const config = { eval: 1, Function: 2 };
export default function App() { void config.eval; return <Screen />; }
`),
			]),
		);
		expect(codes(result)).toEqual([]);
	});
});

describe("the app's environment does not leak", () => {
	const globals: [string, string][] = [
		["document", 'document.title = "x";'],
		["window", "void window;"],
		["process", "void process.env;"],
		["localStorage", "void localStorage;"],
		["fetch", "void fetch;"],
		["Worker", "void Worker;"],
		["require global", "void __dirname;"],
	];

	it.each(globals)("%s does not exist", (_name, statement) => {
		const result = compile(
			project([
				main(`export default function App() { ${statement} return null; }`),
			]),
		);
		expect(result.ok).toBe(false);
	});

	it("DOM JSX is invalid", () => {
		const result = compile(
			project([main("export default function App() { return <div>x</div>; }")]),
		);
		expect(result.ok).toBe(false);
	});

	it("type errors block the artifact", () => {
		const result = compile(
			project([
				main(
					"const x: string = 1;\nexport default function App() { void x; return null; }",
				),
			]),
		);
		expect(result.ok).toBe(false);
		expect(result.artifact).toBeNull();
	});

	/**
	 * One comment line used to bring the DOM back on the server: `lib: [es2022]` only picks the
	 * default, and a reference directive was resolved against every lib file on disk.
	 */
	const directives: [string, string][] = [
		["lib dom", '/// <reference lib="dom" />'],
		["lib webworker", '/// <reference lib="webworker" />'],
		["lib esnext", '/// <reference lib="esnext" />'],
		["types", '/// <reference types="node" />'],
		["path", '/// <reference path="./other.ts" />'],
		["no-default-lib", '/// <reference no-default-lib="true" />'],
	];

	it.each(directives)("a %s reference directive is refused", (_name, line) => {
		const files = [
			main(
				`${line}\nexport default function App() { void fetch; return null; }`,
			),
			{ path: "src/other.ts", content: "export const other = 1;\n" },
		];
		const compiled = compile(project(files));
		expect(compiled.ok).toBe(false);
		expect(codes(compiled)).toContain(
			RUNTIME_DIAGNOSTIC_CODE.referenceDirectiveForbidden,
		);
		const directive = compiled.diagnostics.find(
			(diagnostic) =>
				diagnostic.code === RUNTIME_DIAGNOSTIC_CODE.referenceDirectiveForbidden,
		);
		expect(directive).toMatchObject({ path: "src/main.tsx", line: 1 });
		/** The studio's analysis answers the same, so the two environments do not disagree. */
		expect(codes(analyzeRuntimeProject(project(files)))).toContain(
			RUNTIME_DIAGNOSTIC_CODE.referenceDirectiveForbidden,
		);
	});

	it("an ordinary comment that mentions a directive is not refused", () => {
		const result = compile(
			project([main(`// see /// <reference lib="dom" /> in the docs\n${APP}`)]),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});

	/**
	 * Behind the policy pass, the library set itself is the one the studio preview worker ships
	 * (apps/web runtime-preview-libs.ts): the es5..es2022 chain and the decorators libs. If the policy
	 * line were ever lost, lib.dom.d.ts would still not be there to load.
	 */
	it("the server's library set is the ES chain only", () => {
		const names = environment.defaultLibs.map((lib) => lib.path);
		expect(names).toContain("lib.es2022.d.ts");
		expect(names).toContain("lib.es5.d.ts");
		expect(names).toContain("lib.decorators.d.ts");
		for (const name of names)
			expect(name).toMatch(
				/^lib\.(es5|es20(15|16|17|18|19|20|21|22)(\.[a-z0-9]+)*|decorators(\.[a-z0-9]+)*)\.d\.ts$/,
			);
		expect(names).not.toContain("lib.dom.d.ts");
		expect(names).not.toContain("lib.webworker.d.ts");
		expect(names).not.toContain("lib.esnext.d.ts");
	});
});

describe("reserved project paths", () => {
	/**
	 * The virtual file system keeps the runtime package and the TypeScript libs under node_modules/
	 * and the entry check under .rowcat/. A creator file there used to be read as the compiler's own:
	 * its type errors became 'the compiler environment is invalid', and a creator
	 * .rowcat/entry-check.ts was silently replaced by ours in emit.
	 */
	const reserved = ["node_modules/x.ts", ".rowcat/entry-check.ts"];

	it.each(reserved)("%s is refused as reserved", (path) => {
		const withoutExtension = path.replace(/\.ts$/, "");
		const files = [
			main(`import "../${withoutExtension}";\n${APP}`),
			{ path, content: "const x: string = 1;\nexport default x;\n" },
		];
		const result = compile(project(files));
		expect(result.ok).toBe(false);
		expect(codes(result)).toContain(RUNTIME_DIAGNOSTIC_CODE.moduleReservedPath);
		expect(codes(result)).not.toContain(
			RUNTIME_DIAGNOSTIC_CODE.apiVersionUnsupported,
		);
		expect(
			result.diagnostics.find(
				(diagnostic) =>
					diagnostic.code === RUNTIME_DIAGNOSTIC_CODE.moduleReservedPath,
			)?.path,
		).toBe(path);
		expect(codes(analyzeRuntimeProject(project(files)))).toContain(
			RUNTIME_DIAGNOSTIC_CODE.moduleReservedPath,
		);
	});

	it("an entry point under a reserved folder is refused", () => {
		const result = compile(
			project([{ path: ".rowcat/main.tsx", content: APP }], ".rowcat/main.tsx"),
		);
		expect(result.ok).toBe(false);
		expect(codes(result)).toEqual([RUNTIME_DIAGNOSTIC_CODE.moduleReservedPath]);
	});

	/**
	 * Only the first segment is reserved: that is where the creator's tree and the compiler's overlap.
	 * A nested node_modules folder is an ordinary folder and emits like one.
	 */
	it("names that only resemble a reserved folder still compile", () => {
		const files = [
			main(
				`import { n } from "./rowcat/node_modules_list";\nimport { m } from "./node_modules/m";\nvoid n; void m;\n${APP}`,
			),
			{
				path: "src/rowcat/node_modules_list.ts",
				content: "export const n = 1;\n",
			},
			{ path: "src/node_modules/m.ts", content: "export const m = 2;\n" },
			{ path: "Node_Modules/unused.ts", content: "export {};\n" },
		];
		const result = compile(project(files));
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});
});

describe("entry point", () => {
	it("says so first when missing", () => {
		const result = compile(project([main(APP)], "src/nope.tsx"));
		expect(codes(result)).toEqual([RUNTIME_DIAGNOSTIC_CODE.entryMissing]);
	});

	it("refuses without a default export", () => {
		const result = compile(project([main("export const foo = 1;")]));
		expect(codes(result)).toContain(
			RUNTIME_DIAGNOSTIC_CODE.defaultExportMissing,
		);
	});

	it("refuses when the default export is not a component", () => {
		const result = compile(project([main("export default 123;")]));
		expect(codes(result)).toContain(RUNTIME_DIAGNOSTIC_CODE.entryExportInvalid);
	});

	it("a component that requires props cannot be the root", () => {
		const result = compile(
			project([
				main(`
import { Screen } from "@rowcat/runtime";
export default function App({ title }: { title: string }) { void title; return <Screen />; }
`),
			]),
		);
		expect(codes(result)).toContain(RUNTIME_DIAGNOSTIC_CODE.entryExportInvalid);
	});

	it("refuses an entry point that is not runtime source", () => {
		const result = compile(project([main(APP)], "src/main.js"));
		expect(codes(result)).toContain(RUNTIME_DIAGNOSTIC_CODE.entryInvalidPath);
	});
});

describe("version", () => {
	it("refuses an unknown API version", () => {
		const result = compile({
			apiVersion: 99,
			entry: "src/main.tsx",
			files: [main(APP)],
		});
		expect(codes(result)).toContain(
			RUNTIME_DIAGNOSTIC_CODE.apiVersionUnsupported,
		);
	});
});

describe("determinism", () => {
	const files = [
		{ path: "src/a.ts", content: "export const a = 1;" },
		{ path: "src/b.ts", content: "export const b = 2;" },
		main(`
import { Screen } from "@rowcat/runtime";
import { a } from "./a";
import { b } from "./b";
export default function App() { void a; void b; return <Screen />; }
`),
	];

	it("input order does not change the artifact", () => {
		const forward = compile(project(files));
		const backward = compile(project([...files].reverse()));
		if (!forward.ok || !backward.ok) throw new Error("compile failed");
		expect(canonicalArtifactJson(backward.artifact)).toBe(
			canonicalArtifactJson(forward.artifact),
		);
	});

	it("line endings do not change the hash", () => {
		const lf = project([{ path: "src/main.tsx", content: APP }]);
		const crlf = project([
			{ path: "src/main.tsx", content: APP.replace(/\n/g, "\r\n") },
		]);
		expect(canonicalSourceBytes(crlf)).toBe(canonicalSourceBytes(lf));
	});

	/**
	 * Not just the hash: the artifact bytes must match too. Template literals emit newlines as-is, so
	 * while TypeScript read unfolded source, both had the same hash but different bytes.
	 */
	it("line endings do not change the artifact, even inside template literals", () => {
		const source = `${APP}\nexport const banner = \`first line\nsecond line\`;\n`;
		const lf = compile(project([{ path: "src/main.tsx", content: source }]));
		const crlf = compile(
			project([
				{ path: "src/main.tsx", content: source.replace(/\n/g, "\r\n") },
			]),
		);
		if (!lf.ok || !crlf.ok) throw new Error("compile failed");
		expect(canonicalArtifactJson(crlf.artifact)).toBe(
			canonicalArtifactJson(lf.artifact),
		);
	});

	it("path separators and a leading ./ fold", () => {
		expect(
			canonicalSourceBytes(
				project([{ path: "./src\\main.tsx", content: APP }]),
			),
		).toBe(
			canonicalSourceBytes(project([{ path: "src/main.tsx", content: APP }])),
		);
	});

	/**
	 * Shows that repository metadata has no place in the hash.
	 *
	 * The input type has no such field, so it cannot be included by mistake. Extra keys added to the
	 * object do not change the canonical bytes, so the same source arriving through sync on another
	 * device still hashes the same.
	 */
	it("extra values on the input do not change the hash", () => {
		const base = project([main(APP)]);
		const tainted = {
			...base,
			files: base.files.map((file) => ({
				...file,
				id: "local-record-id",
				rev: 41,
				dirty: true,
				updatedAt: "2026-09-02T00:00:00.000Z",
			})),
		} as RuntimeCompileInput;
		expect(canonicalSourceBytes(tainted)).toBe(canonicalSourceBytes(base));
	});

	it("the same project gives the same hash", () => {
		const first = compile(project(files));
		const second = compile(project(files));
		if (!first.ok || !second.ok) throw new Error("compile failed");
		expect(second.artifact.sourceHash).toBe(first.artifact.sourceHash);
	});

	it("one changed character changes the hash", () => {
		const first = compile(project(files));
		const second = compile(
			project([
				{ path: "src/a.ts", content: "export const a = 2;" },
				...files.slice(1),
			]),
		);
		if (!first.ok || !second.ok) throw new Error("compile failed");
		expect(second.artifact.sourceHash).not.toBe(first.artifact.sourceHash);
	});
});

describe("program reuse", () => {
	it("passing a handle gives the same result", () => {
		const input = project([main(APP)]);
		const first = compileRuntimeProject(input, environment);
		const second = compileRuntimeProject(input, environment, {
			previous: first.handle,
		});
		if (!first.ok || !second.ok) throw new Error("compile failed");
		expect(canonicalArtifactJson(second.artifact)).toBe(
			canonicalArtifactJson(first.artifact),
		);
	});
});

describe("analysis pass", () => {
	it("answers policy and resolution without the library", () => {
		const result = analyzeRuntimeProject(
			project([
				main(
					'import x from "react";\nexport default function App(){return null;}',
				),
			]),
		);
		expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
			RUNTIME_DIAGNOSTIC_CODE.importForbidden,
		);
	});

	/** Type errors are not this pass's question, so they pass through silently. */
	it("does not report type errors", () => {
		const result = analyzeRuntimeProject(
			project([
				main(
					"const x: string = 1;\nexport default function App(){ void x; return null; }",
				),
			]),
		);
		expect(result.diagnostics).toEqual([]);
	});

	it("answers reachable modules in path order", () => {
		const result = analyzeRuntimeProject(
			project([
				{ path: "src/z.ts", content: "export const z = 1;" },
				main(`
import { z } from "./z";
export default function App() { void z; return null; }
`),
			]),
		);
		expect(result.modules).toEqual(["src/main.tsx", "src/z.ts"]);
	});
});

/**
 * Whether the runtime language contract holds as types.
 *
 * This block needs a real program. The unit tests of @rowcat/runtime see only values, so they
 * cannot answer whether `<Image>` with a plain URL string source is blocked, and that is the
 * question this slice fixed. The answer here matches what Monaco gives the author: same options,
 * same virtual layout, same TypeScript version.
 */
/**
 * What the controller guarantees in types: a pairing, and opacity.
 *
 * That types are not the boundary (the runtime checks again) is a different claim from types being
 * the first line of defense. What is pinned here is when the creator sees a red line in the studio.
 * Without that line, a wrong pairing only shows up when the code runs.
 */
describe("controllers", () => {
	const typeErrors = (source: string): string[] =>
		compile(project([main(source)]))
			.diagnostics.filter((diagnostic) => diagnostic.source === "typescript")
			.map((diagnostic) => diagnostic.message);

	const app = (imports: string, body: string, extra = ""): string => `
import { ${imports} } from "@rowcat/runtime";
export default function App() {
	${extra}
	return ${body};
}
`;

	it("scroll controllers attach to ScrollView", () => {
		expect(
			typeErrors(
				app(
					"ScrollView, Text, useScrollController",
					"<ScrollView controller={scroll}><Text>a</Text></ScrollView>",
					"const scroll = useScrollController();",
				),
			),
		).toEqual([]);
	});

	it.each([
		"TextInput",
		"TextArea",
	])("text input controllers attach to %s", (component) => {
		expect(
			typeErrors(
				app(
					`${component}, useTextEntryController`,
					`<${component} controller={entry} value="" />`,
					"const entry = useTextEntryController();",
				),
			),
		).toEqual([]);
	});

	/**
	 * Four mismatched pairings. If these four passed, `controller` would just be a slot that accepts
	 * any object.
	 */
	it.each([
		[
			"a scroll controller on TextInput",
			"TextInput, useScrollController",
			'<TextInput controller={scroll} value="" />',
			"const scroll = useScrollController();",
		],
		[
			"a text input controller on ScrollView",
			"ScrollView, useTextEntryController",
			"<ScrollView controller={entry} />",
			"const entry = useTextEntryController();",
		],
		[
			"a controller on View",
			"View, useScrollController",
			"<View controller={scroll} />",
			"const scroll = useScrollController();",
		],
		[
			"any object instead of a controller",
			"ScrollView",
			"<ScrollView controller={{ scrollToEnd() {} }} />",
			"",
		],
	])("%s is blocked by the type", (_label, imports, body, extra) => {
		expect(typeErrors(app(imports, body, extra))).not.toEqual([]);
	});

	/**
	 * The claim that the controller is NOT a ref must also hold in types. If any of these four fields
	 * could be read, it would be public API, and the creator would start working out what they can do
	 * with that value.
	 */
	it.each([
		"current",
		"nodeId",
		"node",
		"element",
		"id",
	])("cannot read the controller's %s", (field) => {
		for (const hook of ["useScrollController", "useTextEntryController"])
			expect(
				typeErrors(`
import { ${hook} } from "@rowcat/runtime";
export default function App() {
	const control = ${hook}();
	void control.${field};
	return null;
}
`),
				hook,
			).not.toEqual([]);
	});

	it("there is no ref prop", () => {
		expect(
			typeErrors(
				app(
					"ScrollView, useRef",
					"<ScrollView ref={box} />",
					"const box = useRef(null);",
				),
			),
		).not.toEqual([]);
	});
});

describe("asset references", () => {
	const app = (body: string): string => `
import { Image, asset } from "@rowcat/runtime";
export default function App() {
	return ${body};
}
`;

	/** Counts only TypeScript diagnostics: this block asks about types, not policy. */
	const typeErrors = (source: string): string[] =>
		compile(project([main(source)]))
			.diagnostics.filter((diagnostic) => diagnostic.source === "typescript")
			.map((diagnostic) => diagnostic.message);

	it("references made with asset() pass", () => {
		const result = compile(
			project([
				main(
					app('<Image source={asset("characters/sena/smile")} alt="Sena" />'),
				),
			]),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});

	/**
	 * A remote address also counts as a reference once it passes through `asset()`. What is widened is
	 * the value that function accepts, not the type of `source`. This line and the two below must hold
	 * together for that to be true in types.
	 */
	it("remote references made with asset() pass", () => {
		const result = compile(
			project([
				main(
					app(
						'<Image source={asset("https://cdn.example.com/sena.webp?v=2")} alt="Sena" fit="cover" />',
					),
				),
			]),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});

	/**
	 * These two lines are the whole point of this slice. While `source` was typed as string, both
	 * passed, so any remote URL could become part of runtime API v1. Even now that `asset()` accepts
	 * remote addresses, a plain string is still blocked: the same string must be sealed as a
	 * reference.
	 */
	it("remote address strings are blocked", () => {
		expect(
			typeErrors(app('<Image source="https://example.com/a.png" />')),
		).not.toEqual([]);
	});

	it("bare string paths are blocked too: references must be made", () => {
		expect(
			typeErrors(app('<Image source="characters/sena/smile" />')),
		).not.toEqual([]);
	});

	/**
	 * The claim that a reference is opaque must hold in types too. If any field can be read, that
	 * field is public API, and removing it later is a narrowing change.
	 */
	it.each([
		"url",
		"id",
		"path",
		"source",
		"kind",
	])("cannot read the reference's %s", (field) => {
		for (const value of ["cover", "https://cdn.example.com/a.png"])
			expect(
				typeErrors(`
import { asset } from "@rowcat/runtime";
const ref = asset(${JSON.stringify(value)});
export default function App() { void ref.${field}; return null; }
`),
				value,
			).not.toEqual([]);
	});

	/**
	 * Code that treats a reference like a string is also blocked. The reference is not a wrapped
	 * string.
	 */
	it("cannot be used as a string", () => {
		expect(
			typeErrors(`
import { asset } from "@rowcat/runtime";
const ref: string = asset("cover");
export default function App() { void ref; return null; }
`),
		).not.toEqual([]);
	});

	/**
	 * Functions that open a reference are not the creator's vocabulary; the root does not export those
	 * names.
	 */
	it.each([
		"runtimeAssetPath",
		"classifyRuntimeAssetValue",
		"isAssetRef",
	])("%s does not exist for creators", (name) => {
		expect(
			typeErrors(`
import { ${name} } from "@rowcat/runtime";
export default function App() { void ${name}; return null; }
`),
		).not.toEqual([]);
	});
});

/**
 * Whether the color format is enforced by types.
 *
 * While the type was a template literal of `#` followed by any string, every INVALID case below
 * passed. Counting digits in types would explode the union and cannot be represented, so the check
 * is done by the generic at the call site. Whether that judgment holds is observable only in a real
 * program.
 */
describe("story state", () => {
	const typeErrors = (source: string): string[] =>
		compile(project([main(source)]))
			.diagnostics.filter((diagnostic) => diagnostic.source === "typescript")
			.map((diagnostic) => diagnostic.message);

	const app = (head: string, body: string): string => `
import { Text, defineStoryState, useStoryState } from "@rowcat/runtime";
${head}
export default function App() {
	${body}
}
`;

	/**
	 * `useStoryState` is an ordinary runtime import. The compiler has no special transform or pass for
	 * persistent state. This block checks only that the generated declaration resolves the name in the
	 * creator's program, and what type it imposes.
	 */
	it("the declaration provides useStoryState", () => {
		const result = compile(
			project([
				main(
					app(
						'const game = defineStoryState({ key: "game", version: 1, initial: { trust: 40 } });',
						"const [story] = useStoryState(game);\n\treturn <Text>{story.trust}</Text>;",
					),
				),
			]),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});

	/**
	 * The initial value does not narrow the state's type.
	 *
	 * If `initial: { trust: 40 }` were inferred as the literal `{ trust: 40 }`, `setStory` could not
	 * change the value, the opposite of this API's meaning. That narrowing comes from one
	 * natural-looking declaration, `initial: T & SerializableShape<T>` (Phase 1 really did this), so
	 * this is checked by code that changes the value.
	 */
	it("literals in the initial value do not narrow the state type", () => {
		expect(
			typeErrors(
				app(
					'const game = defineStoryState({ key: "game", version: 1, initial: { trust: 40 } });',
					"const [story, setStory] = useStoryState(game);\n\tsetStory((current) => ({ ...current, trust: current.trust + 10 }));\n\treturn <Text>{story.trust}</Text>;",
				),
			),
		).toEqual([]);
	});

	/** A state written as an interface also passes; no index signature is required. */
	it("state written as an interface is not blocked", () => {
		expect(
			typeErrors(
				app(
					'interface GameState { trust: number }\nconst game = defineStoryState<GameState>({ key: "game", version: 1, initial: { trust: 40 } });',
					"const [story] = useStoryState(game);\n\treturn <Text>{story.trust}</Text>;",
				),
			),
		).toEqual([]);
	});

	/**
	 * A value that cannot be stored is blocked at definition time. Blocking it once the storage layer
	 * exists is too late, because projects already written by then would contain it.
	 */
	it("non-serializable initial values are blocked", () => {
		expect(
			typeErrors(
				app(
					'const game = defineStoryState({ key: "game", version: 1, initial: { at: new Date() } });',
					"const [story] = useStoryState(game);\n\treturn <Text>{String(story.at)}</Text>;",
				),
			),
		).not.toEqual([]);
		expect(
			typeErrors(
				app(
					'const game = defineStoryState({ key: "game", version: 1, initial: { fn: () => 1 } });',
					"const [story] = useStoryState(game);\n\treturn <Text>{String(story.fn)}</Text>;",
				),
			),
		).not.toEqual([]);
	});

	/** Migration returns the shape of the current definition; any other shape is blocked by types. */
	it("the migration result type is the current definition's shape", () => {
		expect(
			typeErrors(
				app(
					'const game = defineStoryState<{ trust: number }>({\n\tkey: "game",\n\tversion: 2,\n\tinitial: { trust: 0 },\n\tmigrate: (stored) => ({ wrong: (stored as { trust: number }).trust }),\n});',
					"const [story] = useStoryState(game);\n\treturn <Text>{story.trust}</Text>;",
				),
			),
		).not.toEqual([]);
	});

	/**
	 * The persistent-state engine's internals are not the creator's vocabulary. No name at the root
	 * opens the registry, hydration, or snapshot, and imports of those modules do not resolve.
	 */
	it("cannot point at the engine's internal modules", () => {
		const result = compile(
			project([
				main(
					'import { hydrateStoryState } from "@rowcat/runtime/internal/story-state";\nexport default function App() { return null; }',
				),
			]),
		);
		expect(result.ok).toBe(false);
	});
});

describe("the two lifetimes of saved state", () => {
	const typeErrors = (source: string): string[] =>
		compile(project([main(source)]))
			.diagnostics.filter((diagnostic) => diagnostic.source === "typescript")
			.map((diagnostic) => diagnostic.message);

	const both = (body: string): string => `
import { Text, defineStoryState, definePersistentState, useStoryState, usePersistentState } from "@rowcat/runtime";
const run = defineStoryState({ key: "run", version: 1, initial: { chapter: 1 } });
const meta = definePersistentState({ key: "meta", version: 1, initial: { endings: [] as string[] } });
export default function App() {
	${body}
	return <Text>ok</Text>;
}
`;

	it("passes when given to its own hook", () => {
		const result = compile(
			project([
				main(
					both(
						'const [a, setA] = useStoryState(run);\n\tconst [b, setB] = usePersistentState(meta);\n\tsetA((c) => ({ chapter: c.chapter + 1 }));\n\tsetB((c) => ({ endings: [...c.endings, "x"] }));',
					),
				),
			]),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});

	/**
	 * This pair of lines is the type-side half of lifetime separation. If both had the same brand,
	 * both would pass, and the screen would silently read a value with a different lifetime. The
	 * symptom would surface only on the day a play reset wipes months of progress.
	 */
	it("passing a persistent definition to useStoryState is blocked", () => {
		expect(typeErrors(both("useStoryState(meta);"))).not.toEqual([]);
	});

	it("passing a playthrough definition to usePersistentState is blocked", () => {
		expect(typeErrors(both("usePersistentState(run);"))).not.toEqual([]);
	});

	/**
	 * The fact that the initial value's type is not narrowed must hold for both lifetimes. If the
	 * signature were `initial: T & SerializableShape<T>`, the literal would freeze and the value could
	 * not change.
	 */
	it("persistent state initial values do not harden into literals either", () => {
		const result = compile(
			project([
				main(`
import { Text, definePersistentState, usePersistentState } from "@rowcat/runtime";
const meta = definePersistentState({ key: "meta", version: 1, initial: { runs: 0 } });
export default function App() {
	const [value, set] = usePersistentState(meta);
	set((current) => ({ runs: current.runs + 1 }));
	return <Text>{value.runs}</Text>;
}
`),
			]),
		);
		expect(result.diagnostics).toEqual([]);
	});

	/** A non-serializable initial value is blocked for both lifetimes. */
	it("a function in a persistent state initial value is blocked", () => {
		expect(
			typeErrors(`
import { Text, definePersistentState } from "@rowcat/runtime";
definePersistentState({ key: "meta", version: 1, initial: { run: () => 1 } });
export default function App() { return <Text>ok</Text>; }
`),
		).not.toEqual([]);
	});
});

describe("color", () => {
	const withColor = (expression: string): string => `
import { color } from "@rowcat/runtime";
export default function App() { void ${expression}; return null; }
`;

	const typeErrors = (source: string): string[] =>
		compile(project([main(source)]))
			.diagnostics.filter((diagnostic) => diagnostic.source === "typescript")
			.map((diagnostic) => diagnostic.message);

	it.each([
		"#fff",
		"#FFF",
		"#12abEF",
		"#123456",
		"#12345678",
	])("%s passes", (value) => {
		expect(typeErrors(withColor(`color("${value}")`))).toEqual([]);
	});

	it.each([
		"#",
		"#ff",
		"#ffff",
		"#fffff",
		"#fffffff",
		"#fffffffff",
		"#ggg",
		"red",
		"rgb(1,2,3)",
		"transparent",
	])("%s is blocked", (value) => {
		expect(typeErrors(withColor(`color("${value}")`))).not.toEqual([]);
	});

	it("style cells do not accept bare strings", () => {
		expect(
			typeErrors(`
import { View } from "@rowcat/runtime";
export default function App() {
	return <View style={{ backgroundColor: "#ff00aa" }} />;
}
`),
		).not.toEqual([]);
	});

	it("sealed colors sit in style cells", () => {
		const result = compile(
			project([
				main(`
import { color, Text, View } from "@rowcat/runtime";
export default function App() {
	return (
		<View style={{ backgroundColor: color("#ff00aa") }}>
			<Text style={{ color: color("#fff") }}>hello</Text>
		</View>
	);
}
`),
			]),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});

	/**
	 * The path for a computed color is a single predicate. An overload accepting `color(dynamic)`
	 * there would let a wrong literal fall through to the wider side, which would neutralize the check
	 * above.
	 */
	it("dynamic strings cannot enter the sealing function", () => {
		expect(
			typeErrors(`
import { color } from "@rowcat/runtime";
declare const dynamic: string;
export default function App() { void color(dynamic); return null; }
`),
		).not.toEqual([]);
	});

	it("narrowed strings become colors", () => {
		const result = compile(
			project([
				main(`
import { isRuntimeColor, Text } from "@rowcat/runtime";
export default function App() {
	const raw = "#ff00aa" as string;
	if (!isRuntimeColor(raw)) return null;
	return <Text style={{ color: raw }}>hello</Text>;
}
`),
			]),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});
});

/**
 * The language contract for input and generation: the places where types enforce it, checked in a
 * real program.
 *
 * Unit tests that check only values cannot answer whether `onChange(event)` is blocked. The program
 * built here uses the same options, virtual layout, and TypeScript version as the answer Monaco
 * gives the creator.
 */
describe("text input", () => {
	const typeErrors = (source: string): string[] =>
		compile(project([main(source)]))
			.diagnostics.filter((diagnostic) => diagnostic.source === "typescript")
			.map((diagnostic) => diagnostic.message);

	it("controlled input passes", () => {
		const result = compile(
			project([
				main(`
import { TextInput, useState } from "@rowcat/runtime";
export default function App() {
	const [draft, setDraft] = useState("");
	return <TextInput value={draft} onChangeText={setDraft} onSubmit={() => {}} />;
}
`),
			]),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});

	/** `value` is required. The absence of uncontrolled input is fixed in the types (see §5). */
	it("input without value is blocked", () => {
		expect(
			typeErrors(`
import { TextInput } from "@rowcat/runtime";
export default function App() { return <TextInput onChangeText={() => {}} />; }
`),
		).not.toEqual([]);
	});

	/**
	 * The callback receives a single string; an event object does not cross this boundary (see §4 and
	 * §10).
	 */
	it("onChangeText takes a string, not an event object", () => {
		expect(
			typeErrors(`
import { TextInput } from "@rowcat/runtime";
export default function App() {
	return <TextInput value="" onChangeText={(event: { target: { value: string } }) => void event} />;
}
`),
		).not.toEqual([]);
	});

	it("does not take web event props", () => {
		for (const prop of ["onChange", "onKeyDown", "onInput", "onFocus"])
			expect(
				typeErrors(`
import { TextInput } from "@rowcat/runtime";
export default function App() { return <TextInput value="" ${prop}={() => {}} />; }
`),
				prop,
			).not.toEqual([]);
	});

	/** §8: multi-line input has no submit event. That absence is part of the contract. */
	it("TextArea has no onSubmit", () => {
		expect(
			typeErrors(`
import { TextArea } from "@rowcat/runtime";
export default function App() { return <TextArea value="" onSubmit={() => {}} />; }
`),
		).not.toEqual([]);
	});

	it("TextArea's controlled input passes", () => {
		const result = compile(
			project([
				main(`
import { TextArea, useState } from "@rowcat/runtime";
export default function App() {
	const [body, setBody] = useState("");
	return <TextArea value={body} onChangeText={setBody} placeholder="Body" />;
}
`),
			]),
		);
		expect(result.diagnostics).toEqual([]);
	});
});

describe("generation", () => {
	const typeErrors = (source: string): string[] =>
		compile(project([main(source)]))
			.diagnostics.filter((diagnostic) => diagnostic.source === "typescript")
			.map((diagnostic) => diagnostic.message);

	const app = (call: string): string => `
import { Button, useGeneration } from "@rowcat/runtime";
export default function App() {
	const generation = useGeneration();
	return <Button onPress={async () => { ${call} }}>Send</Button>;
}
`;

	it("generate() in an event handler passes", () => {
		const result = compile(
			project([
				main(
					app(
						'const result = await generation.generate({ messages: [{ role: "user", content: "hello" }], instructions: "You are Sena.", maxOutputCharacters: 600 }); void result.text;',
					),
				),
			]),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});

	/**
	 * §12: creators do not choose the provider. The fact that requests have no such axis holds in the
	 * types.
	 */
	it.each([
		'provider: "anthropic"',
		'model: "claude-sonnet-5"',
		'apiKey: "sk-x"',
		"temperature: 0.7",
		'reasoningEffort: "high"',
		"stream: true",
	])("%s cannot ride on the request", (extra) => {
		expect(
			typeErrors(
				app(
					`await generation.generate({ messages: [{ role: "user", content: "x" }], ${extra} });`,
				),
			),
		).not.toEqual([]);
	});

	/** Conversation roles are two; the system role's place belongs to `instructions`. */
	it("there is no system role", () => {
		expect(
			typeErrors(
				app(
					'await generation.generate({ messages: [{ role: "system", content: "x" }] });',
				),
			),
		).not.toEqual([]);
	});

	/** The result is a single text. Token counts, cost, and model id are not part of its shape. */
	it.each([
		"tokens",
		"cost",
		"model",
		"provider",
		"finishReason",
	])("cannot read the result's %s", (field) => {
		expect(
			typeErrors(
				app(
					`const result = await generation.generate({ messages: [{ role: "user", content: "x" }] }); void result.${field};`,
				),
			),
		).not.toEqual([]);
	});

	/** No streaming: `generate()` is a single promise (see §45). */
	it("the result cannot be iterated", () => {
		expect(
			typeErrors(
				app(
					'for await (const chunk of generation.generate({ messages: [{ role: "user", content: "x" }] })) void chunk;',
				),
			),
		).not.toEqual([]);
	});

	/**
	 * The capability name is not the creator's vocabulary; the root does not re-export that module.
	 */
	it("RUNTIME_GENERATION cannot be imported", () => {
		expect(
			typeErrors(`
import { RUNTIME_GENERATION } from "@rowcat/runtime";
export default function App() { void RUNTIME_GENERATION; return null; }
`),
		).not.toEqual([]);
	});
});
