import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Statically scans for things the host must never do. The package runs creator code, but never in
 * this process's realm. The shortest ways to break that are `new Function(code)`, `node:vm`, and
 * `import()`. The shortest way for the engine adapter to leak is for a session to start receiving a
 * `QuickJSHandle`. None of these breaks compilation, so only a static scan can catch them.
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
	[...sources(HERE)]
		.map((path) => ({
			name: path.slice(HERE.length),
			source: stripComments(readFileSync(path, "utf8")),
		}))
		.filter((file) => !file.name.startsWith("test/"));

/** Prelude and builtin source strings run inside the VM, so host rules do not apply to them. */
const host = () => files().filter((file) => !file.name.startsWith("builtins/"));

const FORBIDDEN: { door: RegExp; why: string }[] = [
	{
		door: /\beval\s*\(/,
		why: "the shortest path to running creator code in this process.",
	},
	{ door: /new\s+Function\s*\(/, why: "same as `eval`." },
	{
		door: /from\s+"node:vm"|require\(["']vm["']\)/,
		why: "Node's `vm` is not isolation.",
	},
	{
		door: /\bimport\s*\(/,
		why: "dynamic import is a path falling back to host resolution. Modules come only from the artifact and the builtin table.",
	},
	{
		door: /\bnew\s+Worker\s*\(/,
		why: "workers belong to the app. Isolation is the VM; a worker is a choice on top.",
	},
	{
		door: /<iframe|createObjectURL|innerHTML/,
		why: "the browser's execution and injection paths.",
	},
	{
		door: /\brequire\s*\(/,
		why: "CommonJS resolution is host resolution too.",
	},
];

/**
 * The ban on storage and network access applies to production code only. `poc/` holds fixtures and
 * the harness. Its `HIDDEN_GLOBALS` is not a violation but the opposite claim: a list of globals
 * verified to be invisible inside the VM. A name-based scan cannot tell these apart, so the scope
 * is narrowed, as it is for prelude strings.
 */
const PERSISTENCE_FORBIDDEN: { door: RegExp; why: string }[] = [
	/**
	 * The package does not decide where persistent state is stored. The only store here is in memory.
	 * Where that snapshot lives and for how long is a question this version does not answer (§46). If
	 * a storage name were allowed in, that answer would be set silently, and the package would stop
	 * being platform-neutral.
	 */
	{
		door: /\bDexie\b|\bindexedDB\b|\bopenDatabase\b|expo-sqlite|\blocalStorage\b/,
		why: "the host's consumer decides the storage medium: this package is platform-neutral.",
	},
	{
		door: /\bfetch\s*\(|XMLHttpRequest|@rowcat\/sdk/,
		why: "this package knows no network.",
	},
];

describe("does not decide where things are saved", () => {
	it.each(PERSISTENCE_FORBIDDEN)("$door is not in production code", ({
		door,
		why,
	}) => {
		const offenders = host()
			.filter((file) => !file.name.startsWith("poc/"))
			.filter((file) => door.test(file.source))
			.map((file) => file.name);
		expect(offenders, why).toEqual([]);
	});
});

/**
 * Boundary of the generation capability: it knows no provider and does not touch storage. Both are
 * enforced by name only. The provider rule keeps this layer from becoming a second AI stack, which
 * would make the injected port meaningless. The storage rule makes the promise that AI output never
 * silently changes saved state hold by structure rather than wiring: if the file does not import
 * the store, code that writes to it cannot exist.
 */
describe("generation is a capability, not a stack", () => {
	const generation = () => {
		const file = files().find((entry) => entry.name === "generation.ts");
		if (file === undefined) throw new Error("no generation.ts");
		return file.source;
	};

	it.each([
		"anthropic",
		"openai",
		"gemini",
		"openrouter",
		"apiKey",
		"Authorization",
		"baseUrl",
		"model",
		"temperature",
		"churu",
		"billing",
	])("provider and payment vocabulary %s is absent", (word) => {
		expect(generation().toLowerCase()).not.toContain(word.toLowerCase());
	});

	it("does not reach the story state store", () => {
		for (const door of [
			/story-state/,
			/persistent-state/,
			/durable-snapshot/,
			/storyStore|persistentStore/,
		])
			expect(generation(), String(door)).not.toMatch(door);
	});
});

describe("does not execute in this realm", () => {
	it.each(FORBIDDEN)("$door is absent from this package", ({ door, why }) => {
		const offenders = host()
			.filter((file) => door.test(file.source))
			.map((file) => file.name);
		expect(offenders, why).toEqual([]);
	});
});

describe("the engine sits behind one adapter", () => {
	it("vm/quickjs.ts is the only file bringing in quickjs-emscripten", () => {
		const offenders = files()
			.filter((file) => /quickjs-emscripten/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual(["vm/quickjs.ts"]);
	});

	it("the engine's name does not appear outside the adapter", () => {
		const offenders = files()
			.filter((file) => file.name !== "vm/quickjs.ts")
			.filter((file) =>
				/QuickJS(Context|Runtime|Handle|Value|WASMModule|DeferredPromise)/.test(
					file.source,
				),
			)
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	it("the root does not re-export the adapter", () => {
		const index = files().find((file) => file.name === "index.ts");
		expect(index?.source).not.toMatch(/vm\/quickjs/);
	});
});

describe("the scheduler does not choose the platform's yield API", () => {
	it("requestAnimationFrame, requestIdleCallback, postTask and setImmediate are absent from the core", () => {
		const offenders = host()
			.filter((file) =>
				/requestAnimationFrame|requestIdleCallback|scheduler\.postTask|setImmediate|MessageChannel/.test(
					file.source,
				),
			)
			.map((file) => file.name);
		expect(
			offenders,
			"yielding is injected through the clock port (`scheduler/clock.ts`)",
		).toEqual([]);
	});

	it("the default clock is the only file that knows setTimeout", () => {
		const offenders = host()
			.filter((file) => !file.name.startsWith("poc/"))
			.filter((file) => /\bsetTimeout\b/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual(["scheduler/clock.ts"]);
	});
});

describe("memory isolation is a per-session WebAssembly.Memory", () => {
	/**
	 * Measured in Phase 3: `setMemoryLimit` is effectively a no-op in this build. Under an 8MiB limit
	 * the heap still grew to 2GiB. Its replacement is linear memory with a per-session `maximum`. If
	 * that line disappears, the session test's memory check still fails but cannot say why, so this
	 * test checks the line by name.
	 */
	it("the adapter creates and passes memory with a maximum per session", () => {
		const adapter =
			files().find((file) => file.name === "vm/quickjs.ts")?.source ?? "";
		expect(adapter).toMatch(
			/new \(wasm\(\)\.Memory\)\(\{\s*initial: WASM_INITIAL_PAGES,\s*maximum,/,
		);
		expect(adapter).toMatch(/wasmMemory: memory/);
		expect(adapter).toMatch(/setMemoryLimit\(options\.memoryBytes\)/);
	});
});

describe("platform and layer coupling", () => {
	it("no file knows Node APIs", () => {
		const offenders = files()
			.filter((file) => /from\s+"node:/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	it("brings in no React, UI, authoring store, API or compiler engine", () => {
		const forbidden =
			/from\s+"(@rowcat\/(authoring|chat|sdk|query|ui-web|ui-native|sync|contracts|domain)|react|react-native|dexie|monaco|typescript-compiler-api|typescript)["/]/;
		const offenders = files()
			.filter((file) => forbidden.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	/**
	 * The compiler is a dependency for its contracts and path rules only. A subpath import does not
	 * say what that module pulls in: `remote-assets` imports the TypeScript compiler at top level, and
	 * while the host took one constant from it the whole compiler shipped into the player worker and
	 * the native harness (3.7 MiB). So the allowlist is checked here, and each allowed module is walked
	 * to its local imports to prove none of them reaches TypeScript.
	 */
	it("takes from the compiler only modules that do not pull in TypeScript", () => {
		const allowed = new Set(["contracts", "paths", "module-resolution"]);
		const taken = new Set<string>();
		for (const file of files())
			for (const match of file.source.matchAll(
				/from\s+"@rowcat\/runtime-compiler(?:\/([\w-]+))?"/g,
			))
				taken.add(match[1] ?? "(root)");
		expect([...taken].filter((name) => !allowed.has(name))).toEqual([]);

		const compiler = fileURLToPath(
			new URL("../../runtime-compiler/src/", import.meta.url),
		);
		const seen = new Set<string>();
		const reachesTypeScript = (name: string): boolean => {
			if (seen.has(name)) return false;
			seen.add(name);
			const source = stripComments(
				readFileSync(join(compiler, `${name}.ts`), "utf8"),
			);
			if (/from\s+"(typescript|typescript-compiler-api)"/.test(source))
				return true;
			return [...source.matchAll(/from\s+"\.\/([\w-]+)\.ts"/g)].some((match) =>
				reachesTypeScript(match[1]),
			);
		};
		expect([...taken].filter(reachesTypeScript)).toEqual([]);
	});

	it("does not call the compiler's execute function: input is always an artifact", () => {
		const offenders = files()
			.filter((file) =>
				/compileRuntimeProject|analyzeRuntimeProject/.test(file.source),
			)
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});
});
