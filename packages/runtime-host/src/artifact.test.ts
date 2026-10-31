import {
	RUNTIME_API_MIN_COMPATIBLE_VERSION,
	RUNTIME_API_VERSION,
} from "@rowcat/runtime/declarations";
import { RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS } from "@rowcat/runtime-compiler/contracts";
import { describe, expect, it } from "vitest";
import { validateRuntimeArtifact } from "./artifact.ts";
import { RUNTIME_HOST_ERROR_CODE } from "./errors.ts";

/** Artifact validation tests. Even a value with a type annotation is untrusted input. */

const builtins = new Set(["rowcat:runtime", "rowcat:runtime/jsx-runtime"]);

const valid = () => ({
	formatVersion: 1,
	apiVersion: RUNTIME_API_VERSION,
	compilerVersion: 1,
	entry: "src/main.tsx",
	sourceHash: "abc",
	modules: [
		{
			id: "src/main.tsx",
			code: "export {};",
			dependencies: [
				{ specifier: "./util", kind: "local", resolved: "src/util.ts" },
				{
					specifier: "@rowcat/runtime",
					kind: "builtin",
					resolved: "rowcat:runtime",
				},
			],
		},
		{ id: "src/util.ts", code: "export {};", dependencies: [] },
	],
});

const check = (mutate: (artifact: ReturnType<typeof valid>) => unknown) => {
	const artifact = valid();
	const mutated = mutate(artifact);
	return validateRuntimeArtifact(mutated === undefined ? artifact : mutated, {
		builtins,
	});
};

describe("a valid artifact", () => {
	it("passes and is reassembled into the shape we know", () => {
		const result = check(() => undefined);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.artifact.modules.map((module) => module.id)).toEqual([
			"src/main.tsx",
			"src/util.ts",
		]);
		expect(Object.keys(result.artifact).sort()).toEqual([
			"apiVersion",
			"compilerVersion",
			"entry",
			"formatVersion",
			"modules",
			/** Even artifacts without a list carry this field. Empty means no addresses are authorized. */
			"remoteAssets",
			"sourceHash",
		]);
	});
});

describe("refusal", () => {
	it.each<[string, (a: ReturnType<typeof valid>) => unknown]>([
		["not an object", () => "nope"],
		["format version", (a) => ({ ...a, formatVersion: 2 })],
		["API version newer than the host", (a) => ({ ...a, apiVersion: 99 })],
		[
			"API version below the window",
			(a) => ({ ...a, apiVersion: RUNTIME_API_MIN_COMPATIBLE_VERSION - 1 }),
		],
		["API version not an integer", (a) => ({ ...a, apiVersion: "7" })],
		["compiler version", (a) => ({ ...a, compilerVersion: 0 })],
		["no hash", (a) => ({ ...a, sourceHash: undefined })],
		[
			"entry point is not a source path",
			(a) => ({ ...a, entry: "src/main.js" }),
		],
		["entry point not in modules", (a) => ({ ...a, entry: "src/other.ts" })],
		["no modules", (a) => ({ ...a, modules: [] })],
		[
			"duplicate module id",
			(a) => ({ ...a, modules: [...a.modules, a.modules[1]] }),
		],
		/**
		 * entry is changed along with the module id. Otherwise the artifact is rejected as 'entry not in
		 * modules', and the path check would appear to pass without ever really running. This actually
		 * happened.
		 */
		[
			"module id escapes the root",
			(a) => ({
				...a,
				entry: "../escape.ts",
				modules: [{ ...a.modules[0], id: "../escape.ts" }, a.modules[1]],
			}),
		],
		[
			"module id shaped like a host drive",
			(a) => ({
				...a,
				entry: "<rowcat:pwn.ts",
				modules: [{ ...a.modules[0], id: "<rowcat:pwn.ts" }, a.modules[1]],
			}),
		],
		[
			"module id shaped like a builtin",
			(a) => ({
				...a,
				entry: "rowcat:internal/host.ts",
				modules: [
					{ ...a.modules[0], id: "rowcat:internal/host.ts" },
					a.modules[1],
				],
			}),
		],
		[
			"module id not canonical",
			(a) => ({
				...a,
				entry: "src//main.tsx",
				modules: [{ ...a.modules[0], id: "src//main.tsx" }, a.modules[1]],
			}),
		],
		[
			"code is not a string",
			(a) => ({ ...a, modules: [{ ...a.modules[0], code: 1 }, a.modules[1]] }),
		],
		[
			"no dependency table",
			(a) => ({
				...a,
				modules: [{ ...a.modules[0], dependencies: undefined }, a.modules[1]],
			}),
		],
		[
			"a local dependency points at a missing module",
			(a) => ({
				...a,
				modules: [
					{
						...a.modules[0],
						dependencies: [
							{ specifier: "./x", kind: "local", resolved: "src/x.ts" },
						],
					},
					a.modules[1],
				],
			}),
		],
		[
			"a builtin dependency is off the allowlist",
			(a) => ({
				...a,
				modules: [
					{
						...a.modules[0],
						dependencies: [
							{
								specifier: "rowcat:internal/poc",
								kind: "builtin",
								resolved: "rowcat:internal/poc",
							},
						],
					},
					a.modules[1],
				],
			}),
		],
		[
			"unknown dependency kind",
			(a) => ({
				...a,
				modules: [
					{
						...a.modules[0],
						dependencies: [
							{ specifier: "lodash", kind: "npm", resolved: "lodash" },
						],
					},
					a.modules[1],
				],
			}),
		],
	])("%s", (_label, mutate) => {
		const result = check(mutate);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe(RUNTIME_HOST_ERROR_CODE.artifactInvalid);
	});
});

