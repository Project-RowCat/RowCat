import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans for what the renderer must NOT do. The package receives JSON batches, and the
 * strings inside are creator-authored. Three paths turn those strings into power: markup
 * (innerHTML), addresses (src = path) and DOM authority (setAttribute(name, value), element[name] =
 * value). Each is a single line that would not break compilation, so they are blocked here by name.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const stripComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

function* sources(root: string): Generator<string> {
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) {
			yield* sources(path);
			continue;
		}
		if (!/\.ts$/.test(name) || name.includes(".test.")) continue;
		yield path;
	}
}

const files = () =>
	[...sources(HERE)].map((path) => ({
		name: path.slice(HERE.length),
		source: stripComments(readFileSync(path, "utf8")),
	}));

const FORBIDDEN: { door: RegExp; why: string }[] = [
	{
		door: /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/,
		why: "a path for creator text to become markup. The protocol carries primitives, not HTML.",
	},
	{
		door: /new\s+DOMParser|createContextualFragment/,
		why: "a path parsing strings into DOM: same as above.",
	},
	{ door: /\beval\s*\(/, why: "creator code runs only inside QuickJS/WASM." },
	{ door: /new\s+Function\s*\(/, why: "same as `eval`." },
	{
		door: /setAttribute\s*\(\s*(?:name|key|prop|patch\.name)\b/,
		why: "using prop names as attribute names makes runtime props authority over the whole DOM.",
	},
	{
		door: /\]\s*=\s*(?:value|patch\.value)\b|\(element\(record\) as any\)/,
		why: "assigning DOM properties by name: same as above.",
	},
	{
		door: /\bfetch\s*\(|XMLHttpRequest|WebSocket/,
		why: "the renderer knows no network. The resolver gives asset addresses.",
	},
];

describe("boundaries", () => {
	it.each(FORBIDDEN)("$door is absent from this package", ({ door, why }) => {
		const offenders = files()
			.filter((file) => door.test(file.source))
			.map((file) => file.name);
		expect(offenders, why).toEqual([]);
	});

	it("brings in no React, UI, authoring, query, API or Node", () => {
		const forbidden =
			/from\s+"(react|react-dom|monaco-editor|dexie|@tanstack\/|@rowcat\/(authoring|chat|sdk|query|ui-web|ui-native|sync|contracts|domain)|node:)/;
		const offenders = files()
			.filter((file) => forbidden.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	/**
	 * Does not import the root of the host package. Its entry point brings in sessions, engines and
	 * the generated sandbox, while this renderer belongs to the main thread. Only the contract's shape
	 * is needed. Two subpaths are allowed, and they are the same kind: patches (the tree vocabulary)
	 * and commands (the control vocabulary). Both contain only types and validators, with no VM or
	 * engine. What is blocked is the root, not a count of subpaths. When adding a third, ask the same
	 * question: does that path pull in a session?
	 */
	it("runtime-host is brought in only via the patches and commands subpaths", () => {
		const offenders = files()
			.filter((file) =>
				/from\s+"@rowcat\/runtime-host(?!\/(patches|commands)")/.test(
					file.source,
				),
			)
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	/** The only place a logical asset path may sit in src is the answer from the resolver. */
	it("src holds only the resolver's answer", () => {
		const props =
			files().find((file) => file.name === "props.ts")?.source ?? "";
		expect(props).toMatch(/image\.src = url/);
		expect(props).not.toMatch(/\.src = path/);
	});
});
