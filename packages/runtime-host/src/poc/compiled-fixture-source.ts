import type { RuntimeCompileFile } from "@rowcat/runtime-compiler/contracts";

/**
 * The source for the PoC fixture. The artifact in `compiled-fixture.ts` is the result of compiling
 * these files.
 *
 * These sources are kept separate to catch stale snapshots. compiled-fixture.test.ts recompiles
 * them with the current compiler and compares against the snapshot. If compiler output changes,
 * that test fails first, so an artifact running on a device cannot quietly stay on the old
 * compiler's output.
 */
export const POC_FIXTURE_FILES: readonly RuntimeCompileFile[] = [
	{
		path: "src/main.tsx",
		content: [
			'import { Screen, Text, isRuntimeElement } from "@rowcat/runtime";',
			'import { next } from "./counter";',
			'import { fromB } from "./a";',
			"export function add(a: number, b: number) { return a + b; }",
			"export function probe() { const el = App(); return [isRuntimeElement(el), next(), next(), fromB()]; }",
			"export default function App() { return <Screen><Text>RowCat</Text></Screen>; }",
			"",
		].join("\n"),
	},
	{
		path: "src/counter.ts",
		content: "let value = 0;\nexport function next() { return ++value; }\n",
	},
	{
		path: "src/a.ts",
		content:
			'import { b } from "./b";\nexport const a = 40;\nexport function fromB() { return b(); }\n',
	},
	{
		path: "src/b.ts",
		content:
			'import { a } from "./a";\nexport function b() { return a + 2; }\n',
	},
];