/**
 * The authorization list: the complete set of addresses that remote images may fetch.
 *
 * A corrupted list is rejected, not silently filtered, because a silently filtered list would
 * produce a work where only some images draw, and neither the creator nor the compiler could trace
 * that. A missing list is different. It is not corruption; it is the normal state of an older
 * format, and it means 'no addresses are authorized'. Folding it into 'allow all' would let an
 * artifact that removes the field open the defense completely.
 */
describe("remote asset list", () => {
	it("absent means an empty list, not allow-all", () => {
		const result = check(() => undefined);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.artifact.remoteAssets).toEqual([]);
	});

	it("comes back through canonicalization: duplicates fold and order is by code unit", () => {
		const result = check((a) => ({
			...a,
			remoteAssets: [
				"https://cdn.example.com/z.png",
				"https://cdn.example.com/a.png",
				"https://cdn.example.com/z.png",
			],
		}));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.artifact.remoteAssets).toEqual([
			"https://cdn.example.com/a.png",
			"https://cdn.example.com/z.png",
		]);
	});

	it.each<[string, unknown]>([
		["not an array", "https://cdn.example.com/a.png"],
		["non-string entry", [{ url: "https://cdn.example.com/a.png" }]],
		["not a remote address", ["characters/sena/smile"]],
		["plain http", ["http://cdn.example.com/a.png"]],
		["private network name", ["https://localhost/a.png"]],
		[
			"count cap",
			Array.from(
				{ length: RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxCount + 1 },
				(_value, index) => `https://cdn.example.com/a${index}.png`,
			),
		],
		[
			"length cap",
			Array.from(
				{ length: 16 },
				(_value, index) =>
					`https://cdn.example.com/${"a".repeat(6_000)}-${index}.png`,
			),
		],
	])("%s is refused", (_label, remoteAssets) => {
		const result = check((a) => ({ ...a, remoteAssets }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe(RUNTIME_HOST_ERROR_CODE.artifactInvalid);
	});
});

describe("compatibility window", () => {
	/**
	 * An older version inside the window passes through unchanged, under its own version. Overwriting
	 * it with the host's version is the point: if the host overwrote it, nobody could tell which
	 * version the session actually runs.
	 */
	it("old versions inside the window pass and keep their own version", () => {
		const previous = RUNTIME_API_VERSION - 1;
		if (previous < RUNTIME_API_MIN_COMPATIBLE_VERSION) return;
		const result = validateRuntimeArtifact(
			{ ...valid(), apiVersion: previous },
			{ builtins },
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.artifact.apiVersion).toBe(previous);
	});

	it("the lower bound itself passes", () => {
		const result = validateRuntimeArtifact(
			{ ...valid(), apiVersion: RUNTIME_API_MIN_COMPATIBLE_VERSION },
			{ builtins },
		);
		expect(result.ok).toBe(true);
	});

	it("the refusal sentence splits by direction: republish or update the app", () => {
		const old = validateRuntimeArtifact(
			{ ...valid(), apiVersion: RUNTIME_API_MIN_COMPATIBLE_VERSION - 1 },
			{ builtins },
		);
		expect(old.ok).toBe(false);
		if (!old.ok) expect(old.error.message).toMatch(/republish/);
		const future = validateRuntimeArtifact(
			{ ...valid(), apiVersion: RUNTIME_API_VERSION + 1 },
			{ builtins },
		);
		expect(future.ok).toBe(false);
		if (!future.ok) expect(future.error.message).toMatch(/update the app/);
	});
});
