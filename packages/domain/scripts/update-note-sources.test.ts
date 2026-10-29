import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateNoteProblems } from "../src/update-note.ts";
import { UPDATE_NOTE_RUNTIME_RECORDS } from "../src/update-notes/generated/update-notes.ts";
import { GENERATED_FILE } from "./lib/generated-registry.ts";
import { renderUpdateNoteRegistry } from "./lib/render-update-note-registry.ts";
import { loadUpdateNoteSources } from "./lib/update-note-sources.ts";

/**
 * The boundary between authoring sources and generated output. Tests that need Node capabilities
 * live here. `src/update-note.test.ts` covers only the generated registry and pure rules. File
 * names, duplicate dates, Discord copy and freshness need the source files, so they belong here.
 * Without this split, tests for browser-facing modules would start scanning the file system, and
 * runtime code doing the same would not look out of place.
 */

const sources = await loadUpdateNoteSources();

/**
 * The loader is checked against a fixture folder. The public `releases/` is absent (git does not
 * track empty directories), so checking only the real folder would make every check below pass
 * vacuously, and a loader that finds nothing would look like 'no releases'. Fixtures stay under
 * `scripts/`, so they never reach the generated output or the screen.
 */
const FIXTURE_DIR = join(import.meta.dirname, "__fixtures__", "releases");

describe("discovery", () => {
	it("really finds releases", async () => {
		const found = await loadUpdateNoteSources(FIXTURE_DIR);
		expect(found.map((source) => source.path)).toEqual([
			"releases/2026/2026-01-15.ts",
			"releases/2026/2026-03-02.ts",
		]);
		expect(found.map((source) => source.record.surfaces)).toEqual([
			undefined,
			["web"],
		]);
	});

	it("no folder means no releases", async () => {
		expect(
			await loadUpdateNoteSources(join(FIXTURE_DIR, "..", "absent")),
		).toEqual([]);
	});

	/**
	 * The hand-written registry array is gone. Each release file is the discovery source, so the
	 * generated registry must have exactly one entry per file.
	 */
	it("the generated file has as many releases as were authored", () => {
		expect(UPDATE_NOTE_RUNTIME_RECORDS.length).toBe(sources.length);
	});

	it("the template is not a release", () => {
		for (const source of sources)
			expect(source.path).not.toContain("_template");
	});

	it("comes oldest first", () => {
		const dates = sources.map((source) => source.record.releasedAt);
		expect(dates).toEqual([...dates].sort());
	});
});

describe("the file name is the identity", () => {
	it("the path is releases/<year>/<releasedAt>.ts", () => {
		for (const { path, record } of sources)
			expect(path).toBe(
				`releases/${record.releasedAt.slice(0, 4)}/${record.releasedAt}.ts`,
			);
	});

	it("dates do not repeat", () => {
		const dates = sources.map((source) => source.record.releasedAt);
		expect(new Set(dates).size).toBe(dates.length);
	});
});

describe("authoring rules", () => {
	it("authored records have no problems", () => {
		for (const { path, record } of sources)
			expect(updateNoteProblems(record), path).toEqual([]);
	});

	/**
	 * No version numbers in user-facing copy. The public identity is the date; a line such as
	 * `v0.13.0` would give users two names for one release. Discord copy is public too, so the same
	 * rule applies.
	 */
	it("no SemVer appears in user-visible text", () => {
		for (const { path, record } of sources) {
			const copy = JSON.stringify({
				inApp: record.inApp,
				discord: record.discord,
			});
			expect(copy, path).not.toMatch(/\d+\.\d+\.\d+/);
			expect(copy, path).not.toMatch(/version\s*\d/i);
		}
	});
});

describe("generated output", () => {
	/**
	 * Stale generated output fails silently. If an authoring file changes and `pnpm updates:generate`
	 * is forgotten, types and other tests still pass and only the deployed app shows old notes. This
	 * test re-renders in memory and compares against the file, so CI never has to rewrite the working
	 * tree.
	 */
	it("the committed file matches the authoring source", () => {
		const records = sources.map((source) => source.record);
		expect(readFileSync(GENERATED_FILE, "utf8")).toBe(
			renderUpdateNoteRegistry(records),
		);
	});

	it("rendering twice gives the same result", () => {
		const records = sources.map((source) => source.record);
		expect(renderUpdateNoteRegistry(records)).toBe(
			renderUpdateNoteRegistry(records),
		);
	});

	/**
	 * Tool-only data must not ship in the app bundle. Explanatory comments in the generated file may
	 * name the forbidden terms, so the scan strips block comments before matching. Scanning raw text
	 * would count the explanation itself as a violation.
	 */
	it("neither the Discord body nor the internal version is included", () => {
		const code = readFileSync(GENERATED_FILE, "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/(^|[^:])\/\/.*$/gm, "$1");
		expect(code).not.toContain("internalVersion");
		expect(code).not.toContain("discord");
		for (const { record } of sources) {
			if (record.internalVersion)
				expect(code, record.releasedAt).not.toContain(record.internalVersion);
			if (record.discord?.intro)
				expect(code, record.releasedAt).not.toContain(record.discord.intro);
		}
	});

	/**
	 * If the real registry is empty, the check above passes vacuously, so the same boundary is also
	 * checked against fixtures. If the renderer starts spreading records, this check fails first.
	 */
	it("rendering fixtures includes no tool-only data", async () => {
		const records = (await loadUpdateNoteSources(FIXTURE_DIR)).map(
			(source) => source.record,
		);
		const code = renderUpdateNoteRegistry(records)
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/(^|[^:])\/\/.*$/gm, "$1");
		expect(code).toContain('releasedAt: "2026-01-15"');
		expect(code).toContain('releasedAt: "2026-03-02"');
		expect(code).toContain("Fixture sentence.");
		expect(code).not.toContain("internalVersion");
		expect(code).not.toContain("0.1.0");
		expect(code).not.toContain("discord");
		expect(code).not.toContain("Fixture title.");
	});

	/** Authored body text is preserved exactly: generation copies, it does not edit. */
	it("the in-app body is included as is", () => {
		for (const { record } of sources) {
			const runtime = UPDATE_NOTE_RUNTIME_RECORDS.find(
				(candidate) => candidate.releasedAt === record.releasedAt,
			);
			expect(runtime, record.releasedAt).toBeDefined();
			expect(runtime?.inApp).toEqual(record.inApp);
			expect(runtime?.surfaces).toEqual(record.surfaces);
		}
	});
});
