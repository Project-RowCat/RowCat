import { describe, expect, it } from "vitest";
import {
	extensionFileKept,
	extensionsCreatedBy,
	fileRemovable,
	loadedPackages,
	packageDroppable,
	packageRootOf,
	wholePackages,
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

describe("wholePackages", () => {
	const loaded = new Set([
		"node_modules/hono",
		"node_modules/typescript-compiler-api",
		"node_modules/@img/sharp-win32-x64",
	]);

	it("keeps whole what reads its own files and what carries a native binary", () => {
		const whole = wholePackages(loaded, [
			"node_modules/hono/dist/index.js",
			"node_modules/@img/sharp-win32-x64/lib/libvips-42.dll",
			"node_modules/unloaded/bin/tool.exe",
		]);
		expect([...whole].sort()).toEqual([
			"node_modules/@img/sharp-win32-x64",
			"node_modules/typescript-compiler-api",
		]);
	});
});

describe("fileRemovable", () => {
	const traced = new Set([
		"node_modules/drizzle-orm/pg-core/index.js",
		"node_modules/odd/loader.ts",
	]);
	const whole = new Set([
		"node_modules/typescript-compiler-api",
		"node_modules/@img/sharp-win32-x64",
	]);
	const removable = (path: string) => fileRemovable(path, traced, whole);

	it("drops what the trace never reached in an ordinary package", () => {
		expect(removable("node_modules/drizzle-orm/mysql-core/index.js")).toBe(true);
		expect(removable("node_modules/drizzle-orm/pg-core/index.js")).toBe(false);
	});

	// A nested {"type":"module"} decides how its folder's files load; a license is owed.
	it("keeps every package.json and license text", () => {
		for (const file of [
			"node_modules/drizzle-orm/package.json",
			"node_modules/drizzle-orm/esm/package.json",
			"node_modules/drizzle-orm/LICENSE",
			"node_modules/zod/LICENSE.md",
		])
			expect(removable(file)).toBe(false);
	});

	// The publication compiler reads TypeScript's standard library with readdirSync.
	it("keeps every file of a package that reads its own files", () => {
		expect(
			removable("node_modules/typescript-compiler-api/lib/lib.es2022.d.ts"),
		).toBe(false);
	});

	it("drops only what Node never executes from a native package", () => {
		expect(removable("node_modules/@img/sharp-win32-x64/lib/libvips-42.dll")).toBe(
			false,
		);
		expect(removable("node_modules/@img/sharp-win32-x64/README.md")).toBe(true);
	});

	it("never drops a file the trace loaded, whatever its name", () => {
		expect(removable("node_modules/odd/loader.ts")).toBe(false);
	});
});

describe("extensionsCreatedBy", () => {
	it("reads the extensions the migrations create, and always plpgsql", () => {
		const names = extensionsCreatedBy([
			"CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint",
			'create extension "citext";',
			'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
			"CREATE TABLE a (id text);",
		]);
		expect([...names].sort()).toEqual([
			"citext",
			"pg_trgm",
			"plpgsql",
			"uuid-ossp",
		]);
	});
});

describe("extensionFileKept", () => {
	const kept = new Set(["plpgsql", "pg_trgm"]);

	it("keeps an extension's control file, install script and upgrade chain", () => {
		for (const file of [
			"pg_trgm.control",
			"pg_trgm--1.3.sql",
			"pg_trgm--1.5--1.6.sql",
			"plpgsql--1.0.sql",
		])
			expect(extensionFileKept(file, kept)).toBe(true);
	});

	it("drops other extensions, including one whose name starts the same", () => {
		expect(extensionFileKept("hstore--1.8.sql", kept)).toBe(false);
		expect(extensionFileKept("pg_trgm_extra.control", kept)).toBe(false);
		expect(extensionFileKept("uuid-ossp--1.1.sql", kept)).toBe(false);
		expect(extensionFileKept("uuid-ossp.control", kept)).toBe(false);
		expect(
			extensionFileKept("uuid-ossp.control", new Set(["uuid-ossp"])),
		).toBe(true);
	});

	// Something that is not an extension file is not ours to judge.
	it("leaves a file it cannot name", () => {
		expect(extensionFileKept("README", kept)).toBe(true);
	});
});
