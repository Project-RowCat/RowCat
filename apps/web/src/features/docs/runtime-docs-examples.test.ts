import { RUNTIME_API_VERSION } from "@rowcat/runtime/declarations";
import { compileRuntimeProject } from "@rowcat/runtime-compiler";
import { nodeRuntimeEnvironment } from "@rowcat/runtime-compiler/node";
import { afterEach, describe, expect, it } from "vitest";
import {
	RUNTIME_DOC_EXAMPLES,
	type RuntimeDocExample,
} from "#/generated/runtime-docs-examples.ts";
import {
	disposeMountedTemplates,
	mountTemplate,
} from "#/test/runtime-template-harness.ts";

/**
 * Documented examples really compile and run.
 *
 * If the docs say code works but it is valid only inside a string, the first reader finds it broken
 * and suspects their own code. So every code block with `example=` goes through the same compiler
 * as the product and renders its first screen in the same VM.
 *
 * Same chain as the starter template test (`runtime-template-runtime.test.ts`), with the same
 * harness (`#/test/runtime-template-harness.ts`). Examples have the same shape as templates (entry
 * file plus file list), so the harness takes them unchanged.
 */

const environment = nodeRuntimeEnvironment();

afterEach(disposeMountedTemplates);

const cases = RUNTIME_DOC_EXAMPLES.map(
	(example) => [`${example.doc || "index"} › ${example.id}`, example] as const,
);

const asTemplate = (example: RuntimeDocExample) =>
	({
		id: "blank",
		name: example.id,
		description: "",
		category: "basic",
		complexity: "beginner",
		demonstrates: [],
		entry: example.entry,
		files: example.files,
	}) as const;

describe("doc examples", () => {
	it("there is at least one example", () => {
		expect(RUNTIME_DOC_EXAMPLES.length).toBeGreaterThan(0);
	});

	it.each(cases)("%s — compiles without diagnostics", (_label, example) => {
		const result = compileRuntimeProject(
			{
				apiVersion: RUNTIME_API_VERSION,
				entry: example.entry,
				files: example.files.map((file) => ({
					path: file.path,
					content: file.content,
				})),
			},
			environment,
		);
		expect(
			result.diagnostics.map(
				(diagnostic) =>
					`${diagnostic.path ?? "?"}:${diagnostic.line ?? "?"} ${diagnostic.message}`,
			),
		).toEqual([]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		/** Every file must be in the module graph, so no file drops out silently. */
		expect(result.artifact.modules.map((module) => module.id).sort()).toEqual(
			example.files.map((file) => file.path).sort(),
		);
	});

	it.each(
		cases,
	)("%s — the first screen renders in the VM", async (_label, example) => {
		const mounted = await mountTemplate(asTemplate(example));
		expect(mounted.rootErrors).toEqual([]);
		expect(mounted.diagnostics).toEqual([]);
		expect(mounted.tree.size).toBeGreaterThan(1);
	});

	/**
	 * Quick start is the docs' first promise, so this flow is tested end to end: continuing advances
	 * the chapter, and the value persists in saved state.
	 */
	it("quick start: pressing continue turns the chapter and saves", async () => {
		const example = RUNTIME_DOC_EXAMPLES.find(
			(candidate) => candidate.id === "quick-start",
		);
		if (example === undefined) throw new Error("no quick-start example");
		const mounted = await mountTemplate(asTemplate(example));
		expect(mounted.text()).toContain("1장");
		await mounted.press("계속");
		expect(mounted.text()).toContain("2장");
		expect(
			mounted.story().entries.find((entry) => entry.key === "game")?.value,
		).toEqual({
			chapter: 2,
		});
	});
});
