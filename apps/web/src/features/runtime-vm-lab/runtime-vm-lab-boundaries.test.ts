import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What the PoC harness does not do. This folder creates a worker, the only place allowed to. The
 * reason is not to run maker code but to keep the VM host off the main thread. Maker code actually
 * runs in the WASM VM inside the worker, and the worker itself does not count as isolation.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

const stripComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = () =>
	readdirSync(HERE)
		.filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
		.map((name) => ({
			name,
			source: stripComments(readFileSync(join(HERE, name), "utf8")),
		}));

describe("harness boundaries", () => {
	it.each([
		[/\beval\s*\(/],
		[/new\s+Function\s*\(/],
		[/<iframe/i],
		[/createObjectURL/],
		[/dangerouslySetInnerHTML/],
	])("%s is absent", (door) => {
		expect(
			files()
				.filter((file) => door.test(file.source))
				.map((file) => file.name),
		).toEqual([]);
	});

	it("the worker is the one file that imports the engine by value", () => {
		const offenders = files()
			.filter((file) =>
				/quickjs-emscripten|@jitl\/quickjs|runtime-host\/quickjs/.test(
					file.source,
				),
			)
			.map((file) => file.name);
		expect(offenders).toEqual(["vm-poc.worker.ts"]);
	});

	it("does not import the studio; preview execution is a Phase 4 decision", () => {
		const offenders = files()
			.filter((file) =>
				/runtime-studio|local-authoring|@rowcat\/authoring/.test(file.source),
			)
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});
});
