import { describe, expect, it } from "vitest";
import {
	fileStrippable,
	loadedPackages,
	packageDroppable,
	packageRootOf,
} from "./prune.ts";

describe("packageRootOf", () => {
	it("finds the package a file belongs to, scoped and nested", () => {
		expect(packageRootOf("node_modules/hono/dist/index.js")).toBe(
			"node_modules/hono",
		);
		expect(packageRootOf("node_modules/@img/sharp-win32-x64/sharp.node")).toBe(
			"node_modules/@img/sharp-win32-x64",
		);
		expect(
			packageRootOf("node_modules/a/node_modules/@s/b/lib/x.js"),
		).toBe("node_modules/a/node_modules/@s/b");
		expect(packageRootOf("dist/index.mjs")).toBeNull();
	});
});

describe("loadedPackages", () => {
	// The trace reads drizzle-kit's package.json while resolving an optional peer and loads nothing.
	it("does not count a package whose package.json was only looked up", () => {
		const loaded = loadedPackages([
			"dist/index.mjs",
			"node_modules/hono/package.json",
			"node_modules/hono/dist/index.js",
			"node_modules/drizzle-kit/package.json",
		]);
		expect([...loaded]).toEqual(["node_modules/hono"]);
	});
});

describe("packageDroppable", () => {
	const loaded = new Set(["node_modules/a/node_modules/b"]);

	it("keeps a folder that holds a loaded package further down", () => {
		expect(packageDroppable("node_modules/a", loaded)).toBe(false);
		expect(packageDroppable("node_modules/a/node_modules/b", loaded)).toBe(
			false,
		);
	});

	it("drops a package nothing loaded, even one whose name prefixes a kept one", () => {
		expect(packageDroppable("node_modules/a/node_modules/c", loaded)).toBe(
			true,
		);
		expect(packageDroppable("node_modules/a-b", loaded)).toBe(true);
	});
});

describe("fileStrippable", () => {
	const none = new Set<string>();

	it("drops what Node never executes", () => {
		for (const file of [
			"node_modules/zod/index.d.cts",
			"node_modules/zod/src/v4/core.ts",
			"node_modules/hono/dist/index.js.map",
			"node_modules/hono/README.md",
		])
			expect(fileStrippable(file, none)).toBe(true);
	});

	it("keeps code, native modules and license texts", () => {
		for (const file of [
			"node_modules/hono/dist/index.js",
			"node_modules/@img/sharp-win32-x64/lib/sharp.node",
			"node_modules/hono/LICENSE",
			"node_modules/zod/LICENSE.md",
		])
			expect(fileStrippable(file, none)).toBe(false);
	});

	// The publication compiler reads TypeScript's standard library with readdirSync.
	it("keeps every file of a package that reads its own files", () => {
		expect(
			fileStrippable(
				"node_modules/typescript-compiler-api/lib/lib.es2022.d.ts",
				none,
			),
		).toBe(false);
	});

	it("never drops a file the trace loaded, whatever its name", () => {
		const file = "node_modules/odd/loader.ts";
		expect(fileStrippable(file, new Set([file]))).toBe(false);
	});
});
