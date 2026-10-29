import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { describe, expect, it } from "vitest";
import { compileRuntimeProject } from "./compile.ts";
import {
	RUNTIME_DIAGNOSTIC_CODE,
	type RuntimeCompileFile,
	type RuntimeCompileInput,
} from "./contracts.ts";
import { nodeRuntimeEnvironment } from "./environment/node.ts";
import { RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS } from "./remote-assets.ts";

/**
 * Remote image allowlists must be deterministic and derived from source. This file guards one
 * thing: addresses built from runtime values never enter the list. If that failed, a single asset()
 * line would become a channel that sends player-typed text to the creator's server. Not being able
 * to read the response does not prevent it; a one-way channel with no eyes is still a channel.
 */

const environment = nodeRuntimeEnvironment();

const project = (
	files: readonly RuntimeCompileFile[],
	entry = "src/main.tsx",
): RuntimeCompileInput => ({ apiVersion: RUNTIME_API_VERSION, entry, files });

/**
 * Writes a runtime substitution inside creator source. A plain string containing `${` would be
 * flagged by the linter as a template that should be a template literal. Here the sequence is
 * literal text in the creator's source, not a template in this file, so it is concatenated to avoid
 * the misreading.
 */
const SUB = (name: string): string => `\${${name}}`;

/** Minimal app that draws one image. Tests swap only the expression in its body. */
const app = (expression: string): string => `
import { Image, Screen, asset } from "@rowcat/runtime";
export default function App() {
	const id = "sena";
	return <Screen><Image source={${expression}} alt="a" /></Screen>;
}
`;

const manifestOf = (source: string): readonly string[] => {
	const result = compileRuntimeProject(
		project([{ path: "src/main.tsx", content: source }]),
		environment,
	);
	expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("compilation failed");
	return result.artifact.remoteAssets ?? [];
};

describe("only statically declared addresses enter the list", () => {
	it("literals enter", () => {
		expect(manifestOf(app('asset("https://cdn.example.com/a.png")'))).toEqual([
			"https://cdn.example.com/a.png",
		]);
	});

	/**
	 * A static URL with a query string is kept whole. CDN transforms and signed URLs have this shape.
	 */
	it("the **whole** address including the query enters", () => {
		expect(
			manifestOf(app('asset("https://cdn.example.com/a.png?width=800&q=90")')),
		).toEqual(["https://cdn.example.com/a.png?width=800&q=90"]);
	});

	it("a template without substitutions is the same text", () => {
		expect(manifestOf(app("asset(`https://cdn.example.com/a.png`)"))).toEqual([
			"https://cdn.example.com/a.png",
		]);
	});

	/**
	 * The same address written twice still yields one entry, because canonicalization removes
	 * duplicates.
	 */
	it("duplicates are one", () => {
		const source = `
import { Image, Screen, asset } from "@rowcat/runtime";
export default function App() {
	return (
		<Screen>
			<Image source={asset("https://cdn.example.com/a.png")} alt="a" />
			<Image source={asset("https://cdn.example.com/a.png")} alt="b" />
		</Screen>
	);
}
`;
		expect(manifestOf(source)).toEqual(["https://cdn.example.com/a.png"]);
	});

	/**
	 * A module-level constant also counts, because its literal is in the source. Without this,
	 * ordinary authoring such as const COVER = 'https://...' would silently become a placeholder, and
	 * that failure would only surface after publishing. Scope analysis is not needed for this.
	 */
	it("module constants enter too: that text is in the source", () => {
		const source = `
import { Image, Screen, asset } from "@rowcat/runtime";
const COVER = "https://cdn.example.com/cover.webp";
export default function App() {
	return <Screen><Image source={asset(COVER)} alt="a" /></Screen>;
}
`;
		expect(manifestOf(source)).toEqual(["https://cdn.example.com/cover.webp"]);
	});

	/**
	 * Addresses written in other files of the same project count too. Every reachable module is
	 * scanned.
	 */
	it("addresses from other reachable modules enter too", () => {
		const result = compileRuntimeProject(
			project([
				{
					path: "src/main.tsx",
					content: `
import { Image, Screen } from "@rowcat/runtime";
import { cover } from "./art";
export default function App() {
	return <Screen><Image source={cover} alt="a" /></Screen>;
}
`,
				},
				{
					path: "src/art.ts",
					content:
						'import { asset } from "@rowcat/runtime";\nexport const cover = asset("https://cdn.example.com/b.png");\n',
				},
			]),
			environment,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.artifact.remoteAssets).toEqual([
			"https://cdn.example.com/b.png",
		]);
	});

	/**
	 * Sorting is by code unit, so the order in which files are scanned does not leak into the list.
	 */
	it("the list is sorted deterministically", () => {
		const source = `
import { Image, Screen, asset } from "@rowcat/runtime";
export default function App() {
	return (
		<Screen>
			<Image source={asset("https://cdn.example.com/z.png")} alt="z" />
			<Image source={asset("https://cdn.example.com/a.png")} alt="a" />
			<Image source={asset("https://alt.example.com/m.png")} alt="m" />
		</Screen>
	);
}
`;
		expect(manifestOf(source)).toEqual([
			"https://alt.example.com/m.png",
			"https://cdn.example.com/a.png",
			"https://cdn.example.com/z.png",
		]);
	});
});

describe("addresses built from runtime values are not authorized", () => {
	/**
	 * This group is the entire set of checks for this slice. The question is not whether the list is
	 * empty but whether the assembled address appears in the list, and the answer must always be no.
	 */
	it.each([
		[
			"template with substitutions",
			`asset(\`https://creator.example/p.png?q=${SUB("id")}\`)`,
			"https://creator.example/p.png?q=sena",
		],
		[
			"concatenation",
			'asset("https://creator.example/p.png?q=" + id)',
			"https://creator.example/p.png?q=sena",
		],
		[
			"path assembly",
			'asset("https://cdn.example.com/" + id + ".png")',
			"https://cdn.example.com/sena.png",
		],
	])("the result of %s is not in the list", (_label, expression, assembled) => {
		expect(manifestOf(app(expression))).not.toContain(assembled);
	});

	it("values made by functions leave nothing", () => {
		const source = `
import { Image, Screen, asset } from "@rowcat/runtime";
function pick(): string {
	return ["a", "b"].join("");
}
export default function App() {
	return <Screen><Image source={asset(pick())} alt="a" /></Screen>;
}
`;
		expect(manifestOf(source)).toEqual([]);
	});

	/**
	 * Logical paths are not an authorization axis. Mixing them into the list would make one list carry
	 * two kinds of entries.
	 */
	it("logical paths do not enter the list", () => {
		expect(manifestOf(app(`asset(\`characters/${SUB("id")}/face\`)`))).toEqual(
			[],
		);
		expect(manifestOf(app('asset("characters/sena/face")'))).toEqual([]);
	});
});

describe("list caps", () => {
	/**
	 * The list is sent to players' devices as metadata, so both the count and the length are capped.
	 */
	it("compilation is refused past the count", () => {
		const urls = Array.from(
			{ length: RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxCount + 1 },
			(_value, index) => `\tasset("https://cdn.example.com/a${index}.png");`,
		).join("\n");
		const source = `
import { Screen, Text, asset } from "@rowcat/runtime";
export default function App() {
${urls}
	return <Screen><Text>hi</Text></Screen>;
}
`;
		const result = compileRuntimeProject(
			project([{ path: "src/main.tsx", content: source }]),
			environment,
		);
		expect(result.ok).toBe(false);
		expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
			RUNTIME_DIAGNOSTIC_CODE.remoteAssetLimit,
		);
	});
});
