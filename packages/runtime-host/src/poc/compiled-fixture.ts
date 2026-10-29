import type { RuntimeArtifact } from "@rowcat/runtime-compiler/contracts";

/**
 * **A snapshot of an artifact** the compiler built: what the PoC harness runs on devices.
 *
 * Not hand-written. It is the result of feeding the source in `compiled-fixture-source.ts` to `@rowcat/runtime-compiler`
 * as is, and `compiled-fixture.test.ts` recompiles it every time to confirm that.
 * The snapshot exists because of where the harness runs: browser workers and the native WebView have no
 * TypeScript compiler and must not (§6: compilation and execution are separate). An artifact is
 * "a value from a server, a cache or another process", and this file is the first case.
 */
export const POC_COMPILED_ARTIFACT: RuntimeArtifact = {
	formatVersion: 1,
	apiVersion: 7,
	compilerVersion: 1,
	entry: "src/main.tsx",
	modules: [
		{
			id: "src/a.ts",
			code: 'import { b } from "./b";\nexport const a = 40;\nexport function fromB() { return b(); }\n',
			dependencies: [
				{
					specifier: "./b",
					kind: "local",
					resolved: "src/b.ts",
				},
			],
			map: '{"version":3,"file":"src/a.ts","sources":["src/a.ts"],"names":[],"mappings":"AAAA,OAAO,EAAE,CAAC,EAAE,MAAM,KAAK,CAAC;AACxB,MAAM,CAAC,MAAM,CAAC,GAAG,EAAE,CAAC;AACpB,MAAM,UAAU,KAAK,KAAK,OAAO,CAAC,EAAE,CAAC,CAAC,CAAC"}',
		},
		{
			id: "src/b.ts",
			code: 'import { a } from "./a";\nexport function b() { return a + 2; }\n',
			dependencies: [
				{
					specifier: "./a",
					kind: "local",
					resolved: "src/a.ts",
				},
			],
			map: '{"version":3,"file":"src/b.ts","sources":["src/b.ts"],"names":[],"mappings":"AAAA,OAAO,EAAE,CAAC,EAAE,MAAM,KAAK,CAAC;AACxB,MAAM,UAAU,CAAC,KAAK,OAAO,CAAC,GAAG,CAAC,CAAC,CAAC,CAAC"}',
		},
		{
			id: "src/counter.ts",
			code: "let value = 0;\nexport function next() { return ++value; }\n",
			dependencies: [],
			map: '{"version":3,"file":"src/counter.ts","sources":["src/counter.ts"],"names":[],"mappings":"AAAA,IAAI,KAAK,GAAG,CAAC,CAAC;AACd,MAAM,UAAU,IAAI,KAAK,OAAO,EAAE,KAAK,CAAC,CAAC,CAAC"}',
		},
		{
			id: "src/main.tsx",
			code: 'import { jsx as _jsx } from "@rowcat/runtime/jsx-runtime";\nimport { Screen, Text, isRuntimeElement } from "@rowcat/runtime";\nimport { next } from "./counter";\nimport { fromB } from "./a";\nexport function add(a, b) { return a + b; }\nexport function probe() { const el = App(); return [isRuntimeElement(el), next(), next(), fromB()]; }\nexport default function App() { return _jsx(Screen, { children: _jsx(Text, { children: "RowCat" }) }); }\n',
			dependencies: [
				{
					specifier: "@rowcat/runtime",
					kind: "builtin",
					resolved: "rowcat:runtime",
				},
				{
					specifier: "./counter",
					kind: "local",
					resolved: "src/counter.ts",
				},
				{
					specifier: "./a",
					kind: "local",
					resolved: "src/a.ts",
				},
			],
			map: '{"version":3,"file":"src/main.tsx","sources":["src/main.tsx"],"names":[],"mappings":";AAAA,OAAO,EAAE,MAAM,EAAE,IAAI,EAAE,gBAAgB,EAAE,MAAM,iBAAiB,CAAC;AACjE,OAAO,EAAE,IAAI,EAAE,MAAM,WAAW,CAAC;AACjC,OAAO,EAAE,KAAK,EAAE,MAAM,KAAK,CAAC;AAC5B,MAAM,UAAU,GAAG,CAAC,CAAS,EAAE,CAAS,IAAI,OAAO,CAAC,GAAG,CAAC,CAAC,CAAC,CAAC;AAC3D,MAAM,UAAU,KAAK,KAAK,MAAM,EAAE,GAAG,GAAG,EAAE,CAAC,CAAC,OAAO,CAAC,gBAAgB,CAAC,EAAE,CAAC,EAAE,IAAI,EAAE,EAAE,IAAI,EAAE,EAAE,KAAK,EAAE,CAAC,CAAC,CAAC,CAAC;AACrG,MAAM,CAAC,OAAO,UAAU,GAAG,KAAK,OAAO,KAAC,MAAM,cAAC,KAAC,IAAI,yBAAc,GAAS,CAAC,CAAC,CAAC"}',
		},
	],
	sourceHash: "38a629872d50f72cc9c112f5970716e5",
	/** This fixture uses no remote images: an empty list means "no authorized addresses". */
	remoteAssets: [],
};
